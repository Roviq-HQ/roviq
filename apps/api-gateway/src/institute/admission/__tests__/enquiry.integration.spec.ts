/**
 * ROV-168 — Integration tests for Admission CRM: enquiries.
 *
 * Exercises the full InstituteScope → CASL → AdmissionService → withTenant →
 * RLS pipeline for enquiry CRUD + enquiry→application conversion. Uses a fresh
 * test institute per suite so no seeded data is mutated.
 */
import { randomUUID } from 'node:crypto';
import { AdmissionApplicationStatus, EnquirySource, EnquiryStatus } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  enquiries,
  mkAdminCtx,
  SYSTEM_USER_ID,
  standards,
  tenantSequences,
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
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

interface AdmissionFixture {
  academicYearId: string;
  standardId: string;
}

async function createAdmissionFixture(db: DrizzleDB, tenantId: string): Promise<AdmissionFixture> {
  const suffix = randomUUID().slice(0, 8);
  return withAdmin(db, mkAdminCtx('test:enquiry'), async (tx) => {
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: '2025-26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
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
        name: { en: `Class 1 ${suffix}` },
        numericOrder: 1,
        level: 'PRIMARY',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: standards.id });

    return { academicYearId: year.id, standardId: std.id };
  });
}

const CREATE_ENQUIRY = /* GraphQL */ `
  mutation CreateEnquiry($input: CreateEnquiryInput!) {
    createEnquiry(input: $input) {
      id
      studentName
      classRequested
      status
      parentPhone
      parentRelation
    }
  }
`;

const LIST_ENQUIRIES = /* GraphQL */ `
  query ListEnquiries($filter: EnquiryFilterInput) {
    listEnquiries(filter: $filter) {
      totalCount
      edges {
        cursor
        node {
          id
          studentName
          status
        }
      }
    }
  }
`;

const UPDATE_ENQUIRY = /* GraphQL */ `
  mutation UpdateEnquiry($id: ID!, $input: UpdateEnquiryInput!) {
    updateEnquiry(id: $id, input: $input) {
      id
      status
      followUpDate
      assignedTo
    }
  }
`;

const CONVERT_ENQUIRY = /* GraphQL */ `
  mutation ConvertEnquiry($enquiryId: ID!, $standardId: ID!, $academicYearId: ID!) {
    convertEnquiryToApplication(
      enquiryId: $enquiryId
      standardId: $standardId
      academicYearId: $academicYearId
    ) {
      id
      status
      enquiryId
    }
  }
`;

interface CreateEnquiryResponse {
  createEnquiry: {
    id: string;
    studentName: string;
    classRequested: string;
    status: string;
    parentPhone: string;
    parentRelation: string | null;
  };
}

interface ListEnquiriesResponse {
  listEnquiries: {
    totalCount: number;
    edges: ReadonlyArray<{
      cursor: string;
      node: { id: string; studentName: string; status: string };
    }>;
  };
}

interface UpdateEnquiryResponse {
  updateEnquiry: {
    id: string;
    status: string;
    followUpDate: string | null;
    assignedTo: string | null;
  };
}

interface ConvertEnquiryResponse {
  convertEnquiryToApplication: {
    id: string;
    status: string;
    enquiryId: string | null;
  };
}

const FAKE_RESELLER = {
  USER: '00000000-0000-7000-a000-000000000aaa',
  MEMBERSHIP: '00000000-0000-7000-a000-000000000aab',
  ROLE: '00000000-0000-7000-a000-000000000aac',
  RESELLER: RESELLER_DIRECT_ID,
} as const;

