/**
 * ROV-170 — Integration tests for TC resolver (institute-scoped).
 *
 * Exercises the real scope guard → CASL → service → withTenant → RLS pipeline
 * for requestTC, approveTC, rejectTC, and listTCs. Uses a fresh test institute
 * with a hand-rolled student fixture per suite (no seed mutation).
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  type CbseTcData,
  Gender,
  SocialCategory,
  TcStatus,
} from '@roviq/common-types';
import {
  academicYears,
  certificateTemplates,
  type DrizzleDB,
  files,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  tcRegister,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import { TemporalClientService } from '@roviq/temporal';
import {
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createResellerToken,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
} from '@roviq/testing/integration';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { createTCIssuanceActivities } from '../workflows/tc-issuance.activities';
import { DEFAULT_TC_TASK_QUEUE } from '../workflows/tc-issuance.types';

const EMPTY_TC_DATA: CbseTcData = {
  studentName: '',
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

interface StudentFixture {
  studentProfileId: string;
  academicYearId: string;
}

async function createEnrolledStudent(
  db: DrizzleDB,
  tenantId: string,
  yearLabel = '2025-26',
): Promise<StudentFixture> {
  const suffix = randomUUID().slice(0, 8);

  return withAdmin(db, mkAdminCtx('test:tc'), async (tx) => {
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: yearLabel,
        startDate: `${yearLabel.slice(0, 4)}-04-01`,
        endDate: `${Number(yearLabel.slice(0, 4)) + 1}-03-31`,
        isActive: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: academicYears.id });

    const [std] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        level: 'PRIMARY',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: standards.id });

    const [section] = await tx
      .insert(sections)
      .values({
        tenantId,
        standardId: std.id,
        academicYearId: year.id,
        name: { en: 'A' },
        displayLabel: 'Class 5-A',
        capacity: 40,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: sections.id });

    const [user] = await tx
      .insert(users)
      .values({
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
        email: `tc_stu_${suffix}@test.local`,
        username: `tc_stu_${suffix}`,
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });

    await tx.insert(userProfiles).values({
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      lastName: { en: 'Kumar' },
      gender: Gender.MALE,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await tx.insert(tenantUserProfiles).values({
      tenantId: tenantId,
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      lastName: { en: 'Kumar' },
      gender: Gender.MALE,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student Role ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: roles.id });

    const [membership] = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        roleId: role.id,
        tenantId,
        abilities: [],
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: memberships.id });

    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        userId: user.id,
        membershipId: membership.id,
        admissionNumber: `TC-ADM-${suffix}`,
        admissionDate: '2025-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus: AcademicStatus.ENROLLED,
        socialCategory: SocialCategory.GENERAL,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: studentProfiles.id });

    await tx.insert(studentAcademics).values({
      tenantId,
      studentProfileId: profile.id,
      academicYearId: year.id,
      standardId: std.id,
      sectionId: section.id,
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });

    return { studentProfileId: profile.id, academicYearId: year.id };
  });
}

const FAKE = {
  USER: '00000000-0000-7000-a000-000000000eff',
  MEMBERSHIP: '00000000-0000-7000-a000-000000000efe',
  ROLE: '00000000-0000-7000-a000-000000000efd',
  RESELLER: RESELLER_DIRECT_ID,
} as const;

const REQUEST_TC = /* GraphQL */ `
  mutation RequestTC($input: RequestTCInput!) {
    requestTC(input: $input) {
      id
      status
      reason
    }
  }
`;

const APPROVE_TC = /* GraphQL */ `
  mutation ApproveTC($id: ID!) {
    approveTC(id: $id) {
      id
      status
    }
  }
`;

const REJECT_TC = /* GraphQL */ `
  mutation RejectTC($id: ID!, $reason: String!) {
    rejectTC(id: $id, reason: $reason) {
      id
      status
    }
  }
`;

const ISSUE_TC = /* GraphQL */ `
  mutation IssueTC($id: ID!) {
    issueTC(id: $id) {
      tcSerialNumber
    }
  }
`;

