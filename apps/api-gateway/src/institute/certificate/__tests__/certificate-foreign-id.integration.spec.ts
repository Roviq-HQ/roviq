/**
 * ROV-293: every TC and certificate operation that takes an id refuses a TC, certificate,
 * template, student, staff member or academic year of another institute, returns none of its
 * data, stores no reference to it, renders no PDF and starts no workflow.
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  type CbseTcData,
  CertificateStatus,
  ErrorCode,
  Gender,
  SocialCategory,
  TcStatus,
} from '@roviq/common-types';
import {
  academicYears,
  certificateTemplates,
  type DrizzleDB,
  files,
  issuedCertificates,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  staffProfiles,
  standards,
  studentAcademics,
  studentProfiles,
  tcRegister,
  tenantSequences,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import { TemporalClientService } from '@roviq/temporal';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { Connection } from '@temporalio/client';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:certificate-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const TC_DATA: CbseTcData = {
  studentName: 'Asha Verma',
  motherName: null,
  fatherOrGuardianName: null,
  nationality: 'Indian',
  socialCategory: 'GENERAL',
  dateOfBirthFigures: '2015-04-02',
  dateOfBirthWords: null,
  whetherFailed: 'No',
  subjectsStudied: 'As per curriculum',
  classLastStudied: 'Class 5',
  lastExamResult: 'Passed',
  qualifiedForPromotion: 'Yes',
  feesPaidUpTo: 'Yes',
  feeConcession: 'None',
  nccScoutGuide: 'None',
  dateOfLeaving: null,
  reasonForLeaving: 'Family is moving',
  totalWorkingDays: '220',
  totalPresentDays: '200',
  generalConduct: 'Good',
  remarks: '',
  dateOfIssue: null,
};

const GET_TC = /* GraphQL */ `
  query GetTCDetails($id: ID!) {
    getTCDetails(id: $id) {
      id
    }
  }
`;
const LIST_TCS = /* GraphQL */ `
  query ListTCs($filter: ListTCFilterInput) {
    listTCs(filter: $filter) {
      id
    }
  }
`;
const REQUEST_TC = /* GraphQL */ `
  mutation RequestTC($input: RequestTCInput!) {
    requestTC(input: $input) {
      id
      status
    }
  }
`;
const byId = (operation: string) => /* GraphQL */ `
  mutation ById($id: ID!) {
    ${operation}(id: $id) {
      id
    }
  }
`;
const REJECT_TC = /* GraphQL */ `
  mutation RejectTC($id: ID!) {
    rejectTC(id: $id, reason: "Documents are missing") {
      id
    }
  }
`;
const REQUEST_DUPLICATE_TC = /* GraphQL */ `
  mutation RequestDuplicateTC($id: ID!) {
    requestDuplicateTC(input: { originalTcId: $id, reason: "Original lost, FIR 12/2026" }) {
      id
    }
  }
`;
const GET_CERTIFICATE = /* GraphQL */ `
  query GetCertificate($id: ID!) {
    getCertificate(id: $id) {
      id
    }
  }
`;
const LIST_CERTIFICATES = /* GraphQL */ `
  query ListCertificates($filter: ListCertificateFilterInput) {
    listCertificates(filter: $filter) {
      id
    }
  }
`;
const TEMPLATE_FIELDS = /* GraphQL */ `
  query GetCertificateTemplateFields($templateId: ID!) {
    getCertificateTemplateFields(templateId: $templateId)
  }
`;
const PREVIEW = /* GraphQL */ `
  query PreviewCertificate($input: PreviewCertificateInput!) {
    previewCertificate(input: $input)
  }
`;
const REQUEST_CERTIFICATE = /* GraphQL */ `
  mutation RequestCertificate($input: RequestCertificateInput!) {
    requestCertificate(input: $input) {
      id
      status
    }
  }
`;

interface Fixture {
  yearId: string;
  /** Enrolled students; [0] has the issued TC, [1] and [2] an open TC, [3] none. */
  studentIds: [string, string, string, string];
  staffProfileId: string;
  templateId: string;
  /** ISSUED without a PDF, with an open duplicate request. */
  issuedTcId: string;
  duplicateTcId: string;
  /** ISSUED without a PDF and without a duplicate. */
  spareIssuedTcId: string;
  generatedTcId: string;
  approvedTcId: string;
  requestedTcId: string;
  /** ISSUED without a PDF, for student [0]. */
  issuedCertificateId: string;
  /** DRAFT, for student [1]. */
  draftCertificateId: string;
}

