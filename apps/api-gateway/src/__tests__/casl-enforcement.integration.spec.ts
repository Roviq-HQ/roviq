/**
 * CASL `@CheckAbility` enforcement — integration tests.
 *
 * Boots the full Nest app once, creates a fresh test institute with an
 * admin (manage:all) and a teacher (limited class_teacher abilities), and
 * asserts that the AbilityGuard rejects mutations the teacher does not
 * have permission for. Also includes a positive admin path to guard
 * against false-positive guard behavior (a misconfigured guard could
 * reject everyone, hiding bugs).
 *
 * The CheckAbility guard fires BEFORE the service runs, so negative
 * tests can target non-existent IDs without setting up rows — the
 * FORBIDDEN response is returned before the service ever sees the input.
 */

import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../app/app.module';

const FAKE_ID = '00000000-0000-7000-a000-00000000dead';

describe('CASL @CheckAbility enforcement', () => {
  let result: IntegrationAppResult;
  let tenant: TestInstitute;
  let teacher: TestTeacher;
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(result.db);
    teacher = await createTestTeacher(result.db, tenant.tenantId);

    adminToken = createInstituteToken({
      sub: tenant.userId,
      tenantId: tenant.tenantId,
      membershipId: tenant.membershipId,
      roleId: tenant.roleId,
    });
    teacherToken = createInstituteToken({
      sub: teacher.userId,
      tenantId: tenant.tenantId,
      membershipId: teacher.membershipId,
      roleId: teacher.roleId,
    });
  });

  afterAll(async () => {
    if (teacher) await cleanupTestTeacher(result.db, teacher);
    if (tenant) await cleanupTestInstitute(result.db, tenant);
    await result?.close();
  });

  describe('Positive admin path (false-positive guard)', () => {
    it('admin (manage:all) can read institutes — guard does NOT reject', async () => {
      // Sanity check: a misconfigured AbilityGuard could reject every
      // request, making the negative tests below pass for the wrong
      // reason. Verify the admin token, which has manage:all on every
      // membership, is allowed through the guard for a known-good query.
      const response = await gqlRequest(result.httpServer, {
        query: `query { institutes { totalCount } }`,
        token: adminToken,
      });
      if (response.errors) {
        expect(response.errors[0]?.extensions?.code).not.toBe('FORBIDDEN');
      }
    });
  });

  describe('Standard mutations', () => {
    it('teacher cannot create a standard (no create:Standard ability)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `
          mutation CreateStandard($input: CreateStandardInput!) {
            createStandard(input: $input) { id }
          }
        `,
        variables: {
          input: {
            academicYearId: FAKE_ID,
            name: { en: 'Test Standard' },
            numericOrder: 1,
          },
        },
        token: teacherToken,
      });
      expect(response.errors).toBeDefined();
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('teacher cannot delete a standard (no delete:Standard ability)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `mutation { deleteStandard(id: "${FAKE_ID}") }`,
        token: teacherToken,
      });
      expect(response.errors).toBeDefined();
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('Institute mutations', () => {
    it('teacher cannot update institute info (no update_info:Institute ability)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `
          mutation UpdateInstituteInfo($id: ID!, $input: UpdateInstituteInfoInput!) {
            updateInstituteInfo(id: $id, input: $input) { id }
          }
        `,
        variables: {
          id: FAKE_ID,
          input: { version: 1, name: { en: 'Hacked' } },
        },
        token: teacherToken,
      });
      expect(response.errors).toBeDefined();
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('teacher cannot delete an institute (no delete:Institute ability)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `mutation { deleteInstitute(id: "${FAKE_ID}") }`,
        token: teacherToken,
      });
      expect(response.errors).toBeDefined();
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });
  describe('Notification config', () => {
    const UPDATE = `
      mutation Update($input: UpdateNotificationConfigInput!) {
        updateNotificationConfig(input: $input) { notificationType }
      }
    `;
    const input = { notificationType: 'ATTENDANCE', emailEnabled: false };

    it('teacher cannot change tenant-wide notification channels (no update_config:Institute)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: UPDATE,
        variables: { input },
        token: teacherToken,
      });
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('teacher can still read the notification config', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `query { notificationConfigs { notificationType } }`,
        token: teacherToken,
      });
      expect(response.errors).toBeUndefined();
    });

    it('admin can change notification channels', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: UPDATE,
        variables: { input },
        token: adminToken,
      });
      expect(response.errors).toBeUndefined();
      expect(response.data?.updateNotificationConfig.notificationType).toBe('ATTENDANCE');
    });
  });

  describe('Platform roles', () => {
    const supportToken = createPlatformToken({
      sub: FAKE_ID,
      membershipId: FAKE_ID,
      roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
    });
    const platformAdminToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: FAKE_ID,
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

    it('platform_support (read-only) can list resellers', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `query { adminListResellers { totalCount } }`,
        token: supportToken,
      });
      expect(response.errors).toBeUndefined();
    });

    it('platform_support cannot suspend a reseller (no suspend:Reseller)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `mutation { adminSuspendReseller(resellerId: "${FAKE_ID}") }`,
        token: supportToken,
      });
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('platform_support cannot replay or discard a dead-lettered message (no replay:DlqMessage)', async () => {
      const replay = await gqlRequest(result.httpServer, {
        query: `mutation { adminReplayDlqMessage(id: "${FAKE_ID}") { id } }`,
        token: supportToken,
      });
      expect(replay.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

      const discard = await gqlRequest(result.httpServer, {
        query: `mutation { adminDiscardDlqMessage(id: "${FAKE_ID}") { id } }`,
        token: supportToken,
      });
      expect(discard.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('platform_support can list users through the class-level guard chain', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `query { adminListUsers { totalCount } }`,
        token: supportToken,
      });
      expect(response.errors).toBeUndefined();
    });

    it('platform_admin (manage:all) passes the same guards', async () => {
      const list = await gqlRequest(result.httpServer, {
        query: `query { adminListResellers { totalCount } }`,
        token: platformAdminToken,
      });
      expect(list.errors).toBeUndefined();

      const discard = await gqlRequest(result.httpServer, {
        query: `mutation { adminDiscardDlqMessage(id: "${FAKE_ID}") { id } }`,
        token: platformAdminToken,
      });
      expect(discard.errors?.[0]?.extensions?.code).not.toBe('FORBIDDEN');
    });
  });

  describe('Reseller impersonation', () => {
    const START = `
      mutation Start($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
        resellerStartImpersonation(
          targetUserId: $targetUserId
          targetTenantId: $targetTenantId
          reason: $reason
        ) { code }
      }
    `;
    const variables = {
      targetUserId: FAKE_ID,
      targetTenantId: FAKE_ID,
      reason: 'integration test — impersonation ability enforcement',
    };

    it('reseller_viewer cannot start impersonation (no impersonate:User)', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: START,
        variables,
        token: createResellerToken({
          sub: FAKE_ID,
          resellerId: SEED_IDS.RESELLER_DIRECT,
          membershipId: FAKE_ID,
          roleId: SEED_IDS.ROLE_RESELLER_VIEWER,
        }),
      });
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('reseller_support_admin passes the ability guard', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: START,
        variables,
        token: createResellerToken({
          sub: FAKE_ID,
          resellerId: SEED_IDS.RESELLER_DIRECT,
          membershipId: FAKE_ID,
          roleId: SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN,
        }),
      });
      // The fake target fails later in the service, not at the guard.
      expect(response.errors?.[0]?.extensions?.code).not.toBe('FORBIDDEN');
    });
  });
});
