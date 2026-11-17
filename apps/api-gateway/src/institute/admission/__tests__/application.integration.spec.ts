/**
 * ROV-168 — Integration tests for Admission CRM: applications + statistics.
 *
 * Exercises the full InstituteScope → CASL → AdmissionService → withTenant →
 * RLS pipeline for application lifecycle and the admissionStatistics funnel.
 *
 * `@temporalio/client` is replaced so `approveApplication` runs its real code
 * path without a live Temporal server; the enrol activity is called directly.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionApplicationStatus,
  AdmissionType,
  REJECTION_REASON_MAX_LENGTH,
  SocialCategory,
} from '@roviq/common-types';
import {
  academicYears,
  admissionApplications,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentProfiles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import {
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createPlatformToken,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import type { IdentityService } from '../../../auth/identity.service';
import { createStudentAdmissionActivities } from '../workflows/student-admission.activities';

const temporal = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock('@temporalio/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@temporalio/client')>();
  class FakeTemporalClient {
    workflow = { start: temporal.start };
  }
  return {
    ...actual,
    Client: FakeTemporalClient,
    Connection: { connect: vi.fn(() => Promise.resolve({ close: vi.fn() })) },
  };
});

interface AdmissionFixture {
  academicYearId: string;
  standardId: string;
  submittedApplicationId: string;
  offerAcceptedApplicationId: string;
  rejectableApplicationId: string;
  feePaidApplicationId: string;
  enrollableApplicationId: string;
  studentProfileId: string;
  sectionId: string;
  otherStandardSectionId: string;
}

async function createAdmissionFixture(
  db: DrizzleDB,
  tenantId: string,
  actorId: string,
  membershipId: string,
): Promise<AdmissionFixture> {
  const suffix = randomUUID().slice(0, 8);
  return withAdmin(db, mkAdminCtx('test:application'), async (tx) => {
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

    const [submitted] = await tx
      .insert(admissionApplications)
      .values({
        tenantId,
        academicYearId: year.id,
        standardId: std.id,
        formData: { studentName: `Submitted ${suffix}` },
        status: AdmissionApplicationStatus.SUBMITTED,
        isRteApplication: false,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: admissionApplications.id });

    const [offerAccepted] = await tx
      .insert(admissionApplications)
      .values({
        tenantId,
        academicYearId: year.id,
        standardId: std.id,
        formData: { studentName: `OfferAccepted ${suffix}` },
        status: AdmissionApplicationStatus.OFFER_ACCEPTED,
        isRteApplication: false,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: admissionApplications.id });

    const insertApplication = async (label: string, status: AdmissionApplicationStatus) => {
      const [row] = await tx
        .insert(admissionApplications)
        .values({
          tenantId,
          academicYearId: year.id,
          standardId: std.id,
          formData: { studentName: `${label} ${suffix}` },
          status,
          isRteApplication: false,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: admissionApplications.id });
      return row.id;
    };

    const [otherStd] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: `Class 2 ${suffix}` },
        numericOrder: 2,
        level: 'PRIMARY',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: standards.id });

    const insertSection = async (standardId: string) => {
      const [row] = await tx
        .insert(sections)
        .values({
          tenantId,
          academicYearId: year.id,
          standardId,
          name: { en: `A ${suffix}` },
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: sections.id });
      return row.id;
    };

    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        userId: actorId,
        membershipId,
        admissionNumber: `ADM-${suffix}`,
        admissionDate: '2025-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus: AcademicStatus.ENROLLED,
        socialCategory: SocialCategory.GENERAL,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: studentProfiles.id });

    return {
      academicYearId: year.id,
      standardId: std.id,
      submittedApplicationId: submitted.id,
      offerAcceptedApplicationId: offerAccepted.id,
      rejectableApplicationId: await insertApplication(
        'Rejectable',
        AdmissionApplicationStatus.SUBMITTED,
      ),
      feePaidApplicationId: await insertApplication('FeePaid', AdmissionApplicationStatus.FEE_PAID),
      enrollableApplicationId: await insertApplication(
        'Enrollable',
        AdmissionApplicationStatus.FEE_PAID,
      ),
      studentProfileId: profile.id,
      sectionId: await insertSection(std.id),
      otherStandardSectionId: await insertSection(otherStd.id),
    };
  });
}

const LIST_APPLICATIONS = /* GraphQL */ `
  query ListApplications($filter: ApplicationFilterInput) {
    listApplications(filter: $filter) {
      totalCount
      edges {
        cursor
        node {
          id
          status
          academicYearId
          standardId
        }
      }
    }
  }
`;

