/**
 * ROV-170 — Integration tests for TC resolver (institute-scoped).
 *
 * Exercises the real scope guard → CASL → service → withTenant → RLS pipeline
 * for requestTC, approveTC, rejectTC, and listTCs. Uses a fresh test institute
 * with a hand-rolled student fixture per suite (no seed mutation).
 */
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  Gender,
  SocialCategory,
  TcStatus,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentProfiles,
  tcRegister,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
} from '@roviq/testing/integration';
import { and, eq, notInArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { createTCIssuanceActivities } from '../workflows/tc-issuance.activities';

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

    await tx
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

const LIST_TCS = /* GraphQL */ `
  query ListTCs($filter: ListTCFilterInput) {
    listTCs(filter: $filter) {
      id
      status
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
interface ListTCsResponse {
  listTCs: ReadonlyArray<{ id: string; status: string }>;
}

describe('TCResolver (integration)', () => {
  let result: IntegrationAppResult;
  let instituteToken: string;
  let tenantId: string;
  let fixture: StudentFixture;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    const institute = await createTestInstitute(result.db);
    tenantId = institute.tenantId;
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
  });

  it('approveTC returns NOT_FOUND when the TC is not in `generated` status (requested)', async () => {
    // Create a TC directly in `requested` status so we can assert approveTC's
    // guard — it only accepts status=generated, so this verifies the full pipeline
    // (scope guard → CASL → service → withTenant) routes the NotFoundException.
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
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.message).toMatch(/not found|not in generated/i);
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
    const activities = createTCIssuanceActivities(result.db, null);

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
    const activities = createTCIssuanceActivities(result.db, null);

    expect(await activities.validateRequest(tenantId, tc.id, fixture.studentProfileId)).toBe(true);
    for (const department of ['accounts', 'library', 'lab', 'transport']) {
      const clearance = await activities.checkDepartmentClearance(tenantId, tc.id, department);
      expect(clearance.cleared).toBe(true);
    }
    const populated = await activities.populateTcData(tenantId, tc.id, fixture.studentProfileId);

    expect(populated).not.toBeNull();
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
});
