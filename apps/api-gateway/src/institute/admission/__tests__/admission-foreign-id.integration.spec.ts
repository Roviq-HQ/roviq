/**
 * ROV-293: every admission operation that takes an id refuses an enquiry, application,
 * document, academic year, class, section, staff member or upload of another institute,
 * returns none of its data, and stores no reference to it.
 */
import { randomUUID } from 'node:crypto';
import { AdmissionApplicationStatus, ErrorCode, Gender } from '@roviq/common-types';
import {
  academicYears,
  admissionApplications,
  applicationDocumentFiles,
  applicationDocuments,
  type DrizzleDB,
  enquiries,
  files,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sections,
  staffProfiles,
  standards,
  tenantSequences,
  tenantUserProfiles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
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
import { EicarFileScanner } from '../../../files/scan/eicar-file-scanner';
import { FileScanner } from '../../../files/scan/file-scanner';

const ORIGIN = 'test:admission-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

const GET_APPLICATION = /* GraphQL */ `
  query GetApplication($id: ID!) {
    getApplication(id: $id) {
      id
    }
  }
`;
const LIST_APPLICATIONS = /* GraphQL */ `
  query ListApplications($filter: ApplicationFilterInput) {
    listApplications(filter: $filter) {
      totalCount
      edges {
        node {
          id
        }
      }
    }
  }
`;
const LIST_ENQUIRIES = /* GraphQL */ `
  query ListEnquiries($filter: EnquiryFilterInput) {
    listEnquiries(filter: $filter) {
      totalCount
      edges {
        node {
          id
        }
      }
    }
  }
`;
const LIST_ENQUIRY_ASSIGNEES = /* GraphQL */ `
  query ListEnquiryAssignees($filter: EnquiryFilterInput) {
    listEnquiries(filter: $filter) {
      edges {
        node {
          id
          assignedTo
          assignee {
            userId
            firstName
            lastName
            employeeId
          }
        }
      }
    }
  }
`;
const LIST_DOCUMENTS = /* GraphQL */ `
  query ListApplicationDocuments($applicationId: ID!) {
    listApplicationDocuments(applicationId: $applicationId) {
      id
    }
  }
`;
const CREATE_ENQUIRY = /* GraphQL */ `
  mutation CreateEnquiry($input: CreateEnquiryInput!) {
    createEnquiry(input: $input) {
      id
    }
  }
`;
const UPDATE_ENQUIRY = /* GraphQL */ `
  mutation UpdateEnquiry($id: ID!, $input: UpdateEnquiryInput!) {
    updateEnquiry(id: $id, input: $input) {
      id
    }
  }
`;
const CONVERT = /* GraphQL */ `
  mutation ConvertEnquiryToApplication($enquiryId: ID!, $standardId: ID!, $academicYearId: ID!) {
    convertEnquiryToApplication(
      enquiryId: $enquiryId
      standardId: $standardId
      academicYearId: $academicYearId
    ) {
      id
    }
  }
`;
const CREATE_APPLICATION = /* GraphQL */ `
  mutation CreateApplication($input: CreateApplicationInput!) {
    createApplication(input: $input) {
      id
    }
  }
`;
const UPDATE_APPLICATION = /* GraphQL */ `
  mutation UpdateApplication($id: ID!, $input: UpdateApplicationInput!) {
    updateApplication(id: $id, input: $input) {
      id
    }
  }
`;
const APPROVE = /* GraphQL */ `
  mutation ApproveApplication($id: ID!, $sectionId: ID) {
    approveApplication(id: $id, sectionId: $sectionId) {
      id
    }
  }
`;
const REJECT = /* GraphQL */ `
  mutation RejectApplication($id: ID!) {
    rejectApplication(id: $id, reason: "Seats full") {
      id
    }
  }
`;
const ADD_DOCUMENT = /* GraphQL */ `
  mutation AddApplicationDocument($applicationId: ID!, $fileIds: [ID!]!) {
    addApplicationDocument(
      input: { applicationId: $applicationId, type: BIRTH_CERTIFICATE, fileIds: $fileIds }
    ) {
      id
    }
  }
`;
const REMOVE_DOCUMENT = /* GraphQL */ `
  mutation RemoveApplicationDocument($id: ID!) {
    removeApplicationDocument(id: $id)
  }
`;

interface Fixture {
  yearId: string;
  standardId: string;
  sectionId: string;
  /** Assigned to the institute's admin, not converted. */
  enquiryId: string;
  /** SUBMITTED, with one document of one page. */
  applicationId: string;
  /** FEE_PAID, with no section chosen yet. */
  feePaidApplicationId: string;
  documentId: string;
  documentFileId: string;
  /** An application document upload the institute's admin has not attached yet. */
  pendingFileId: string;
}

describe('admission: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  const storage = new FakeStorageClient();
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;
  /** Uploaded by A's own account, but in institute B. */
  let callerFileInB: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /**
   * Enquiries, applications, documents, files and numbering of both institutes, and every row
   * anywhere that points at B's rows or B's admin.
   */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignApplications = [b.applicationId, b.feePaidApplicationId];
      return {
        enquiries: await tx
          .select()
          .from(enquiries)
          .where(
            or(
              inArray(enquiries.tenantId, tenants),
              eq(enquiries.academicYearId, b.yearId),
              eq(enquiries.assignedTo, instB.userId),
              inArray(enquiries.convertedToApplicationId, foreignApplications),
            ),
          )
          .orderBy(asc(enquiries.id)),
        applications: await tx
          .select()
          .from(admissionApplications)
          .where(
            or(
              inArray(admissionApplications.tenantId, tenants),
              eq(admissionApplications.enquiryId, b.enquiryId),
              eq(admissionApplications.academicYearId, b.yearId),
              eq(admissionApplications.standardId, b.standardId),
              eq(admissionApplications.sectionId, b.sectionId),
            ),
          )
          .orderBy(asc(admissionApplications.id)),
        documents: await tx
          .select()
          .from(applicationDocuments)
          .where(
            or(
              inArray(applicationDocuments.tenantId, tenants),
              inArray(applicationDocuments.applicationId, foreignApplications),
            ),
          )
          .orderBy(asc(applicationDocuments.id)),
        pages: await tx
          .select()
          .from(applicationDocumentFiles)
          .where(
            or(
              inArray(applicationDocumentFiles.tenantId, tenants),
              eq(applicationDocumentFiles.documentId, b.documentId),
              inArray(applicationDocumentFiles.fileId, [
                b.documentFileId,
                b.pendingFileId,
                callerFileInB,
              ]),
            ),
          )
          .orderBy(asc(applicationDocumentFiles.id)),
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
        sequences: await tx
          .select()
          .from(tenantSequences)
          .where(inArray(tenantSequences.tenantId, tenants))
          .orderBy(asc(tenantSequences.tenantId), asc(tenantSequences.sequenceName)),
      };
    });

  const addFile = async (
    tx: DrizzleDB,
    tenantId: string,
    uploadedBy: string,
    status: 'PENDING' | 'READY',
  ) => {
    const objectKey = `institutes/${tenantId}/application-document/${randomUUID()}.pdf`;
    await storage.put('private', `pending/${objectKey}`, PDF, { contentType: 'application/pdf' });
    const [row] = await tx
      .insert(files)
      .values({
        tenantId,
        visibility: 'PRIVATE',
        purpose: 'APPLICATION_DOCUMENT',
        objectKey,
        originalName: 'birth-certificate.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        status,
        uploadedBy,
        createdBy: uploadedBy,
        updatedBy: uploadedBy,
      })
      .returning({ id: files.id });
    return row.id;
  };

  const addEnquiry = async (tx: DrizzleDB, inst: TestInstitute) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        tenantId: inst.tenantId,
        studentName: 'Kiran Patel',
        classRequested: 'Class 1',
        parentName: 'Manish Patel',
        parentPhone: '9012345678',
        parentRelation: 'MOTHER',
        assignedTo: inst.userId,
        ...BY,
      })
      .returning({ id: enquiries.id });
    return row.id;
  };

  const addApplication = async (
    tx: DrizzleDB,
    inst: TestInstitute,
    scope: { yearId: string; standardId: string },
    status: AdmissionApplicationStatus,
  ) => {
    const [row] = await tx
      .insert(admissionApplications)
      .values({
        tenantId: inst.tenantId,
        academicYearId: scope.yearId,
        standardId: scope.standardId,
        formData: { studentName: 'Asha' },
        status,
        ...BY,
      })
      .returning({ id: admissionApplications.id });
    return row.id;
  };

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Fixture> => {
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
          name: { en: 'Class 1' },
          numericOrder: 1,
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
          displayLabel: 'Class 1-A',
          capacity: 40,
          ...BY,
        })
        .returning({ id: sections.id });
      const scope = { yearId: year.id, standardId: standard.id };
      const applicationId = await addApplication(
        tx,
        inst,
        scope,
        AdmissionApplicationStatus.SUBMITTED,
      );
      const [document] = await tx
        .insert(applicationDocuments)
        .values({ tenantId, applicationId, type: 'BIRTH_CERTIFICATE', ...BY })
        .returning({ id: applicationDocuments.id });
      const documentFileId = await addFile(tx, tenantId, inst.userId, 'READY');
      await tx.insert(applicationDocumentFiles).values({
        tenantId,
        documentId: document.id,
        fileId: documentFileId,
        position: 0,
        ...BY,
      });
      return {
        ...scope,
        sectionId: section.id,
        enquiryId: await addEnquiry(tx, inst),
        applicationId,
        feePaidApplicationId: await addApplication(
          tx,
          inst,
          scope,
          AdmissionApplicationStatus.FEE_PAID,
        ),
        documentId: document.id,
        documentFileId,
        pendingFileId: await addFile(tx, tenantId, inst.userId, 'PENDING'),
      };
    });

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
    // Nothing may reach Temporal; a refused approval must not start an enrolment.
    const connect = vi
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal must not be reached'));

    const res = await gqlRequest(result.httpServer, { query: source, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  };

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: new EicarFileScanner() },
      ],
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
    callerFileInB = await asAdmin((tx) => addFile(tx, instB.tenantId, instA.userId, 'PENDING'));
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('reads', () => {
    it('getApplication should refuse an application of another institute and return none of it', async () => {
      const res = await gqlRequest(result.httpServer, {
        query: GET_APPLICATION,
        variables: { id: b.applicationId },
        token: tokenA,
      });

      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.APPLICATION_NOT_FOUND);
      expect(res.data).toBeNull();
    });

    it('listApplicationDocuments should list its own application and refuse one of another institute', async () => {
      expect(await query(LIST_DOCUMENTS, { applicationId: a.applicationId })).toEqual({
        listApplicationDocuments: [{ id: a.documentId }],
      });

      const res = await gqlRequest(result.httpServer, {
        query: LIST_DOCUMENTS,
        variables: { applicationId: b.applicationId },
        token: tokenA,
      });

      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.APPLICATION_NOT_FOUND);
      expect(res.data).toBeNull();
    });

    it.each([
      ['academicYearId', 'yearId'],
      ['standardId', 'standardId'],
    ] as const)('listApplications should list its own %s and no application of another institute', async (filter, key) => {
      const ids = (data: { listApplications: { edges: { node: { id: string } }[] } } | undefined) =>
        data?.listApplications.edges.map((edge) => edge.node.id).sort();

      const own = await query<{
        listApplications: { totalCount: number; edges: { node: { id: string } }[] };
      }>(LIST_APPLICATIONS, { filter: { [filter]: a[key] } });
      const foreign = await query<{
        listApplications: { totalCount: number; edges: { node: { id: string } }[] };
      }>(LIST_APPLICATIONS, { filter: { [filter]: b[key] } });

      expect(own?.listApplications.totalCount).toBe(2);
      expect(ids(own)).toEqual([a.applicationId, a.feePaidApplicationId].sort());
      expect(foreign).toEqual({ listApplications: { totalCount: 0, edges: [] } });
    });

    it('listEnquiries should list its own staff member and no enquiry of another institute', async () => {
      expect(await query(LIST_ENQUIRIES, { filter: { assignedTo: instA.userId } })).toEqual({
        listEnquiries: { totalCount: 1, edges: [{ node: { id: a.enquiryId } }] },
      });
      expect(await query(LIST_ENQUIRIES, { filter: { assignedTo: instB.userId } })).toEqual({
        listEnquiries: { totalCount: 0, edges: [] },
      });
    });

    it("listEnquiries should name the assignee from its own institute's profile only (ROV-360)", async () => {
      // A's admin also has a profile in B under another name; only A's copy may be joined.
      const outsider = await createTestTeacher(result.db, instB.tenantId);
      const pointingId = await asAdmin(async (tx) => {
        const profile = (tenantId: string, userId: string, first: string) => ({
          tenantId,
          userId,
          firstName: { en: first, hi: `${first} (hi)` },
          lastName: { en: 'Rao' },
          gender: Gender.FEMALE,
          ...BY,
        });
        await tx
          .insert(tenantUserProfiles)
          .values([
            profile(instA.tenantId, instA.userId, 'Meena'),
            profile(instB.tenantId, instA.userId, 'Wrong'),
            profile(instB.tenantId, outsider.userId, 'Outsider'),
          ]);
        await tx.insert(staffProfiles).values({
          tenantId: instA.tenantId,
          userId: instA.userId,
          membershipId: instA.membershipId,
          employeeId: 'EMP-360',
          designation: 'Admission officer',
          dateOfJoining: '2025-06-01',
          ...BY,
        });
        // The foreign key accepts any user; the assignee must still not be read from B.
        const [row] = await tx
          .insert(enquiries)
          .values({
            tenantId: instA.tenantId,
            studentName: 'Ravi Shah',
            classRequested: 'Class 2',
            parentName: 'Sunil Shah',
            parentPhone: '9012345679',
            assignedTo: outsider.userId,
            ...BY,
          })
          .returning({ id: enquiries.id });
        return row.id;
      });

      type Rows = {
        listEnquiries: { edges: { node: { id: string; assignedTo: string; assignee: unknown } }[] };
      };
      const own = await query<Rows>(LIST_ENQUIRY_ASSIGNEES, {
        filter: { assignedTo: instA.userId },
      });
      expect(own?.listEnquiries.edges).toEqual([
        {
          node: {
            id: a.enquiryId,
            assignedTo: instA.userId,
            assignee: {
              userId: instA.userId,
              firstName: { en: 'Meena', hi: 'Meena (hi)' },
              lastName: { en: 'Rao' },
              employeeId: 'EMP-360',
            },
          },
        },
      ]);

      const pointing = await query<Rows>(LIST_ENQUIRY_ASSIGNEES, {
        filter: { assignedTo: outsider.userId },
      });
      expect(pointing?.listEnquiries.edges).toEqual([
        { node: { id: pointingId, assignedTo: outsider.userId, assignee: null } },
      ]);
    });
  });

  describe('createEnquiry', () => {
    const input = (foreign: Record<string, string> = {}) => ({
      studentName: 'Rajesh Kumar',
      classRequested: 'Class 1',
      parentName: 'Suresh Kumar',
      parentPhone: '9876543210',
      parentRelation: 'MOTHER',
      academicYearId: a.yearId,
      assignedTo: instA.userId,
      ...foreign,
    });

    it('should store an enquiry for its own year and staff member', async () => {
      const data = await query<{ createEnquiry: { id: string } }>(CREATE_ENQUIRY, {
        input: input(),
      });

      const stored = await asAdmin((tx) =>
        tx
          .select({
            tenantId: enquiries.tenantId,
            academicYearId: enquiries.academicYearId,
            assignedTo: enquiries.assignedTo,
          })
          .from(enquiries)
          .where(eq(enquiries.id, data?.createEnquiry.id ?? '')),
      );
      expect(stored).toEqual([
        { tenantId: instA.tenantId, academicYearId: a.yearId, assignedTo: instA.userId },
      ]);
    });

    it.each([
      ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
      ['assignedTo', () => ({ assignedTo: instB.userId }), ErrorCode.MEMBERSHIP_NOT_FOUND],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, foreign, code) => {
      await refusesAndWritesNothing(CREATE_ENQUIRY, { input: input(foreign()) }, code);
    });
  });

  describe('updateEnquiry', () => {
    it('should refuse an enquiry of another institute and change neither institute', async () => {
      await refusesAndWritesNothing(
        UPDATE_ENQUIRY,
        { id: b.enquiryId, input: { notes: 'Called back' } },
        ErrorCode.ENQUIRY_NOT_FOUND,
      );
    });

    it('should refuse assignedTo of another institute and write nothing', async () => {
      await refusesAndWritesNothing(
        UPDATE_ENQUIRY,
        { id: a.enquiryId, input: { assignedTo: instB.userId } },
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      );
    });
  });

  describe('convertEnquiryToApplication', () => {
    it.each([
      ['enquiryId', () => ({ enquiryId: b.enquiryId }), ErrorCode.ENQUIRY_NOT_FOUND],
      ['standardId', () => ({ standardId: b.standardId }), ErrorCode.STANDARD_NOT_FOUND],
      ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, foreign, code) => {
      // Its own enquiry each time: a conversion that wrongly succeeds uses up the enquiry.
      const enquiryId = await asAdmin((tx) => addEnquiry(tx, instA));
      await refusesAndWritesNothing(
        CONVERT,
        { enquiryId, standardId: a.standardId, academicYearId: a.yearId, ...foreign() },
        code,
      );
    });
  });

  describe('createApplication', () => {
    const input = (foreign: Record<string, string> = {}) => ({
      enquiryId: a.enquiryId,
      academicYearId: a.yearId,
      standardId: a.standardId,
      sectionId: a.sectionId,
      formData: { studentName: 'Asha' },
      ...foreign,
    });

    it('should store an application for its own enquiry, year, class and section', async () => {
      const data = await query<{ createApplication: { id: string } }>(CREATE_APPLICATION, {
        input: input(),
      });

      const stored = await asAdmin((tx) =>
        tx
          .select({
            tenantId: admissionApplications.tenantId,
            enquiryId: admissionApplications.enquiryId,
            academicYearId: admissionApplications.academicYearId,
            standardId: admissionApplications.standardId,
            sectionId: admissionApplications.sectionId,
          })
          .from(admissionApplications)
          .where(eq(admissionApplications.id, data?.createApplication.id ?? '')),
      );
      expect(stored).toEqual([
        {
          tenantId: instA.tenantId,
          enquiryId: a.enquiryId,
          academicYearId: a.yearId,
          standardId: a.standardId,
          sectionId: a.sectionId,
        },
      ]);
    });

    it.each([
      ['enquiryId', () => ({ enquiryId: b.enquiryId }), ErrorCode.ENQUIRY_NOT_FOUND],
      ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
      ['standardId', () => ({ standardId: b.standardId }), ErrorCode.STANDARD_NOT_FOUND],
      ['sectionId', () => ({ sectionId: b.sectionId }), ErrorCode.SECTION_NOT_FOUND],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, foreign, code) => {
      await refusesAndWritesNothing(CREATE_APPLICATION, { input: input(foreign()) }, code);
    });
  });

  describe('updateApplication', () => {
    it('should refuse an application of another institute and change neither institute', async () => {
      await refusesAndWritesNothing(
        UPDATE_APPLICATION,
        { id: b.applicationId, input: { status: 'DOCUMENTS_PENDING' } },
        ErrorCode.APPLICATION_NOT_FOUND,
      );
    });

    it('should refuse sectionId of another institute and write nothing', async () => {
      const id = await asAdmin((tx) =>
        addApplication(tx, instA, a, AdmissionApplicationStatus.SUBMITTED),
      );
      await refusesAndWritesNothing(
        UPDATE_APPLICATION,
        { id, input: { status: 'DOCUMENTS_PENDING', sectionId: b.sectionId } },
        ErrorCode.SECTION_NOT_FOUND,
      );
    });
  });

  describe('approveApplication', () => {
    it.each([
      ['without a section', (): string | null => null],
      ['with its own section', (): string | null => a.sectionId],
    ] as const)('should refuse an application of another institute %s and start no enrolment', async (_case, sectionId) => {
      await refusesAndWritesNothing(
        APPROVE,
        { id: b.feePaidApplicationId, sectionId: sectionId() },
        ErrorCode.APPLICATION_NOT_FOUND,
      );
    });

    // The section is looked up within the application's class: a foreign one never matches.
    it('should refuse sectionId of another institute and start no enrolment', async () => {
      await refusesAndWritesNothing(
        APPROVE,
        { id: a.feePaidApplicationId, sectionId: b.sectionId },
        ErrorCode.SECTION_STANDARD_MISMATCH,
      );
    });
  });

  it('rejectApplication should refuse an application of another institute and change neither institute', async () => {
    await refusesAndWritesNothing(REJECT, { id: b.applicationId }, ErrorCode.APPLICATION_NOT_FOUND);
  });

  describe('addApplicationDocument', () => {
    it('should attach its own upload to its own application', async () => {
      const fileId = await asAdmin((tx) => addFile(tx, instA.tenantId, instA.userId, 'PENDING'));

      const data = await query<{ addApplicationDocument: { id: string } }>(ADD_DOCUMENT, {
        applicationId: a.applicationId,
        fileIds: [fileId],
      });

      const stored = await asAdmin((tx) =>
        tx
          .select({
            applicationId: applicationDocuments.applicationId,
            fileId: applicationDocumentFiles.fileId,
            status: files.status,
          })
          .from(applicationDocuments)
          .innerJoin(
            applicationDocumentFiles,
            eq(applicationDocumentFiles.documentId, applicationDocuments.id),
          )
          .innerJoin(files, eq(files.id, applicationDocumentFiles.fileId))
          .where(eq(applicationDocuments.id, data?.addApplicationDocument.id ?? '')),
      );
      expect(stored).toEqual([{ applicationId: a.applicationId, fileId, status: 'READY' }]);
    });

    it('should refuse an application of another institute and write nothing', async () => {
      await refusesAndWritesNothing(
        ADD_DOCUMENT,
        { applicationId: b.applicationId, fileIds: [a.pendingFileId] },
        ErrorCode.APPLICATION_NOT_FOUND,
      );
    });

    it.each([
      ['uploaded there', () => [b.pendingFileId]],
      ['uploaded there by the caller', () => [callerFileInB]],
      ['after its own upload', () => [a.pendingFileId, b.pendingFileId]],
      ['already attached there', () => [b.documentFileId]],
    ] as const)('should refuse an upload of another institute %s and write nothing', async (_case, fileIds) => {
      await refusesAndWritesNothing(
        ADD_DOCUMENT,
        { applicationId: a.applicationId, fileIds: fileIds() },
        ErrorCode.FILE_NOT_FOUND,
      );
    });
  });

  // No document-specific code exists: the generic NOT_FOUND, as for a document that is gone.
  it('removeApplicationDocument should refuse a document of another institute and change neither institute', async () => {
    await refusesAndWritesNothing(REMOVE_DOCUMENT, { id: b.documentId }, ErrorCode.NOT_FOUND);
  });
});