const REQUEST_DUPLICATE_TC = /* GraphQL */ `
  mutation RequestDuplicateTC($input: RequestDuplicateTCInput!) {
    requestDuplicateTC(input: $input) {
      id
      status
      isDuplicate
      originalTcId
    }
  }
`;

const ISSUE_DUPLICATE_TC = /* GraphQL */ `
  mutation IssueTC($id: ID!) {
    issueTC(id: $id) {
      id
      status
      tcSerialNumber
      isDuplicate
      tcData
    }
  }
`;

const LIST_TCS = /* GraphQL */ `
  query ListTCs($filter: ListTCFilterInput) {
    listTCs(filter: $filter) {
      id
      status
      standardName
    }
  }
`;

interface RequestTCResponse {
  requestTC: { id: string; status: string; reason: string };
}
interface ApproveTCResponse {
  approveTC: { id: string; status: string };
}
interface RejectTCResponse {
  rejectTC: { id: string; status: string };
}
interface IssueTCResponse {
  issueTC: { tcSerialNumber: string };
}
interface RequestDuplicateTCResponse {
  requestDuplicateTC: { id: string; status: string; isDuplicate: boolean; originalTcId: string };
}
interface IssueDuplicateTCResponse {
  issueTC: {
    id: string;
    status: string;
    tcSerialNumber: string;
    isDuplicate: boolean;
    tcData: Record<string, string | null>;
  };
}
interface ListTCsResponse {
  listTCs: ReadonlyArray<{
    id: string;
    status: string;
    standardName: Record<string, string> | null;
  }>;
}