const UPDATE_APPLICATION = /* GraphQL */ `
  mutation UpdateApplication($id: ID!, $input: UpdateApplicationInput!) {
    updateApplication(id: $id, input: $input) {
      id
      status
    }
  }
`;

const APPROVE_APPLICATION = /* GraphQL */ `
  mutation ApproveApplication($id: ID!, $sectionId: ID) {
    approveApplication(id: $id, sectionId: $sectionId) {
      id
      status
      sectionId
    }
  }
`;

const REJECT_APPLICATION = /* GraphQL */ `
  mutation RejectApplication($id: ID!, $reason: String) {
    rejectApplication(id: $id, reason: $reason) {
      id
      status
      rejectionReason
      rejectedAt
      formData
    }
  }
`;

const ADMISSION_STATISTICS = /* GraphQL */ `
  query AdmissionStatistics {
    admissionStatistics {
      totalEnquiries
      totalApplications
      funnel {
        stage
        count
      }
      enquiryToApplicationRate
      applicationToEnrolledRate
    }
  }
`;

interface ListApplicationsResponse {
  listApplications: {
    totalCount: number;
    edges: ReadonlyArray<{
      cursor: string;
      node: {
        id: string;
        status: string;
        academicYearId: string;
        standardId: string;
      };
    }>;
  };
}

interface UpdateApplicationResponse {
  updateApplication: { id: string; status: string };
}

interface RejectApplicationResponse {
  rejectApplication: {
    id: string;
    status: string;
    rejectionReason: string | null;
    rejectedAt: string | null;
    formData: Record<string, unknown>;
  };
}

interface ApproveApplicationResponse {
  approveApplication: { id: string; status: string; sectionId: string | null };
}

interface AdmissionStatisticsResponse {
  admissionStatistics: {
    totalEnquiries: number;
    totalApplications: number;
    funnel: ReadonlyArray<{ stage: string; count: number }>;
    enquiryToApplicationRate: number;
    applicationToEnrolledRate: number;
  };
}

const FAKE_PLATFORM = {
  USER: '00000000-0000-7000-a000-000000000bbb',
  MEMBERSHIP: '00000000-0000-7000-a000-000000000bbc',
  ROLE: '00000000-0000-7000-a000-000000000bbd',
} as const;