describe('Admission enquiries (integration)', () => {
  let result: IntegrationAppResult;
  let instituteToken: string;
  let fixture: AdmissionFixture;
  let instituteUserId: string;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    const institute = await createTestInstitute(result.db);
    instituteUserId = institute.userId;
    instituteToken = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    fixture = await createAdmissionFixture(result.db, institute.tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('createEnquiry: institute admin creates enquiry and gets persisted row', async () => {
    const response = await gqlRequest<CreateEnquiryResponse>(result.httpServer, {
      query: CREATE_ENQUIRY,
      token: instituteToken,
      variables: {
        input: {
          studentName: 'Rajesh Kumar',
          classRequested: 'Class 1',
          parentName: 'Suresh Kumar',
          parentPhone: '9876543210',
          parentRelation: 'MOTHER',
          source: EnquirySource.WALK_IN,
        },
      },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.createEnquiry.id).toBeTruthy();
    expect(response.data?.createEnquiry.studentName).toBe('Rajesh Kumar');
    expect(response.data?.createEnquiry.classRequested).toBe('Class 1');
    expect(response.data?.createEnquiry.status).toBe(EnquiryStatus.NEW);
    expect(response.data?.createEnquiry.parentPhone).toBe('9876543210');
    expect(response.data?.createEnquiry.parentRelation).toBe('MOTHER');
  });

  it('createEnquiry: refuses an enquiry without the contact person’s relationship', async () => {
    const request = gqlRequest<CreateEnquiryResponse>(result.httpServer, {
      query: CREATE_ENQUIRY,
      token: instituteToken,
      variables: {
        input: {
          studentName: 'No Relation',
          classRequested: 'Class 1',
          parentName: 'Unknown',
          parentPhone: '9876500001',
        },
      },
    });

    await expect(request).rejects.toThrow(/parentRelation.*was not provided/);
  });

  it('listEnquiries: returns the tenant-scoped enquiries', async () => {
    // Seed one to ensure list is non-empty if the create test ran first.
    await gqlRequest<CreateEnquiryResponse>(result.httpServer, {
      query: CREATE_ENQUIRY,
      token: instituteToken,
      variables: {
        input: {
          studentName: 'Anita Sharma',
          classRequested: 'Class 2',
          parentName: 'Ravi Sharma',
          parentPhone: '9123456780',
          parentRelation: 'MOTHER',
        },
      },
    });

    const response = await gqlRequest<ListEnquiriesResponse>(result.httpServer, {
      query: LIST_ENQUIRIES,
      token: instituteToken,
      variables: { filter: { first: 25 } },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.listEnquiries.totalCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(response.data?.listEnquiries.edges)).toBe(true);
    const names = response.data?.listEnquiries.edges.map((e) => e.node.studentName) ?? [];
    expect(names).toContain('Anita Sharma');
  });

  it('updateEnquiry: updates status, followUpDate, and assignedTo', async () => {
    const create = await gqlRequest<CreateEnquiryResponse>(result.httpServer, {
      query: CREATE_ENQUIRY,
      token: instituteToken,
      variables: {
        input: {
          studentName: 'Priya Mehta',
          classRequested: 'Class 3',
          parentName: 'Vijay Mehta',
          parentPhone: '9988776655',
          parentRelation: 'MOTHER',
        },
      },
    });
    const enquiryId = create.data?.createEnquiry.id;
    expect(enquiryId).toBeTruthy();

    const assignee = instituteUserId;
    const response = await gqlRequest<UpdateEnquiryResponse>(result.httpServer, {
      query: UPDATE_ENQUIRY,
      token: instituteToken,
      variables: {
        id: enquiryId,
        input: {
          status: EnquiryStatus.CONTACTED,
          followUpDate: '2026-05-15',
          assignedTo: assignee,
        },
      },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateEnquiry.id).toBe(enquiryId);
    expect(response.data?.updateEnquiry.status).toBe(EnquiryStatus.CONTACTED);
    expect(response.data?.updateEnquiry.followUpDate).toBe('2026-05-15');
    expect(response.data?.updateEnquiry.assignedTo).toBe(assignee);
  });

  it.each([
    ['a null student name', { studentName: null }],
    ['a blank class', { classRequested: '' }],
    ['a null parent name', { parentName: null }],
    ['a null parent phone', { parentPhone: null }],
    ['a 21-character class', { classRequested: 'Class 5 Science Grp A' }],
    ['a malformed email', { parentEmail: 'not-an-email' }],
  ])('updateEnquiry: refuses %s with VALIDATION_FAILED and changes nothing', async (_, input) => {
    const create = await gqlRequest<CreateEnquiryResponse>(result.httpServer, {
      query: CREATE_ENQUIRY,
      token: instituteToken,
      variables: {
        input: {
          studentName: 'Rhea Kapoor',
          classRequested: 'Class 4',
          parentName: 'Nisha Kapoor',
          parentPhone: '9988776644',
          parentRelation: 'MOTHER',
        },
      },
    });
    const enquiryId = create.data?.createEnquiry.id as string;
    expect(enquiryId).toBeTruthy();

    const response = await gqlRequest<UpdateEnquiryResponse>(result.httpServer, {
      query: UPDATE_ENQUIRY,
      token: instituteToken,
      variables: { id: enquiryId, input },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    const [row] = await withAdmin(result.db, mkAdminCtx('test:enquiry'), (tx) =>
      tx
        .select({
          studentName: enquiries.studentName,
          classRequested: enquiries.classRequested,
          parentName: enquiries.parentName,
          parentPhone: enquiries.parentPhone,
          parentEmail: enquiries.parentEmail,
        })
        .from(enquiries)
        .where(eq(enquiries.id, enquiryId)),
    );
    expect(row).toEqual({
      studentName: 'Rhea Kapoor',
      classRequested: 'Class 4',
      parentName: 'Nisha Kapoor',
      parentPhone: '9988776644',
      parentEmail: null,
    });
  });

  it('convertEnquiryToApplication: creates application and updates enquiry status', async () => {
    const create = await gqlRequest<CreateEnquiryResponse>(result.httpServer, {
      query: CREATE_ENQUIRY,
      token: instituteToken,
      variables: {
        input: {
          studentName: 'Kiran Patel',
          classRequested: 'Class 1',
          parentName: 'Manish Patel',
          parentPhone: '9012345678',
          parentRelation: 'MOTHER',
        },
      },
    });
    const enquiryId = create.data?.createEnquiry.id;
    expect(enquiryId).toBeTruthy();

    const convert = await gqlRequest<ConvertEnquiryResponse>(result.httpServer, {
      query: CONVERT_ENQUIRY,
      token: instituteToken,
      variables: {
        enquiryId,
        standardId: fixture.standardId,
        academicYearId: fixture.academicYearId,
      },
    });
    expect(convert.errors).toBeUndefined();
    expect(convert.data?.convertEnquiryToApplication.id).toBeTruthy();
    expect(convert.data?.convertEnquiryToApplication.status).toBe(
      AdmissionApplicationStatus.SUBMITTED,
    );
    expect(convert.data?.convertEnquiryToApplication.enquiryId).toBe(enquiryId);

    // Original enquiry now reflects conversion.
    const list = await gqlRequest<ListEnquiriesResponse>(result.httpServer, {
      query: LIST_ENQUIRIES,
      token: instituteToken,
      variables: { filter: { first: 100 } },
    });
    const converted = list.data?.listEnquiries.edges.find((e) => e.node.id === enquiryId);
    expect(converted?.node.status).toBe(EnquiryStatus.APPLICATION_SUBMITTED);
  });

  it('cross-scope rejection: reseller token on listEnquiries is FORBIDDEN', async () => {
    const resellerToken = createResellerToken({
      sub: FAKE_RESELLER.USER,
      resellerId: FAKE_RESELLER.RESELLER,
      membershipId: FAKE_RESELLER.MEMBERSHIP,
      roleId: FAKE_RESELLER.ROLE,
    });
    const response = await gqlRequest(result.httpServer, {
      query: LIST_ENQUIRIES,
      token: resellerToken,
      variables: { filter: { first: 10 } },
    });
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

describe('Enquiry numbers (integration)', () => {
  const CREATE_NUMBERED = /* GraphQL */ `
    mutation CreateEnquiry($input: CreateEnquiryInput!) {
      createEnquiry(input: $input) {
        enquiryNumber
      }
    }
  `;

  let result: IntegrationAppResult;
  let first: TestInstitute;
  let second: TestInstitute;

  const tokenOf = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  async function enquire(inst: TestInstitute, n: number): Promise<string> {
    const response = await gqlRequest<{ createEnquiry: { enquiryNumber: string } }>(
      result.httpServer,
      {
        query: CREATE_NUMBERED,
        token: tokenOf(inst),
        variables: {
          input: {
            studentName: `Numbered ${n}`,
            classRequested: 'Class 1',
            parentName: 'Parent',
            parentPhone: `98765${String(n).padStart(5, '0')}`,
            parentRelation: 'FATHER',
            source: EnquirySource.WALK_IN,
          },
        },
      },
    );
    expect(response.errors).toBeUndefined();
    return response.data?.createEnquiry.enquiryNumber as string;
  }

  async function counter(tenantId: string) {
    return withAdmin(result.db, mkAdminCtx('test:enquiry'), (tx) =>
      tx
        .select({ value: tenantSequences.currentValue, format: tenantSequences.formatTemplate })
        .from(tenantSequences)
        .where(
          and(eq(tenantSequences.tenantId, tenantId), eq(tenantSequences.sequenceName, 'enq_no')),
        ),
    );
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    first = await createTestInstitute(result.db);
    second = await createTestInstitute(result.db);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('a new institute needs no seeded series: its first enquiries are ENQ-000001 and ENQ-000002', async () => {
    expect(await counter(first.tenantId)).toEqual([]);

    expect(await enquire(first, 1)).toBe('ENQ-000001');
    expect(await enquire(first, 2)).toBe('ENQ-000002');

    expect(await counter(first.tenantId)).toEqual([{ value: 2n, format: 'ENQ-{value:06d}' }]);
  });

  it('another institute keeps its own counter', async () => {
    expect(await enquire(second, 3)).toBe('ENQ-000001');
    expect(await counter(second.tenantId)).toEqual([{ value: 1n, format: 'ENQ-{value:06d}' }]);
  });

  it('enquiries created at the same time on a new institute get ENQ-000001 to ENQ-000005', async () => {
    const third = await createTestInstitute(result.db);
    const numbers = await Promise.all([4, 5, 6, 7, 8].map((n) => enquire(third, n)));
    expect([...numbers].sort()).toEqual([
      'ENQ-000001',
      'ENQ-000002',
      'ENQ-000003',
      'ENQ-000004',
      'ENQ-000005',
    ]);
    expect(await counter(third.tenantId)).toEqual([{ value: 5n, format: 'ENQ-{value:06d}' }]);
  });

  it('a failed insert does not use up a number', async () => {
    const fresh = await createTestInstitute(result.db);
    const untouched = await counter(second.tenantId);
    expect(await enquire(fresh, 10)).toBe('ENQ-000001');
    expect(await enquire(fresh, 11)).toBe('ENQ-000002');

    // A row already holding the next number makes the insert fail on the unique index.
    const [blocker] = await withAdmin(result.db, mkAdminCtx('test:enquiry'), (tx) =>
      tx
        .insert(enquiries)
        .values({
          tenantId: fresh.tenantId,
          enquiryNumber: 'ENQ-000003',
          studentName: 'Blocker',
          classRequested: 'Class 1',
          parentName: 'Parent',
          parentPhone: '9876500098',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: enquiries.id }),
    );
    const enquiryCount = () =>
      withAdmin(result.db, mkAdminCtx('test:enquiry'), async (tx) => {
        const rows = await tx
          .select({ id: enquiries.id })
          .from(enquiries)
          .where(eq(enquiries.tenantId, fresh.tenantId));
        return rows.length;
      });
    const before = await enquiryCount();

    const failed = await gqlRequest<{ createEnquiry: { enquiryNumber: string } }>(
      result.httpServer,
      {
        query: CREATE_NUMBERED,
        token: tokenOf(fresh),
        variables: {
          input: {
            studentName: 'Refused by the index',
            classRequested: 'Class 1',
            parentName: 'Parent',
            parentPhone: '9876500012',
            parentRelation: 'FATHER',
          },
        },
      },
    );
    // The unique index refuses the insert; nothing maps that violation to a business code.
    expect(failed.errors?.[0]?.extensions?.code).toBe('INTERNAL_ERROR');
    expect(await counter(fresh.tenantId)).toEqual([{ value: 2n, format: 'ENQ-{value:06d}' }]);
    expect(await enquiryCount()).toBe(before);

    await withAdmin(result.db, mkAdminCtx('test:enquiry'), (tx) =>
      tx.update(enquiries).set({ enquiryNumber: null }).where(eq(enquiries.id, blocker.id)),
    );
    expect(await enquire(fresh, 13)).toBe('ENQ-000003');
    expect(await counter(fresh.tenantId)).toEqual([{ value: 3n, format: 'ENQ-{value:06d}' }]);
    expect(await counter(second.tenantId)).toEqual(untouched);
  });

  it('a class name longer than its column is refused before a number is taken', async () => {
    const fresh = await createTestInstitute(result.db);
    const response = await gqlRequest<{ createEnquiry: { enquiryNumber: string } }>(
      result.httpServer,
      {
        query: CREATE_NUMBERED,
        token: tokenOf(fresh),
        variables: {
          input: {
            studentName: 'Too long class',
            classRequested: 'Class 5 Science Section Alpha',
            parentName: 'Parent',
            parentPhone: '9876500099',
            parentRelation: 'FATHER',
          },
        },
      },
    );

    expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    expect(await counter(fresh.tenantId)).toEqual([]);
    expect(await enquire(fresh, 9)).toBe('ENQ-000001');
  });
});