describe('TCResolver (integration)', () => {
  let result: IntegrationAppResult;
  let instituteToken: string;
  let tenantId: string;
  let userId: string;
  let fixture: StudentFixture;
  const storage = new FakeStorageClient();
  const startWorkflow = vi.fn<TemporalClientService['startWorkflow']>();

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        {
          provide: TemporalClientService,
          useValue: createMock<TemporalClientService>({ startWorkflow }),
        },
      ],
    });
    const institute = await createTestInstitute(result.db);
    tenantId = institute.tenantId;
    userId = institute.userId;
    instituteToken = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    fixture = await createEnrolledStudent(result.db, tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  // uq_tc_register_open_request allows one TC in progress per student; each test starts with none.
  beforeEach(async () => {
    startWorkflow.mockReset();
    startWorkflow.mockResolvedValue('run-id');
    await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .update(tcRegister)
        .set({ status: TcStatus.CANCELLED })
        .where(
          and(
            eq(tcRegister.tenantId, tenantId),
            notInArray(tcRegister.status, [TcStatus.CANCELLED, TcStatus.ISSUED]),
          ),
        ),
    );
  });

  it('requestTC creates a tc_register row in requested status for an enrolled student', async () => {
    const response = await gqlRequest<RequestTCResponse>(result.httpServer, {
      query: REQUEST_TC,
      token: instituteToken,
      variables: {
        input: {
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          reason: 'Family relocating to another city',
        },
      },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.requestTC.id).toBeDefined();
    expect(response.data?.requestTC.status).toBe(TcStatus.REQUESTED);
    expect(response.data?.requestTC.reason).toBe('Family relocating to another city');
    const tcId = response.data?.requestTC.id;
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(startWorkflow).toHaveBeenCalledWith('TCIssuanceWorkflow', {
      taskQueue: DEFAULT_TC_TASK_QUEUE,
      workflowId: `tc-issuance-${tcId}`,
      workflowExecutionTimeout: '7 days',
      args: [
        {
          tenantId,
          tcRegisterId: tcId,
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          reason: 'Family relocating to another city',
          requestedBy: userId,
        },
      ],
    });
  });

  it('approveTC refuses a TC that is not in `generated` status (requested)', async () => {
    const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .insert(tcRegister)
        .values({
          tenantId,
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          tcSerialNumber: `TC-REQ-${Date.now()}`,
          status: TcStatus.REQUESTED,
          reason: 'Testing approve guard',
          requestedBy: SYSTEM_USER_ID,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: tcRegister.id }),
    );

    const response = await gqlRequest<ApproveTCResponse>(result.httpServer, {
      query: APPROVE_TC,
      token: instituteToken,
      variables: { id: tc.id },
    });
    expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejectTC transitions a requested TC to cancelled and persists the rejection reason', async () => {
    const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .insert(tcRegister)
        .values({
          tenantId,
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          tcSerialNumber: `TC-REQ-${Date.now()}-r`,
          status: TcStatus.REQUESTED,
          reason: 'To be rejected',
          requestedBy: SYSTEM_USER_ID,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: tcRegister.id }),
    );

    const response = await gqlRequest<RejectTCResponse>(result.httpServer, {
      query: REJECT_TC,
      token: instituteToken,
      variables: { id: tc.id, reason: 'Insufficient documentation submitted' },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.rejectTC.id).toBe(tc.id);
    // Schema has no `rejected` status — `cancelled` is the terminal pre-issuance state.
    expect(response.data?.rejectTC.status).toBe(TcStatus.CANCELLED);

    // Verify rejection_reason was merged into tc_data.
    const rows = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .select({ tcData: tcRegister.tcData })
        .from(tcRegister)
        .where(eq(tcRegister.id, tc.id))
        .limit(1),
    );
    const tcData = rows[0]?.tcData as Record<string, unknown> | null;
    expect(tcData?.rejection_reason).toBe('Insufficient documentation submitted');
  });

  it('the workflow activities leave a cancelled TC cancelled', async () => {
    const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .insert(tcRegister)
        .values({
          tenantId,
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          tcSerialNumber: `TC-REQ-${Date.now()}-c`,
          status: TcStatus.CANCELLED,
          reason: 'Cancelled before the worker picked it up',
          requestedBy: SYSTEM_USER_ID,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: tcRegister.id }),
    );
    const activities = createTCIssuanceActivities(result.db);

    const validated = await activities.validateRequest(tenantId, tc.id, fixture.studentProfileId);
    const clearance = await activities.checkDepartmentClearance(tenantId, tc.id, 'accounts');
    const populated = await activities.populateTcData(tenantId, tc.id, fixture.studentProfileId);

    expect(validated).toBe(false);
    expect(clearance.cleared).toBe(false);
    expect(populated).toBeNull();
    const rows = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .select({
          status: tcRegister.status,
          clearances: tcRegister.clearances,
          tcData: tcRegister.tcData,
        })
        .from(tcRegister)
        .where(eq(tcRegister.id, tc.id))
        .limit(1),
    );
    expect(rows[0]?.status).toBe(TcStatus.CANCELLED);
    expect(rows[0]?.tcData).toEqual({});
    const clearances = rows[0]?.clearances as Record<string, unknown> | null;
    expect(clearances?.accounts).toBeUndefined();
  });

  it('the workflow activities take a requested TC to generated', async () => {
    const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx
        .insert(tcRegister)
        .values({
          tenantId,
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          tcSerialNumber: `TC-REQ-${Date.now()}-g`,
          status: TcStatus.REQUESTED,
          reason: 'Transfer',
          requestedBy: SYSTEM_USER_ID,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: tcRegister.id }),
    );
    const activities = createTCIssuanceActivities(result.db);

    expect(await activities.validateRequest(tenantId, tc.id, fixture.studentProfileId)).toBe(true);
    for (const department of ['accounts', 'library', 'lab', 'transport']) {
      const clearance = await activities.checkDepartmentClearance(tenantId, tc.id, department);
      expect(clearance.cleared).toBe(true);
    }
    const populated = await activities.populateTcData(tenantId, tc.id, fixture.studentProfileId);

    expect(populated?.tcData.classLastStudied).toBe('Class 5');
    const rows = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx.select({ status: tcRegister.status }).from(tcRegister).where(eq(tcRegister.id, tc.id)),
    );
    expect(rows[0]?.status).toBe(TcStatus.GENERATED);
  });

  it('listTCs returns only the current tenant’s TCs', async () => {
    const response = await gqlRequest<ListTCsResponse>(result.httpServer, {
      query: LIST_TCS,
      token: instituteToken,
    });
    expect(response.errors).toBeUndefined();
    expect(Array.isArray(response.data?.listTCs)).toBe(true);
    // Must contain at least the requested TC from the first test.
    expect(response.data?.listTCs.length).toBeGreaterThan(0);
    // The class comes from the student's academic record for the TC's year.
    expect(response.data?.listTCs[0]?.standardName).toEqual({ en: 'Class 5' });
  });

  it('requestTC refuses a second request while one is in progress', async () => {
    const request = () =>
      gqlRequest<RequestTCResponse>(result.httpServer, {
        query: REQUEST_TC,
        token: instituteToken,
        variables: {
          input: {
            studentProfileId: fixture.studentProfileId,
            academicYearId: fixture.academicYearId,
            reason: 'Family relocating to another city',
          },
        },
      });

    const first = await request();
    const second = await request();

    expect(first.errors).toBeUndefined();
    expect(second.errors?.[0]?.extensions?.code).toBe('TC_ALREADY_REQUESTED');
  });

  it('requestTC refuses an academic year of another institute, and so does the table', async () => {
    const other = await createTestInstitute(result.db);
    const otherYear = await createEnrolledStudent(result.db, other.tenantId);

    const response = await gqlRequest<RequestTCResponse>(result.httpServer, {
      query: REQUEST_TC,
      token: instituteToken,
      variables: {
        input: {
          studentProfileId: fixture.studentProfileId,
          academicYearId: otherYear.academicYearId,
          reason: 'Family relocating to another city',
        },
      },
    });
    expect(response.errors?.[0]?.extensions?.code).toBe('ACADEMIC_YEAR_NOT_FOUND');

    const insert = withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
      tx.insert(tcRegister).values({
        tenantId,
        studentProfileId: fixture.studentProfileId,
        academicYearId: otherYear.academicYearId,
        tcSerialNumber: `TC-REQ-${randomUUID()}`,
        status: TcStatus.REQUESTED,
        reason: 'Year of another institute',
        requestedBy: SYSTEM_USER_ID,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      }),
    );
    await expect(insert).rejects.toMatchObject({
      cause: { constraint: 'tc_register_academic_year_tenant_fkey' },
    });
  });

  it('requestTC answers a reason outside 10 to 200 characters with a validation error', async () => {
    for (const reason of ['Too short', 'x'.repeat(201)]) {
      const response = await gqlRequest<RequestTCResponse>(result.httpServer, {
        query: REQUEST_TC,
        token: instituteToken,
        variables: {
          input: {
            studentProfileId: fixture.studentProfileId,
            academicYearId: fixture.academicYearId,
            reason,
          },
        },
      });
      expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    }
  });

  it('reseller token is rejected with FORBIDDEN on requestTC', async () => {
    const resellerToken = createResellerToken({
      sub: FAKE.USER,
      resellerId: FAKE.RESELLER,
      membershipId: FAKE.MEMBERSHIP,
      roleId: FAKE.ROLE,
    });
    const response = await gqlRequest(result.httpServer, {
      query: REQUEST_TC,
      token: resellerToken,
      variables: {
        input: {
          studentProfileId: fixture.studentProfileId,
          academicYearId: fixture.academicYearId,
          reason: 'cross-scope attempt',
        },
      },
    });
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
  // ROV-173 compliance #8: the counter resets per academic year, so the year label keeps serials unique.
  it('issueTC numbers TCs per academic year as TC/<year>/NNNN, unique across years', async () => {
    const nextYear = await createEnrolledStudent(result.db, tenantId, '2026-27');
    const approvedTc = async (target: StudentFixture) => {
      const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .insert(tcRegister)
          .values({
            tenantId,
            studentProfileId: target.studentProfileId,
            academicYearId: target.academicYearId,
            tcSerialNumber: `TC-TMP-${randomUUID()}`,
            status: TcStatus.APPROVED,
            reason: 'Serial numbering test',
            requestedBy: SYSTEM_USER_ID,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: tcRegister.id }),
      );
      return tc.id;
    };
    const issue = async (id: string) => {
      const response = await gqlRequest<IssueTCResponse>(result.httpServer, {
        query: ISSUE_TC,
        token: instituteToken,
        variables: { id },
      });
      expect(response.errors).toBeUndefined();
      return response.data?.issueTC.tcSerialNumber;
    };

    // Issued one at a time: a student holds one TC in progress.
    expect(await issue(await approvedTc(fixture))).toBe('TC/2025-26/0001');
    expect(await issue(await approvedTc(fixture))).toBe('TC/2025-26/0002');
    expect(await issue(await approvedTc(nextYear))).toBe('TC/2026-27/0001');
  });

  describe('duplicate TC', () => {
    async function issuedOriginal(serial: string) {
      const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .insert(tcRegister)
          .values({
            tenantId,
            studentProfileId: fixture.studentProfileId,
            academicYearId: fixture.academicYearId,
            tcSerialNumber: serial,
            status: TcStatus.ISSUED,
            reason: 'Family relocated to another city',
            requestedBy: SYSTEM_USER_ID,
            issuedAt: new Date(),
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: tcRegister.id }),
      );
      return tc.id;
    }

    const requestDuplicate = (originalTcId: string) =>
      gqlRequest<RequestDuplicateTCResponse>(result.httpServer, {
        query: REQUEST_DUPLICATE_TC,
        token: instituteToken,
        variables: { input: { originalTcId, reason: 'Original lost, FIR 123/2026' } },
      });

    const issue = (id: string) =>
      gqlRequest<IssueDuplicateTCResponse>(result.httpServer, {
        query: ISSUE_DUPLICATE_TC,
        token: instituteToken,
        variables: { id },
      });

    const studentRow = () =>
      withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .select({
            academicStatus: studentProfiles.academicStatus,
            tcIssued: studentProfiles.tcIssued,
            tcNumber: studentProfiles.tcNumber,
            dateOfLeaving: studentProfiles.dateOfLeaving,
          })
          .from(studentProfiles)
          .where(eq(studentProfiles.id, fixture.studentProfileId))
          .limit(1),
      );

    it('issues duplicates as <original>-D1, -D2 and leaves the student untouched', async () => {
      const serial = `TC/DUP/${randomUUID().slice(0, 8)}`;
      const originalId = await issuedOriginal(serial);
      const studentBefore = await studentRow();

      const first = await requestDuplicate(originalId);
      expect(first.errors).toBeUndefined();
      const { id: firstId = '', ...requested } = first.data?.requestDuplicateTC ?? {};
      expect(requested).toEqual({
        status: TcStatus.DUPLICATE_REQUESTED,
        isDuplicate: true,
        originalTcId: originalId,
      });
      const issuedFirst = await issue(firstId);
      expect(issuedFirst.errors).toBeUndefined();
      expect(issuedFirst.data?.issueTC.status).toBe(TcStatus.DUPLICATE_ISSUED);
      expect(issuedFirst.data?.issueTC.tcSerialNumber).toBe(`${serial}-D1`);
      expect(issuedFirst.data?.issueTC.tcData.dateOfIssue).toBe(
        new Date().toISOString().split('T')[0],
      );

      const second = await requestDuplicate(originalId);
      expect(second.errors).toBeUndefined();
      const issuedSecond = await issue(second.data?.requestDuplicateTC.id ?? '');
      expect(issuedSecond.errors).toBeUndefined();
      expect(issuedSecond.data?.issueTC.tcSerialNumber).toBe(`${serial}-D2`);

      expect(await studentRow()).toEqual(studentBefore);

      // An issued duplicate is terminal: issuing it again is refused.
      const again = await issue(firstId);
      expect(again.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('refuses a second duplicate request while one is open', async () => {
      const originalId = await issuedOriginal(`TC/DUP/${randomUUID().slice(0, 8)}`);

      const first = await requestDuplicate(originalId);
      const second = await requestDuplicate(originalId);

      expect(first.errors).toBeUndefined();
      expect(second.errors?.[0]?.extensions?.code).toBe('TC_ALREADY_REQUESTED');
    });

    it('refuses a duplicate of a TC that is not issued', async () => {
      const [approved] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .insert(tcRegister)
          .values({
            tenantId,
            studentProfileId: fixture.studentProfileId,
            academicYearId: fixture.academicYearId,
            tcSerialNumber: `TC-TMP-${randomUUID()}`,
            status: TcStatus.APPROVED,
            reason: 'Not issued yet',
            requestedBy: SYSTEM_USER_ID,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: tcRegister.id }),
      );

      const response = await requestDuplicate(approved.id);

      expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('approveTC refuses a duplicate request', async () => {
      const originalId = await issuedOriginal(`TC/DUP/${randomUUID().slice(0, 8)}`);
      const dup = await requestDuplicate(originalId);

      const response = await gqlRequest<ApproveTCResponse>(result.httpServer, {
        query: APPROVE_TC,
        token: instituteToken,
        variables: { id: dup.data?.requestDuplicateTC.id },
      });

      expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('rejectTC cancels a duplicate request, which then cannot be issued', async () => {
      const originalId = await issuedOriginal(`TC/DUP/${randomUUID().slice(0, 8)}`);
      const dup = await requestDuplicate(originalId);
      const dupId = dup.data?.requestDuplicateTC.id ?? '';

      const rejected = await gqlRequest<RejectTCResponse>(result.httpServer, {
        query: REJECT_TC,
        token: instituteToken,
        variables: { id: dupId, reason: 'Original TC was found by the guardian' },
      });
      expect(rejected.errors).toBeUndefined();
      expect(rejected.data?.rejectTC.status).toBe(TcStatus.CANCELLED);

      const issued = await issue(dupId);
      expect(issued.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');

      // The original is free for a new duplicate request once the open one is cancelled.
      const next = await requestDuplicate(originalId);
      expect(next.errors).toBeUndefined();
    });
  });

  describe('TC PDF', () => {
    const TC_FIELDS = 'id status tcSerialNumber verificationUrl pdf { id url }';
    interface TcPdfFields {
      id: string;
      status: string;
      tcSerialNumber: string;
      verificationUrl: string | null;
      pdf: { id: string; url: string | null } | null;
    }
    const DOWNLOAD = 'mutation ($id: ID!) { fileDownloadUrl(fileId: $id) }';
    const VERIFY =
      'query ($token: String!) { verifyTC(token: $token) { serialNumber isValid studentName isDuplicate issuedOn } }';

    const insertTc = async (values: {
      status: TcStatus;
      studentName?: string;
      verificationToken?: string;
    }) => {
      const [tc] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .insert(tcRegister)
          .values({
            tenantId,
            studentProfileId: fixture.studentProfileId,
            academicYearId: fixture.academicYearId,
            tcSerialNumber: `TC-TMP-${randomUUID()}`,
            status: values.status,
            reason: 'Family is moving to another city',
            tcData: { ...EMPTY_TC_DATA, studentName: values.studentName ?? 'Asha Verma' },
            verificationToken: values.verificationToken,
            issuedAt: values.status === TcStatus.ISSUED ? new Date() : null,
            requestedBy: SYSTEM_USER_ID,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: tcRegister.id }),
      );
      return tc.id;
    };
    const issue = (id: string) =>
      gqlRequest<{ issueTC: TcPdfFields }>(result.httpServer, {
        query: `mutation ($id: ID!) { issueTC(id: $id) { ${TC_FIELDS} } }`,
        token: instituteToken,
        variables: { id },
      });
    const tokenOf = (url: string | null) => url?.split('/').pop() ?? '';

    it('issueTC stores the PDF as a READY TC_PDF file that only an explicit request downloads', async () => {
      const response = await issue(await insertTc({ status: TcStatus.APPROVED }));
      expect(response.errors).toBeUndefined();
      const tc = response.data?.issueTC;
      assert(tc?.pdf);
      expect(tc.status).toBe(TcStatus.ISSUED);
      // Sensitive purpose: the file reference never carries a URL.
      expect(tc.pdf.url).toBeNull();
      expect(tokenOf(tc.verificationUrl)).toMatch(/^[A-Za-z0-9_-]{32}$/);

      const [file] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .select()
          .from(files)
          .where(eq(files.id, tc.pdf?.id ?? '')),
      );
      expect(file.purpose).toBe('TC_PDF');
      expect(file.status).toBe('READY');
      expect(file.visibility).toBe('PRIVATE');
      expect(file.tenantId).toBe(tenantId);
      const body = await storage.get('private', file.objectKey);
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.length).toBe(Number(file.sizeBytes));

      const download = await gqlRequest<{ fileDownloadUrl: string }>(result.httpServer, {
        query: DOWNLOAD,
        token: instituteToken,
        variables: { id: tc.pdf.id },
      });
      expect(download.errors).toBeUndefined();
      expect(download.data?.fileDownloadUrl).toContain(file.objectKey);
    });

    it('a teacher, another institute and a reseller cannot download the PDF', async () => {
      const response = await issue(await insertTc({ status: TcStatus.APPROVED }));
      const fileId = response.data?.issueTC.pdf?.id;
      assert(fileId);

      const teacher = await createTestTeacher(result.db, tenantId);
      const other = await createTestInstitute(result.db);
      const tokens = {
        teacher: createInstituteToken({
          sub: teacher.userId,
          tenantId,
          membershipId: teacher.membershipId,
          roleId: teacher.roleId,
        }),
        otherInstitute: createInstituteToken({
          sub: other.userId,
          tenantId: other.tenantId,
          membershipId: other.membershipId,
          roleId: other.roleId,
        }),
        reseller: createResellerToken({
          sub: randomUUID(),
          resellerId: RESELLER_DIRECT_ID,
          membershipId: randomUUID(),
          roleId: randomUUID(),
        }),
      };
      const codeFor = async (token: string) => {
        const download = await gqlRequest(result.httpServer, {
          query: DOWNLOAD,
          token,
          variables: { id: fileId },
        });
        expect(download.data?.fileDownloadUrl).toBeUndefined();
        return download.errors?.[0]?.extensions?.code;
      };

      expect(await codeFor(tokens.teacher)).toBe('FILE_NOT_FOUND');
      expect(await codeFor(tokens.otherInstitute)).toBe('FILE_NOT_FOUND');
      expect(await codeFor(tokens.reseller)).toBe('FORBIDDEN');
    });

    it('verifyTC answers anyone holding the token, and only with the verification fields', async () => {
      const response = await issue(await insertTc({ status: TcStatus.APPROVED }));
      const tc = response.data?.issueTC;
      assert(tc);
      const verify = (token: string) =>
        gqlRequest<{
          verifyTC: {
            serialNumber: string;
            isValid: boolean;
            studentName: string;
            isDuplicate: boolean;
            issuedOn: string;
          } | null;
        }>(result.httpServer, { query: VERIFY, variables: { token } });

      const valid = await verify(tokenOf(tc.verificationUrl));
      expect(valid.errors).toBeUndefined();
      expect(valid.data?.verifyTC).toEqual({
        serialNumber: tc.tcSerialNumber,
        isValid: true,
        studentName: 'Asha Verma',
        isDuplicate: false,
        issuedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()),
      });

      expect((await verify('x'.repeat(32))).data?.verifyTC).toBeNull();
      expect((await verify("' OR 1=1 --")).data?.verifyTC).toBeNull();

      await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx.update(tcRegister).set({ status: TcStatus.CANCELLED }).where(eq(tcRegister.id, tc.id)),
      );
      expect((await verify(tokenOf(tc.verificationUrl))).data?.verifyTC?.isValid).toBe(false);
    });

    it('verify_tc cannot be called by the institute role', async () => {
      await expect(
        withTenant(result.db, mkInstituteCtx(tenantId, 'test:tc'), (tx) =>
          tx.execute(sql`SELECT * FROM verify_tc(${'x'.repeat(32)})`),
        ),
      ).rejects.toThrow();
    });

    it('issueTC refuses a TC whose text no bundled font can print, and leaves it approved', async () => {
      const id = await insertTc({ status: TcStatus.APPROVED, studentName: 'தமிழ் செல்வன்' });

      const response = await issue(id);

      expect(response.errors?.[0]?.extensions?.code).toBe('PDF_UNSUPPORTED_SCRIPT');
      const [row] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx.select({ status: tcRegister.status }).from(tcRegister).where(eq(tcRegister.id, id)),
      );
      expect(row.status).toBe(TcStatus.APPROVED);
    });

    it('generateTCPdf renders the PDF of an issued TC that has none, once', async () => {
      const id = await insertTc({
        status: TcStatus.ISSUED,
        verificationToken: randomUUID().replace(/-/g, ''),
      });
      const generate = () =>
        gqlRequest<{ generateTCPdf: TcPdfFields }>(result.httpServer, {
          query: `mutation ($id: ID!) { generateTCPdf(id: $id) { ${TC_FIELDS} } }`,
          token: instituteToken,
          variables: { id },
        });

      const first = await generate();
      expect(first.errors).toBeUndefined();
      const fileId = first.data?.generateTCPdf.pdf?.id;
      assert(fileId);
      expect((await generate()).data?.generateTCPdf.pdf?.id).toBe(fileId);

      const notIssued = await gqlRequest(result.httpServer, {
        query: 'mutation ($id: ID!) { generateTCPdf(id: $id) { id } }',
        token: instituteToken,
        variables: { id: await insertTc({ status: TcStatus.APPROVED }) },
      });
      expect(notIssued.errors?.[0]?.extensions?.code).toBe('PDF_NOT_READY');
    });
  });

  describe('certificate PDF', () => {
    it('issueCertificate stores a CERTIFICATE_PDF built from the template text as plain text', async () => {
      const [template] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx
          .insert(certificateTemplates)
          .values({
            tenantId,
            type: 'BONAFIDE_CERTIFICATE',
            name: 'Bonafide',
            // Markup and Typst code in institute-authored text must print as text.
            templateContent:
              '<p>Certified that <b>{{studentName}}</b> is a student here.</p><p>#panic("x") {{purpose}}</p>',
            fieldsSchema: {},
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: certificateTemplates.id }),
      );
      const requested = await gqlRequest<{ requestCertificate: { id: string } }>(
        result.httpServer,
        {
          query:
            'mutation ($input: RequestCertificateInput!) { requestCertificate(input: $input) { id } }',
          token: instituteToken,
          variables: {
            input: {
              templateId: template.id,
              studentProfileId: fixture.studentProfileId,
              purpose: 'Passport application',
            },
          },
        },
      );
      expect(requested.errors).toBeUndefined();
      const id = requested.data?.requestCertificate.id;
      assert(id);

      const issued = await gqlRequest<{
        issueCertificate: { status: string; pdf: { id: string; url: string | null } | null };
      }>(result.httpServer, {
        query: 'mutation ($id: ID!) { issueCertificate(id: $id) { status pdf { id url } } }',
        token: instituteToken,
        variables: { id },
      });

      expect(issued.errors).toBeUndefined();
      const pdf = issued.data?.issueCertificate.pdf;
      assert(pdf);
      expect(issued.data?.issueCertificate.status).toBe('ISSUED');
      expect(pdf.url).toBeNull();
      const [file] = await withAdmin(result.db, mkAdminCtx('test:tc'), (tx) =>
        tx.select().from(files).where(eq(files.id, pdf.id)),
      );
      expect(file.purpose).toBe('CERTIFICATE_PDF');
      expect(file.status).toBe('READY');
      const body = await storage.get('private', file.objectKey);
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  it.each([
    [
      'getCertificateTemplateFields',
      'query ($id: ID!) { getCertificateTemplateFields(templateId: $id) }',
    ],
    ['getCertificate', 'query ($id: ID!) { getCertificate(id: $id) { id } }'],
    ['getTCDetails', 'query ($id: ID!) { getTCDetails(id: $id) { id } }'],
    ['approveTC', 'mutation ($id: ID!) { approveTC(id: $id) { id } }'],
  ])('%s refuses an id that is not a UUID as bad input, not an internal error', async (_op, query) => {
    const response = await gqlRequest(result.httpServer, {
      query,
      token: instituteToken,
      variables: { id: 'not-a-uuid' },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
  });
});
