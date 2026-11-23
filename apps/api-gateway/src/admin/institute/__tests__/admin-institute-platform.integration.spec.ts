/**
 * Platform reads and ownership changes of an institute: academic tree, attendance roll-up,
 * reseller reassignment and group assignment.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { withTestContext } from '@roviq/request-context';
import {
  cleanupTestInstitute,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';
import { AttendanceRepository } from '../../../institute/attendance/repositories/attendance.repository';
import { InstituteSetupService } from '../../../institute/management/seed/institute-setup.service';

const TREE = `query ($id: ID!) {
  adminGetInstituteAcademicTree(instituteId: $id) {
    instituteId
    academicYearId
    standards { id name sections { id name } subjects { id name } }
  }
}`;
const SUMMARY = `query ($date: String!) {
  adminAttendanceSummary(date: $date) {
    instituteId presentCount absentCount leaveCount lateCount sessionCount
  }
}`;
const REASSIGN = `mutation ($id: ID!, $resellerId: ID!) {
  adminReassignInstituteReseller(id: $id, newResellerId: $resellerId) { id resellerId }
}`;
const CREATE_GROUP = `mutation ($input: CreateInstituteGroupInput!) {
  adminCreateInstituteGroup(input: $input) { id }
}`;
const ASSIGN_GROUP = `mutation ($id: ID!, $groupId: ID!) {
  adminAssignInstituteGroup(id: $id, groupId: $groupId) { id groupId }
}`;

interface Tree {
  instituteId: string;
  academicYearId: string | null;
  standards: {
    id: string;
    name: Record<string, string>;
    sections: { id: string; name: Record<string, string> }[];
    subjects: { id: string; name: string }[];
  }[];
}

describe('Admin institute platform operations (integration)', () => {
  let result: IntegrationAppResult;
  let token: string;
  let institute: TestInstitute;
  let bare: TestInstitute;
  let reseller: TestReseller;
  let academicYearId: string;
  let standardsCreated: number;

  const tree = async (id: string) => {
    const res = await gqlRequest<{ adminGetInstituteAcademicTree: Tree }>(result.httpServer, {
      query: TREE,
      token,
      variables: { id },
    });
    expect(res.errors).toBeUndefined();
    return res.data?.adminGetInstituteAcademicTree;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    token = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });
    institute = await createTestInstitute(result.db);
    bare = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);

    const setup = result.app.get(InstituteSetupService);
    academicYearId = await setup.createFirstAcademicYear(institute.tenantId, institute.userId);
    const counts = await setup.seedAcademicStructure({
      instituteId: institute.tenantId,
      academicYearId,
      type: 'SCHOOL',
      departments: ['PRIMARY'],
      board: 'CBSE',
      actorId: institute.userId,
    });
    standardsCreated = counts.standardsCreated;
  });

  afterAll(async () => {
    // `institute` stays: its attendance session references the lecturer membership.
    await cleanupTestInstitute(result.db, bare);
    await result?.close();
  });

  it('should return the seeded standards with their sections and board subjects', async () => {
    const got = await tree(institute.tenantId);
    expect(got?.instituteId).toBe(institute.tenantId);
    expect(got?.academicYearId).toBe(academicYearId);
    expect(got?.standards).toHaveLength(standardsCreated);
    expect(standardsCreated).toBeGreaterThan(0);
    for (const standard of got?.standards ?? []) {
      expect(standard.sections.map((s) => s.name.en)).toEqual(['A', 'B', 'C', 'D']);
      expect(standard.subjects.length).toBeGreaterThan(0);
    }
  });

  it('should return an empty tree for an institute with no academic year', async () => {
    expect(await tree(bare.tenantId)).toEqual({
      instituteId: bare.tenantId,
      academicYearId: null,
      standards: [],
    });
  });

  it('should roll up one row per institute that held a session on the date', async () => {
    const got = await tree(institute.tenantId);
    const sectionId = got?.standards[0]?.sections[0]?.id;
    assert(sectionId);
    // Each run's institute is new, so its row on this date holds only this session.
    const date = '2031-07-15';
    const repo = result.app.get(AttendanceRepository);
    await withTestContext(
      () =>
        repo.createSession({
          sectionId,
          academicYearId,
          date,
          period: 1,
          subjectId: null,
          lecturerId: institute.membershipId,
        }),
      { tenantId: institute.tenantId, userId: institute.userId, scope: 'institute' },
    );

    const res = await gqlRequest<{
      adminAttendanceSummary: { instituteId: string; sessionCount: number }[];
    }>(result.httpServer, { query: SUMMARY, token, variables: { date } });
    expect(res.errors).toBeUndefined();
    const rows = res.data?.adminAttendanceSummary ?? [];
    expect(rows.filter((r) => r.instituteId === bare.tenantId)).toEqual([]);
    expect(rows.find((r) => r.instituteId === institute.tenantId)).toEqual({
      instituteId: institute.tenantId,
      presentCount: 0,
      absentCount: 0,
      leaveCount: 0,
      lateCount: 0,
      sessionCount: 1,
    });
  });

  it('should refuse a reseller that does not exist and move the institute to an active one', async () => {
    const missing = await gqlRequest(result.httpServer, {
      query: REASSIGN,
      token,
      variables: { id: bare.tenantId, resellerId: randomUUID() },
    });
    expect(missing.errors?.[0]?.extensions?.code).toBe('RESELLER_INVALID');

    const moved = await gqlRequest<{
      adminReassignInstituteReseller: { id: string; resellerId: string };
    }>(result.httpServer, {
      query: REASSIGN,
      token,
      variables: { id: bare.tenantId, resellerId: reseller.resellerId },
    });
    expect(moved.errors).toBeUndefined();
    expect(moved.data?.adminReassignInstituteReseller).toEqual({
      id: bare.tenantId,
      resellerId: reseller.resellerId,
    });
  });

  it('should refuse a group that does not exist and assign an existing one', async () => {
    const missing = await gqlRequest(result.httpServer, {
      query: ASSIGN_GROUP,
      token,
      variables: { id: bare.tenantId, groupId: randomUUID() },
    });
    expect(missing.errors?.[0]?.extensions?.code).toBe('INSTITUTE_GROUP_NOT_FOUND');

    const suffix = randomUUID().slice(0, 8);
    const group = await gqlRequest<{ adminCreateInstituteGroup: { id: string } }>(
      result.httpServer,
      {
        query: CREATE_GROUP,
        token,
        variables: { input: { name: `Trust ${suffix}`, code: `trust-${suffix}`, type: 'TRUST' } },
      },
    );
    expect(group.errors).toBeUndefined();
    const groupId = group.data?.adminCreateInstituteGroup.id;

    const assigned = await gqlRequest<{
      adminAssignInstituteGroup: { id: string; groupId: string };
    }>(result.httpServer, {
      query: ASSIGN_GROUP,
      token,
      variables: { id: bare.tenantId, groupId },
    });
    expect(assigned.errors).toBeUndefined();
    expect(assigned.data?.adminAssignInstituteGroup).toEqual({ id: bare.tenantId, groupId });
  });
});