describe('Admission applications (integration)', () => {
  let result: IntegrationAppResult;
  let instituteToken: string;
  let fixture: AdmissionFixture;
  let tenantId: string;
  let actorId: string;

  async function loadApplication(id: string) {
    const [row] = await withAdmin(result.db, mkAdminCtx('test:application'), (tx) =>
      tx.select().from(admissionApplications).where(eq(admissionApplications.id, id)),
    );
    assert(row);
    return row;
  }

  beforeEach(() => {
    temporal.start.mockReset();
    temporal.start.mockResolvedValue(undefined);
  });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    const institute = await createTestInstitute(result.db);
    instituteToken = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    tenantId = institute.tenantId;
    actorId = institute.userId;
    fixture = await createAdmissionFixture(
      result.db,
      institute.tenantId,
      institute.userId,
      institute.membershipId,
    );
  });

  afterAll(async () => {
    await result?.close();
  });

  it('listApplications: returns tenant applications', async () => {
    const response = await gqlRequest<ListApplicationsResponse>(result.httpServer, {
      query: LIST_APPLICATIONS,
      token: instituteToken,
      variables: { filter: { first: 50 } },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.listApplications.totalCount).toBeGreaterThanOrEqual(2);
    const ids = response.data?.listApplications.edges.map((e) => e.node.id) ?? [];
    expect(ids).toContain(fixture.submittedApplicationId);
    expect(ids).toContain(fixture.offerAcceptedApplicationId);
  });

  it('updateApplication: valid status transition submitted → documents_pending', async () => {
    const response = await gqlRequest<UpdateApplicationResponse>(result.httpServer, {
      query: UPDATE_APPLICATION,
      token: instituteToken,
      variables: {
        id: fixture.submittedApplicationId,
        input: { status: AdmissionApplicationStatus.DOCUMENTS_PENDING },
      },
    });
    expect(response.errors).toBeUndefined();
    expect(response.data?.updateApplication.id).toBe(fixture.submittedApplicationId);
    expect(response.data?.updateApplication.status).toBe(
      AdmissionApplicationStatus.DOCUMENTS_PENDING,
    );
  });

  it('approveApplication: refuses to enrol without a section', async () => {
    const response = await gqlRequest<ApproveApplicationResponse>(result.httpServer, {
      query: APPROVE_APPLICATION,
      token: instituteToken,
      variables: { id: fixture.feePaidApplicationId },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
    expect(temporal.start).not.toHaveBeenCalled();
  });

  it('approveApplication: refuses a section from another class', async () => {
    const response = await gqlRequest<ApproveApplicationResponse>(result.httpServer, {
      query: APPROVE_APPLICATION,
      token: instituteToken,
      variables: { id: fixture.feePaidApplicationId, sectionId: fixture.otherStandardSectionId },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
    expect(temporal.start).not.toHaveBeenCalled();
    const row = await loadApplication(fixture.feePaidApplicationId);
    expect(row.sectionId).toBeNull();
  });

  it('approveApplication: saves the section, starts the workflow, leaves the application FEE_PAID', async () => {
    const response = await gqlRequest<ApproveApplicationResponse>(result.httpServer, {
      query: APPROVE_APPLICATION,
      token: instituteToken,
      variables: { id: fixture.feePaidApplicationId, sectionId: fixture.sectionId },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.approveApplication).toEqual({
      id: fixture.feePaidApplicationId,
      status: AdmissionApplicationStatus.FEE_PAID,
      sectionId: fixture.sectionId,
    });
    expect(temporal.start).toHaveBeenCalledWith('StudentAdmissionWorkflow', {
      taskQueue: 'student-admission',
      workflowId: `student-admission-${fixture.feePaidApplicationId}`,
      workflowExecutionTimeout: '5 minutes',
      args: [{ applicationId: fixture.feePaidApplicationId, tenantId, actorId }],
    });
    const row = await loadApplication(fixture.feePaidApplicationId);
    expect(row.status).toBe(AdmissionApplicationStatus.FEE_PAID);
    expect(row.sectionId).toBe(fixture.sectionId);
    expect(row.studentProfileId).toBeNull();
  });

  it('approveApplication: a repeat approval while the workflow runs is not an error', async () => {
    const workflowId = `student-admission-${fixture.feePaidApplicationId}`;
    temporal.start.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        'Workflow execution already started',
        workflowId,
        'StudentAdmissionWorkflow',
      ),
    );

    const response = await gqlRequest<ApproveApplicationResponse>(result.httpServer, {
      query: APPROVE_APPLICATION,
      token: instituteToken,
      variables: { id: fixture.feePaidApplicationId, sectionId: fixture.sectionId },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.approveApplication.status).toBe(AdmissionApplicationStatus.FEE_PAID);
  });

  it('approveApplication: refuses an application that has not paid the fee', async () => {
    const response = await gqlRequest<ApproveApplicationResponse>(result.httpServer, {
      query: APPROVE_APPLICATION,
      token: instituteToken,
      variables: { id: fixture.offerAcceptedApplicationId },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
    expect(temporal.start).not.toHaveBeenCalled();
  });

  it('updateApplication: refuses ENROLLED so enrolment cannot bypass the workflow', async () => {
    const response = await gqlRequest<UpdateApplicationResponse>(result.httpServer, {
      query: UPDATE_APPLICATION,
      token: instituteToken,
      variables: {
        id: fixture.feePaidApplicationId,
        input: { status: AdmissionApplicationStatus.ENROLLED },
      },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
    const row = await loadApplication(fixture.feePaidApplicationId);
    expect(row.status).toBe(AdmissionApplicationStatus.FEE_PAID);
  });

  it('updateApplicationEnrolled activity: enrols once, links the student, publishes one event', async () => {
    const eventBus = result.app.get(EventBusService);
    const emit = vi.spyOn(eventBus, 'emit');
    const activities = createStudentAdmissionActivities(
      result.db,
      eventBus,
      createMock<IdentityService>(),
    );
    const enrol = () =>
      activities.updateApplicationEnrolled(
        fixture.enrollableApplicationId,
        tenantId,
        fixture.studentProfileId,
        actorId,
      );

    await enrol();
    // Temporal retries an activity whose result it never recorded.
    await enrol();

    const row = await loadApplication(fixture.enrollableApplicationId);
    expect(row.status).toBe(AdmissionApplicationStatus.ENROLLED);
    expect(row.studentProfileId).toBe(fixture.studentProfileId);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(EVENT_PATTERNS.APPLICATION.status_changed, {
      applicationId: fixture.enrollableApplicationId,
      oldStatus: AdmissionApplicationStatus.FEE_PAID,
      newStatus: AdmissionApplicationStatus.ENROLLED,
      tenantId,
    });
    emit.mockRestore();
  });

  it('updateApplicationEnrolled activity: fails without writing when the application is not FEE_PAID', async () => {
    const activities = createStudentAdmissionActivities(
      result.db,
      result.app.get(EventBusService),
      createMock<IdentityService>(),
    );

    await expect(
      activities.updateApplicationEnrolled(
        fixture.offerAcceptedApplicationId,
        tenantId,
        fixture.studentProfileId,
        actorId,
      ),
    ).rejects.toThrow(/is OFFER_ACCEPTED, expected FEE_PAID/);
    const row = await loadApplication(fixture.offerAcceptedApplicationId);
    expect(row.status).toBe(AdmissionApplicationStatus.OFFER_ACCEPTED);
    expect(row.studentProfileId).toBeNull();
  });

  it('rejectApplication: stores the reason and timestamp in dedicated columns', async () => {
    const response = await gqlRequest<RejectApplicationResponse>(result.httpServer, {
      query: REJECT_APPLICATION,
      token: instituteToken,
      variables: { id: fixture.rejectableApplicationId, reason: '  Seats full for Class 1  ' },
    });

    expect(response.errors).toBeUndefined();
    const rejected = response.data?.rejectApplication;
    assert(rejected);
    expect(rejected.status).toBe(AdmissionApplicationStatus.REJECTED);
    expect(rejected.rejectionReason).toBe('Seats full for Class 1');
    expect(rejected.rejectedAt).not.toBeNull();
    expect(Object.keys(rejected.formData)).toEqual(['studentName']);
  });

  it('rejectApplication: refuses a reason longer than the column', async () => {
    const response = await gqlRequest<RejectApplicationResponse>(result.httpServer, {
      query: REJECT_APPLICATION,
      token: instituteToken,
      variables: {
        id: fixture.submittedApplicationId,
        reason: 'x'.repeat(REJECTION_REASON_MAX_LENGTH + 1),
      },
    });

    expect(response.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
    const row = await loadApplication(fixture.submittedApplicationId);
    expect(row.status).not.toBe(AdmissionApplicationStatus.REJECTED);
  });

  it('admissionStatistics: returns funnel counts with submitted applications present', async () => {
    const response = await gqlRequest<AdmissionStatisticsResponse>(result.httpServer, {
      query: ADMISSION_STATISTICS,
      token: instituteToken,
    });
    expect(response.errors).toBeUndefined();
    const stats = response.data?.admissionStatistics;
    expect(stats).toBeDefined();
    expect(typeof stats?.totalEnquiries).toBe('number');
    expect(typeof stats?.totalApplications).toBe('number');
    expect(stats?.totalApplications).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(stats?.funnel)).toBe(true);
    // Funnel must contain the canonical stages.
    const stages = stats?.funnel.map((f) => f.stage) ?? [];
    expect(stages).toContain(AdmissionApplicationStatus.SUBMITTED);
    expect(stages).toContain(AdmissionApplicationStatus.ENROLLED);
    // Every count is a non-negative number.
    for (const entry of stats?.funnel ?? []) {
      expect(entry.count).toBeGreaterThanOrEqual(0);
    }
    expect(stats?.enquiryToApplicationRate).toBeGreaterThanOrEqual(0);
    expect(stats?.applicationToEnrolledRate).toBeGreaterThanOrEqual(0);
  });

  it('cross-scope rejection: platform token on listApplications is FORBIDDEN', async () => {
    const platformToken = createPlatformToken({
      sub: FAKE_PLATFORM.USER,
      membershipId: FAKE_PLATFORM.MEMBERSHIP,
      roleId: FAKE_PLATFORM.ROLE,
    });
    const response = await gqlRequest(result.httpServer, {
      query: LIST_APPLICATIONS,
      token: platformToken,
      variables: { filter: { first: 10 } },
    });
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
