/**
 * Impersonation — full resolver pipeline against real PostgreSQL + Redis.
 *
 * Covers the ROV-94 verification list that needs the real guards: token
 * claims and tenant scoping, single-use code, nested impersonation, session
 * end vs revocation (and the request after it), cross-reseller refusal and
 * the intra-institute ability check. OTP delivery and the role-rank matrix
 * are unit-tested in impersonation.service.spec.ts.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { authEvents, impersonationSessions, mkAdminCtx, withAdmin } from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInMemoryRedis,
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
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';

const REASON = 'integration test — impersonation verification list';

const ADMIN_START = `
  mutation Start($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
    adminStartImpersonation(
      targetUserId: $targetUserId
      targetTenantId: $targetTenantId
      reason: $reason
    ) { code requiresOtp sessionId }
  }
`;
const EXCHANGE = `mutation($code: String!) { exchangeImpersonationCode(code: $code) { accessToken } }`;
const IMPERSONATE_USER = `
  mutation($targetUserId: String!, $reason: String!) {
    impersonateUser(targetUserId: $targetUserId, reason: $reason) { code }
  }
`;
const MY_INSTITUTE = `query { myInstitute { id } }`;
const SESSION = `
  query($sessionId: String!) {
    adminImpersonationSessions(sessionId: $sessionId) { id status endedReason otpVerified }
  }
`;

interface Claims {
  sub: string;
  scope: string;
  tenantId: string;
  resellerId: string;
  isImpersonated: boolean;
  impersonatorId: string;
  impersonationSessionId: string;
  exp: number;
  iat: number;
}

function claimsOf(token: string): Claims {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Claims;
}

describe('Impersonation (integration)', () => {
  let result: IntegrationAppResult;
  let tenant: TestInstitute;
  let otherTenant: TestInstitute;
  let teacher: TestTeacher;
  let instituteAdminToken: string;
  let teacherToken: string;

  const platformAdminToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  /** Platform admin opens a session as `targetUserId` and returns the impersonation token. */
  async function impersonate(targetUserId: string): Promise<{ token: string; claims: Claims }> {
    const start = await gqlRequest(result.httpServer, {
      query: ADMIN_START,
      variables: { targetUserId, targetTenantId: tenant.tenantId, reason: REASON },
      token: platformAdminToken,
    });
    expect(start.errors).toBeUndefined();
    const code = start.data?.adminStartImpersonation.code;
    assert(code);
    const exchange = await gqlRequest(result.httpServer, { query: EXCHANGE, variables: { code } });
    expect(exchange.errors).toBeUndefined();
    const token = exchange.data?.exchangeImpersonationCode.accessToken;
    assert(token);
    return { token, claims: claimsOf(token) };
  }

  async function sessionRow(sessionId: string) {
    const response = await gqlRequest(result.httpServer, {
      query: SESSION,
      variables: { sessionId },
      token: platformAdminToken,
    });
    expect(response.errors).toBeUndefined();
    return response.data?.adminImpersonationSessions[0];
  }

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      // Codes and session tombstones are read back, so Redis must store them.
      overrides: [{ provide: REDIS_CLIENT, useValue: createInMemoryRedis() }],
    });
    tenant = await createTestInstitute(result.db);
    otherTenant = await createTestInstitute(result.db);
    teacher = await createTestTeacher(result.db, tenant.tenantId);
    instituteAdminToken = createInstituteToken({
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
    // Sessions and auth events reference the test users; they must go first.
    if (tenant && teacher && otherTenant) {
      const testUsers = [tenant.userId, teacher.userId, otherTenant.userId];
      await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), async (tx) => {
        await tx
          .delete(impersonationSessions)
          .where(eq(impersonationSessions.targetTenantId, tenant.tenantId));
        await tx.delete(authEvents).where(inArray(authEvents.userId, testUsers));
      });
    }
    if (teacher) await cleanupTestTeacher(result.db, teacher);
    if (otherTenant) await cleanupTestInstitute(result.db, otherTenant);
    if (tenant) await cleanupTestInstitute(result.db, tenant);
    await result?.close();
  });

  describe('platform → institute', () => {
    it('issues a 15-minute token for the target, scoped to the target institute', async () => {
      const { token, claims } = await impersonate(tenant.userId);

      expect(claims.sub).toBe(tenant.userId);
      expect(claims.scope).toBe('institute');
      expect(claims.tenantId).toBe(tenant.tenantId);
      expect(claims.resellerId).toBe(SEED_IDS.RESELLER_DIRECT);
      expect(claims.isImpersonated).toBe(true);
      expect(claims.impersonatorId).toBe(SEED_IDS.USER_ADMIN);
      expect(claims.exp - claims.iat).toBe(900);

      const mine = await gqlRequest(result.httpServer, { query: MY_INSTITUTE, token });
      expect(mine.errors).toBeUndefined();
      expect(mine.data?.myInstitute.id).toBe(tenant.tenantId);

      expect(await sessionRow(claims.impersonationSessionId)).toEqual({
        id: claims.impersonationSessionId,
        status: 'ACTIVE',
        endedReason: null,
        otpVerified: null,
      });
    });

    it('accepts a one-time code only once', async () => {
      const start = await gqlRequest(result.httpServer, {
        query: ADMIN_START,
        variables: {
          targetUserId: teacher.userId,
          targetTenantId: tenant.tenantId,
          reason: REASON,
        },
        token: platformAdminToken,
      });
      const code = start.data?.adminStartImpersonation.code;
      assert(code);

      const first = await gqlRequest(result.httpServer, { query: EXCHANGE, variables: { code } });
      expect(first.errors).toBeUndefined();

      const second = await gqlRequest(result.httpServer, { query: EXCHANGE, variables: { code } });
      expect(second.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_CODE_EXPIRED');
    });

    it('refuses to start another impersonation from an impersonation token', async () => {
      // The impersonated institute admin holds `impersonate User`; only the
      // impersonation flag stops this.
      const { token } = await impersonate(tenant.userId);

      const nested = await gqlRequest(result.httpServer, {
        query: IMPERSONATE_USER,
        variables: { targetUserId: teacher.userId, reason: REASON },
        token,
      });

      expect(nested.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(nested.errors?.[0]?.message).toBe(
        'Cannot start impersonation from an impersonation session',
      );
    });

    it('rejects the next request once the impersonator ends the session', async () => {
      const { token, claims } = await impersonate(teacher.userId);

      const end = await gqlRequest(result.httpServer, {
        query: `mutation($id: String!) { adminEndImpersonation(sessionId: $id) }`,
        variables: { id: claims.impersonationSessionId },
        token: platformAdminToken,
      });
      expect(end.errors).toBeUndefined();

      const after = await gqlRequest(result.httpServer, { query: MY_INSTITUTE, token });
      expect(after.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_ENDED');
      expect(await sessionRow(claims.impersonationSessionId)).toMatchObject({
        status: 'ENDED',
        endedReason: 'manual',
      });
    });

    it('issues no token for a code whose session was ended before the exchange', async () => {
      const first = await impersonate(teacher.userId);
      const start = await gqlRequest(result.httpServer, {
        query: ADMIN_START,
        variables: {
          targetUserId: teacher.userId,
          targetTenantId: tenant.tenantId,
          reason: REASON,
        },
        token: platformAdminToken,
      });
      const code = start.data?.adminStartImpersonation.code;
      assert(code);
      // Find the pending session through the list, newest first.
      const list = await gqlRequest(result.httpServer, {
        query: `query { adminImpersonationSessions(activeOnly: true, first: 100) { id targetUserId } }`,
        token: platformAdminToken,
      });
      const pending = list.data?.adminImpersonationSessions.find(
        (row: { id: string; targetUserId: string }) =>
          row.targetUserId === teacher.userId && row.id !== first.claims.impersonationSessionId,
      );
      assert(pending);
      await gqlRequest(result.httpServer, {
        query: `mutation($id: String!) { adminEndImpersonation(sessionId: $id) }`,
        variables: { id: pending.id },
        token: platformAdminToken,
      });

      const exchange = await gqlRequest(result.httpServer, {
        query: EXCHANGE,
        variables: { code },
      });

      expect(exchange.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_SESSION_INVALID');
    });
  });

  describe('session list', () => {
    it('leaves expired and ended sessions out of activeOnly', async () => {
      const live = await impersonate(teacher.userId);
      const expired = await impersonate(teacher.userId);
      await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), (tx) =>
        tx
          .update(impersonationSessions)
          .set({
            startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            expiresAt: new Date(Date.now() - 60 * 60 * 1000),
          })
          .where(eq(impersonationSessions.id, expired.claims.impersonationSessionId)),
      );

      const list = await gqlRequest(result.httpServer, {
        query: `query { adminImpersonationSessions(activeOnly: true, first: 100) { id status } }`,
        token: platformAdminToken,
      });

      expect(list.errors).toBeUndefined();
      const rows: { id: string; status: string }[] = list.data?.adminImpersonationSessions;
      expect(rows.map((row) => row.id)).toContain(live.claims.impersonationSessionId);
      expect(rows.map((row) => row.id)).not.toContain(expired.claims.impersonationSessionId);
      expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['ACTIVE']));

      const blocked = await gqlRequest(result.httpServer, {
        query: MY_INSTITUTE,
        token: expired.token,
      });
      expect(blocked.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_ENDED');
    });
  });

  describe('revocation by a third party', () => {
    it('lets the admin of the target institute revoke the session, which then rejects requests', async () => {
      const { token, claims } = await impersonate(teacher.userId);

      const revoke = await gqlRequest(result.httpServer, {
        query: `mutation($id: String!) { endImpersonation(sessionId: $id) }`,
        variables: { id: claims.impersonationSessionId },
        token: instituteAdminToken,
      });
      expect(revoke.errors).toBeUndefined();

      const after = await gqlRequest(result.httpServer, { query: MY_INSTITUTE, token });
      expect(after.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_ENDED');
      expect(await sessionRow(claims.impersonationSessionId)).toMatchObject({
        status: 'ENDED',
        endedReason: 'revoked',
      });
    });

    it('refuses the admin of another institute and a teacher of the same institute', async () => {
      const { token, claims } = await impersonate(tenant.userId);
      const END = `mutation($id: String!) { endImpersonation(sessionId: $id) }`;
      const variables = { id: claims.impersonationSessionId };

      const outsider = await gqlRequest(result.httpServer, {
        query: END,
        variables,
        token: createInstituteToken({
          sub: otherTenant.userId,
          tenantId: otherTenant.tenantId,
          membershipId: otherTenant.membershipId,
          roleId: otherTenant.roleId,
        }),
      });
      expect(outsider.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

      const noAbility = await gqlRequest(result.httpServer, {
        query: END,
        variables,
        token: teacherToken,
      });
      expect(noAbility.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

      const still = await gqlRequest(result.httpServer, { query: MY_INSTITUTE, token });
      expect(still.errors).toBeUndefined();
    });

    it('lets another platform user with the impersonate ability revoke it', async () => {
      const { claims } = await impersonate(teacher.userId);

      const revoke = await gqlRequest(result.httpServer, {
        query: `mutation($id: String!) { adminEndImpersonation(sessionId: $id) }`,
        variables: { id: claims.impersonationSessionId },
        // Neither party of the session: a second platform user.
        token: createPlatformToken({
          sub: otherTenant.userId,
          membershipId: randomUUID(),
          roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
        }),
      });

      expect(revoke.errors).toBeUndefined();
      expect(await sessionRow(claims.impersonationSessionId)).toMatchObject({
        endedReason: 'revoked',
      });
    });
  });

  describe('reseller → institute', () => {
    it('refuses a reseller whose token is for another reseller than the institute owner', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: `
          mutation Start($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
            resellerStartImpersonation(
              targetUserId: $targetUserId
              targetTenantId: $targetTenantId
              reason: $reason
            ) { code requiresOtp sessionId }
          }
        `,
        variables: {
          targetUserId: teacher.userId,
          targetTenantId: tenant.tenantId,
          reason: REASON,
        },
        token: createResellerToken({
          sub: randomUUID(),
          resellerId: randomUUID(),
          membershipId: randomUUID(),
          roleId: SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN,
        }),
      });

      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(response.errors?.[0]?.message).toBe('Institute does not belong to your reseller');
      expect(response.data).toBeNull();
    });
  });

  describe('intra-institute', () => {
    it('lets the institute admin impersonate a teacher without OTP', async () => {
      const start = await gqlRequest(result.httpServer, {
        query: IMPERSONATE_USER,
        variables: { targetUserId: teacher.userId, reason: REASON },
        token: instituteAdminToken,
      });
      expect(start.errors).toBeUndefined();
      const code = start.data?.impersonateUser.code;
      assert(code);

      const exchange = await gqlRequest(result.httpServer, {
        query: EXCHANGE,
        variables: { code },
      });
      const claims = claimsOf(exchange.data?.exchangeImpersonationCode.accessToken);
      expect(claims.sub).toBe(teacher.userId);
      expect(claims.impersonatorId).toBe(tenant.userId);
      expect(claims.tenantId).toBe(tenant.tenantId);
    });

    it('refuses a teacher, who has no impersonate ability', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: IMPERSONATE_USER,
        variables: { targetUserId: tenant.userId, reason: REASON },
        token: teacherToken,
      });

      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(response.data).toBeNull();
    });
  });
});