describe('certificates and TCs: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;
  const storage = new FakeStorageClient();

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Rows of both institutes, and every row pointing at one of B's. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignTcs = [
        b.issuedTcId,
        b.duplicateTcId,
        b.spareIssuedTcId,
        b.generatedTcId,
        b.approvedTcId,
        b.requestedTcId,
      ];
      return {
        tcs: await tx
          .select()
          .from(tcRegister)
          .where(
            or(
              inArray(tcRegister.tenantId, tenants),
              inArray(tcRegister.studentProfileId, b.studentIds),
              eq(tcRegister.academicYearId, b.yearId),
              inArray(tcRegister.originalTcId, foreignTcs),
            ),
          )
          .orderBy(asc(tcRegister.id)),
        certificates: await tx
          .select()
          .from(issuedCertificates)
          .where(
            or(
              inArray(issuedCertificates.tenantId, tenants),
              eq(issuedCertificates.templateId, b.templateId),
              inArray(issuedCertificates.studentProfileId, b.studentIds),
              eq(issuedCertificates.staffProfileId, b.staffProfileId),
            ),
          )
          .orderBy(asc(issuedCertificates.id)),
        students: await tx
          .select()
          .from(studentProfiles)
          .where(inArray(studentProfiles.tenantId, tenants))
          .orderBy(asc(studentProfiles.id)),
        sequences: await tx
          .select()
          .from(tenantSequences)
          .where(inArray(tenantSequences.tenantId, tenants))
          .orderBy(asc(tenantSequences.tenantId), asc(tenantSequences.sequenceName)),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.tenantId, tenants),
              inArray(files.uploadedBy, [instA.userId, instB.userId]),
            ),
          )
          .orderBy(asc(files.id)),
      };
    });

  const setUp = async (inst: TestInstitute): Promise<Fixture> => {
    const teacher = await createTestTeacher(result.db, inst.tenantId);
    return asAdmin(async (tx) => {
      const tenantId = inst.tenantId;
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId,
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          isActive: true,
          status: 'ACTIVE',
          ...BY,
        })
        .returning({ id: academicYears.id });
      const [standard] = await tx
        .insert(standards)
        .values({
          tenantId,
          academicYearId: year.id,
          name: { en: 'Class 5' },
          numericOrder: 5,
          level: 'PRIMARY',
          ...BY,
        })
        .returning({ id: standards.id });
      const [section] = await tx
        .insert(sections)
        .values({
          tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: 'Class 5-A',
          capacity: 40,
          ...BY,
        })
        .returning({ id: sections.id });
      const [role] = await tx
        .insert(roles)
        .values({
          name: { en: `Student ${randomUUID().slice(0, 8)}` },
          scope: 'institute',
          tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          ...BY,
        })
        .returning({ id: roles.id });

      const addStudent = async (firstName: string) => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx
          .insert(users)
          .values({
            email: `cert_stu_${suffix}@test.local`,
            username: `cert_stu_${suffix}`,
            passwordHash: 'not-a-real-hash',
            ...BY,
          })
          .returning({ id: users.id });
        const name = { firstName: { en: firstName }, lastName: { en: 'Verma' } };
        await tx
          .insert(userProfiles)
          .values({ userId: user.id, ...name, gender: Gender.FEMALE, ...BY });
        await tx
          .insert(tenantUserProfiles)
          .values({ tenantId, userId: user.id, ...name, gender: Gender.FEMALE, ...BY });
        const [membership] = await tx
          .insert(memberships)
          .values({ userId: user.id, roleId: role.id, tenantId, abilities: [], ...BY })
          .returning({ id: memberships.id });
        const [profile] = await tx
          .insert(studentProfiles)
          .values({
            tenantId,
            userId: user.id,
            membershipId: membership.id,
            admissionNumber: `CERT-ADM-${suffix}`,
            admissionDate: '2026-04-01',
            admissionType: AdmissionType.NEW,
            academicStatus: AcademicStatus.ENROLLED,
            socialCategory: SocialCategory.GENERAL,
            ...BY,
          })
          .returning({ id: studentProfiles.id });
        await tx.insert(studentAcademics).values({
          tenantId,
          studentProfileId: profile.id,
          academicYearId: year.id,
          standardId: standard.id,
          sectionId: section.id,
          ...BY,
        });
        return profile.id;
      };
      const studentIds: Fixture['studentIds'] = [
        await addStudent('Asha'),
        await addStudent('Bela'),
        await addStudent('Chitra'),
        await addStudent('Divya'),
      ];

      const [staff] = await tx
        .insert(staffProfiles)
        .values({
          tenantId,
          userId: teacher.userId,
          membershipId: teacher.membershipId,
          employeeId: `EMP-${randomUUID().slice(0, 8)}`,
          designation: 'Teacher',
          dateOfJoining: '2025-06-01',
          ...BY,
        })
        .returning({ id: staffProfiles.id });

      const [template] = await tx
        .insert(certificateTemplates)
        .values({
          tenantId,
          type: 'BONAFIDE_CERTIFICATE',
          name: 'Bonafide',
          templateContent: '<p>Certified that {{studentName}} studies here.</p><p>{{purpose}}</p>',
          fieldsSchema: {},
          ...BY,
        })
        .returning({ id: certificateTemplates.id });

      const addTc = async (
        studentProfileId: string,
        status: TcStatus,
        duplicateOf?: string,
      ): Promise<string> => {
        const issued = status === TcStatus.ISSUED;
        const [tc] = await tx
          .insert(tcRegister)
          .values({
            tenantId,
            studentProfileId,
            academicYearId: year.id,
            tcSerialNumber: `TC-TMP-${randomUUID()}`,
            status,
            reason: 'Family is moving to another city',
            tcData: TC_DATA,
            verificationToken: issued ? randomUUID().replace(/-/g, '') : undefined,
            issuedAt: issued ? new Date() : null,
            isDuplicate: duplicateOf !== undefined,
            originalTcId: duplicateOf ?? null,
            requestedBy: SYSTEM_USER_ID,
            ...BY,
          })
          .returning({ id: tcRegister.id });
        return tc.id;
      };
      const issuedTcId = await addTc(studentIds[0], TcStatus.ISSUED);

      const addCertificate = async (studentProfileId: string, status: CertificateStatus) => {
        const [certificate] = await tx
          .insert(issuedCertificates)
          .values({
            tenantId,
            templateId: template.id,
            studentProfileId,
            serialNumber: `CERT/TMP/${randomUUID().slice(0, 8)}`,
            status,
            certificateData: { studentName: 'Asha Verma', purpose: 'Bank loan' },
            purpose: 'Bank loan',
            issuedDate: status === CertificateStatus.ISSUED ? '2026-11-20' : null,
            ...BY,
          })
          .returning({ id: issuedCertificates.id });
        return certificate.id;
      };

      return {
        yearId: year.id,
        studentIds,
        staffProfileId: staff.id,
        templateId: template.id,
        issuedTcId,
        duplicateTcId: await addTc(studentIds[0], TcStatus.DUPLICATE_REQUESTED, issuedTcId),
        spareIssuedTcId: await addTc(studentIds[1], TcStatus.ISSUED),
        generatedTcId: await addTc(studentIds[0], TcStatus.GENERATED),
        approvedTcId: await addTc(studentIds[1], TcStatus.APPROVED),
        requestedTcId: await addTc(studentIds[2], TcStatus.REQUESTED),
        issuedCertificateId: await addCertificate(studentIds[0], CertificateStatus.ISSUED),
        draftCertificateId: await addCertificate(studentIds[1], CertificateStatus.DRAFT),
      };
    });
  };

  const query = async <T>(source: string, variables: Record<string, unknown>) => {
    const res = await gqlRequest<T>(result.httpServer, { query: source, variables, token: tokenA });
    expect(res.errors).toBeUndefined();
    return res.data;
  };

  const refusesAndWritesNothing = async (
    source: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const put = vi.spyOn(storage, 'put');
    const connect = vi
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal must not be reached'));
    // The gateway's Temporal client connects lazily, never through `Connection.connect`.
    const startWorkflow = vi
      .spyOn(TemporalClientService.prototype, 'startWorkflow')
      .mockRejectedValue(new Error('No workflow may start'));

    const res = await gqlRequest(result.httpServer, { query: source, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
  };

  const ids = (rows: ReadonlyArray<{ id: string }> | undefined) =>
    rows?.map((row) => row.id).sort();

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: StorageClient, useValue: storage }],
    });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    a = await setUp(instA);
    b = await setUp(instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('TC reads', () => {
    it('getTCDetails should refuse a TC of another institute and return none of it', async () => {
      await refusesAndWritesNothing(GET_TC, { id: b.issuedTcId }, ErrorCode.TC_NOT_FOUND);
    });

    it('listTCs should list its own student and original and nothing of another institute', async () => {
      type Rows = { listTCs: { id: string }[] };

      const ownStudent = await query<Rows>(LIST_TCS, {
        filter: { studentProfileId: a.studentIds[0] },
      });
      const ownOriginal = await query<Rows>(LIST_TCS, { filter: { originalTcId: a.issuedTcId } });

      expect(ids(ownStudent?.listTCs)).toEqual(
        [a.issuedTcId, a.duplicateTcId, a.generatedTcId].sort(),
      );
      expect(ids(ownOriginal?.listTCs)).toEqual([a.duplicateTcId]);
      expect(await query(LIST_TCS, { filter: { studentProfileId: b.studentIds[0] } })).toEqual({
        listTCs: [],
      });
      expect(await query(LIST_TCS, { filter: { originalTcId: b.issuedTcId } })).toEqual({
        listTCs: [],
      });
    });
  });

  describe('TC mutations', () => {
    it('requestTC should request a TC for its own student and year', async () => {
      const startWorkflow = vi
        .spyOn(TemporalClientService.prototype, 'startWorkflow')
        .mockResolvedValue('run-id');

      const data = await query<{ requestTC: { id: string; status: string } }>(REQUEST_TC, {
        input: {
          studentProfileId: a.studentIds[3],
          academicYearId: a.yearId,
          reason: 'Family relocating to another city',
        },
      });

      expect(data?.requestTC.status).toBe(TcStatus.REQUESTED);
      expect(startWorkflow).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'studentProfileId',
        () => ({ studentProfileId: b.studentIds[3], academicYearId: a.yearId }),
        ErrorCode.STUDENT_NOT_FOUND,
      ],
      [
        'academicYearId',
        () => ({ studentProfileId: a.studentIds[2], academicYearId: b.yearId }),
        ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
      ],
    ] as const)('requestTC should refuse %s of another institute and store nothing', async (_field, input, code) => {
      await refusesAndWritesNothing(
        REQUEST_TC,
        { input: { ...input(), reason: 'Family relocating to another city' } },
        code,
      );
    });

    it('approveTC should refuse a generated TC of another institute and change nothing', async () => {
      await refusesAndWritesNothing(
        byId('approveTC'),
        { id: b.generatedTcId },
        ErrorCode.TC_NOT_FOUND,
      );
    });

    it('rejectTC should refuse a requested TC of another institute and change nothing', async () => {
      await refusesAndWritesNothing(REJECT_TC, { id: b.requestedTcId }, ErrorCode.TC_NOT_FOUND);
    });

    it('issueTC should refuse an approved TC of another institute and render nothing', async () => {
      await refusesAndWritesNothing(
        byId('issueTC'),
        { id: b.approvedTcId },
        ErrorCode.TC_NOT_FOUND,
      );
    });

    it('generateTCPdf should refuse an issued TC of another institute and render nothing', async () => {
      await refusesAndWritesNothing(
        byId('generateTCPdf'),
        { id: b.spareIssuedTcId },
        ErrorCode.TC_NOT_FOUND,
      );
    });

    it('requestDuplicateTC should refuse an issued TC of another institute and store nothing', async () => {
      await refusesAndWritesNothing(
        REQUEST_DUPLICATE_TC,
        { id: b.spareIssuedTcId },
        ErrorCode.TC_NOT_FOUND,
      );
    });
  });

  describe('certificate reads', () => {
    it('getCertificate should refuse a certificate of another institute and return none of it', async () => {
      await refusesAndWritesNothing(
        GET_CERTIFICATE,
        { id: b.issuedCertificateId },
        ErrorCode.CERTIFICATE_NOT_FOUND,
      );
    });

    it('listCertificates should list its own student and nothing of another institute', async () => {
      const own = await query<{ listCertificates: { id: string }[] }>(LIST_CERTIFICATES, {
        filter: { studentProfileId: a.studentIds[0] },
      });

      expect(ids(own?.listCertificates)).toEqual([a.issuedCertificateId]);
      expect(
        await query(LIST_CERTIFICATES, { filter: { studentProfileId: b.studentIds[0] } }),
      ).toEqual({ listCertificates: [] });
    });

    it('getCertificateTemplateFields should read its own template', async () => {
      expect(await query(TEMPLATE_FIELDS, { templateId: a.templateId })).toEqual({
        getCertificateTemplateFields: ['studentName', 'purpose'],
      });
    });

    it('getCertificateTemplateFields should refuse a template of another institute', async () => {
      await refusesAndWritesNothing(
        TEMPLATE_FIELDS,
        { templateId: b.templateId },
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
      );
    });

    it('previewCertificate should render its own template with its own student', async () => {
      const data = await query<{ previewCertificate: string }>(PREVIEW, {
        input: { templateId: a.templateId, studentProfileId: a.studentIds[0], purpose: 'Visa' },
      });

      expect(data?.previewCertificate).toContain(
        '<p>Certified that Asha Verma studies here.</p><p>Visa</p>',
      );
    });

    it.each([
      [
        'templateId',
        () => ({ templateId: b.templateId, studentProfileId: a.studentIds[0] }),
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
      ],
      [
        'studentProfileId',
        () => ({ templateId: a.templateId, studentProfileId: b.studentIds[0] }),
        ErrorCode.STUDENT_NOT_FOUND,
      ],
    ] as const)('previewCertificate should refuse %s of another institute', async (_field, input, code) => {
      await refusesAndWritesNothing(PREVIEW, { input: { ...input(), purpose: 'Visa' } }, code);
    });
  });

  describe('certificate mutations', () => {
    it('requestCertificate should request a certificate of its own template for its own student', async () => {
      const data = await query<{ requestCertificate: { id: string; status: string } }>(
        REQUEST_CERTIFICATE,
        {
          input: { templateId: a.templateId, studentProfileId: a.studentIds[2], purpose: 'Visa' },
        },
      );

      expect(data?.requestCertificate.status).toBe(CertificateStatus.DRAFT);
    });

    it('requestCertificate should request a certificate of its own template for its own staff', async () => {
      const data = await query<{ requestCertificate: { id: string; status: string } }>(
        REQUEST_CERTIFICATE,
        {
          input: { templateId: a.templateId, staffProfileId: a.staffProfileId, purpose: 'Visa' },
        },
      );

      expect(data?.requestCertificate.status).toBe(CertificateStatus.DRAFT);
    });

    it.each([
      [
        'templateId',
        () => ({ templateId: b.templateId, studentProfileId: a.studentIds[2] }),
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
      ],
      [
        'studentProfileId',
        () => ({ templateId: a.templateId, studentProfileId: b.studentIds[2] }),
        ErrorCode.STUDENT_NOT_FOUND,
      ],
      [
        'staffProfileId',
        () => ({ templateId: a.templateId, staffProfileId: b.staffProfileId }),
        ErrorCode.STAFF_NOT_FOUND,
      ],
    ] as const)('requestCertificate should refuse %s of another institute and store nothing', async (_field, input, code) => {
      await refusesAndWritesNothing(
        REQUEST_CERTIFICATE,
        { input: { ...input(), purpose: 'Visa' } },
        code,
      );
    });

    it('issueCertificate should refuse a draft certificate of another institute and render nothing', async () => {
      await refusesAndWritesNothing(
        byId('issueCertificate'),
        { id: b.draftCertificateId },
        ErrorCode.CERTIFICATE_NOT_FOUND,
      );
    });

    it('generateCertificatePdf should refuse an issued certificate of another institute and render nothing', async () => {
      await refusesAndWritesNothing(
        byId('generateCertificatePdf'),
        { id: b.issuedCertificateId },
        ErrorCode.CERTIFICATE_NOT_FOUND,
      );
    });
  });
});
