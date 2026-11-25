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
import type { ResellerSystemRoleName } from '@roviq/common-types';
import {
  authEvents,
  impersonationSessions,
  mkAdminCtx,
  phoneNumbers,
  platformMemberships,
  provisionResellerSystemRoles,
  resellerMemberships,
  roles,
  withAdmin,
} from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  cleanupTestTeacher,
  createInMemoryRedis,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';
import { ImpersonationService } from '../impersonation.service';

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
    adminImpersonationSessions(sessionId: $sessionId) { id status endedReason otpVerifiedAt }
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
  impersonationReadOnly?: boolean;
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

  const redis = createInMemoryRedis();

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

  /**
   * Make a live session overdue. Only `expires_at` may move, and only earlier: the
   * database refuses to change when a session started (ROV-102).
   */
  async function expireNow(sessionId: string): Promise<void> {
    await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), (tx) =>
      tx
        .update(impersonationSessions)
        .set({ expiresAt: sql`${impersonationSessions.startedAt}` })
        .where(eq(impersonationSessions.id, sessionId)),
    );
  }

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      // Codes and session tombstones are read back, so Redis must store them.
      overrides: [{ provide: REDIS_CLIENT, useValue: redis }],
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
    // Sessions reference the test users; they must go first.
    if (tenant && teacher && otherTenant) {
      await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), async (tx) => {
        await tx
          .delete(impersonationSessions)
          .where(eq(impersonationSessions.targetTenantId, tenant.tenantId));
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
        otpVerifiedAt: null,
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
      await expireNow(expired.claims.impersonationSessionId);

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

  describe('expiry sweep', () => {
    it('closes an overdue session as expired and records one impersonation_end', async () => {
      const { claims } = await impersonate(teacher.userId);
      const sessionId = claims.impersonationSessionId;
      await expireNow(sessionId);
      const service = result.module.get(ImpersonationService);

      await service.expireOverdueSessions();
      // A second sweep must not record the session again.
      await service.expireOverdueSessions();

      expect(await sessionRow(sessionId)).toMatchObject({
        status: 'EXPIRED',
        endedReason: 'expired',
      });
      const events = await vi.waitFor(async () => {
        const rows = await withAdmin(
          result.db,
          mkAdminCtx('test:impersonation-integration'),
          (tx) =>
            tx
              .select()
              .from(authEvents)
              .where(
                and(
                  eq(authEvents.eventType, 'IMPERSONATION_END'),
                  sql`${authEvents.metadata}->>'session_id' = ${sessionId}`,
                ),
              ),
        );
        expect(rows).toHaveLength(1);
        return rows;
      });
      expect(events[0]).toMatchObject({
        userId: SEED_IDS.USER_ADMIN,
        scope: 'platform',
        tenantId: tenant.tenantId,
        metadata: { session_id: sessionId, ended_reason: 'expired' },
      });
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

  describe('platform support → institute, view-only (ROV-183)', () => {
    const WRITE = `mutation { updateMyPreferredLocale(input: { locale: "hi" }) }`;
    let supportMembershipId: string;

    beforeAll(async () => {
      // A second platform user holding the read-only support role.
      const [row] = await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), (tx) =>
        tx
          .insert(platformMemberships)
          .values({
            userId: otherTenant.userId,
            roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
            createdBy: otherTenant.userId,
            updatedBy: otherTenant.userId,
          })
          .returning({ id: platformMemberships.id }),
      );
      supportMembershipId = row.id;
    });

    afterAll(async () => {
      await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), (tx) =>
        tx.delete(platformMemberships).where(eq(platformMemberships.id, supportMembershipId)),
      );
    });

    it('a platform support session reads and refuses a write; a platform admin session writes', async () => {
      const start = await gqlRequest(result.httpServer, {
        query: ADMIN_START,
        variables: {
          targetUserId: teacher.userId,
          targetTenantId: tenant.tenantId,
          reason: REASON,
        },
        token: createPlatformToken({
          sub: otherTenant.userId,
          membershipId: supportMembershipId,
          roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
        }),
      });
      expect(start.errors).toBeUndefined();
      const exchange = await gqlRequest(result.httpServer, {
        query: EXCHANGE,
        variables: { code: start.data?.adminStartImpersonation.code },
      });
      const supportToken = exchange.data?.exchangeImpersonationCode.accessToken as string;
      expect(claimsOf(supportToken).impersonationReadOnly).toBe(true);

      const read = await gqlRequest(result.httpServer, {
        query: MY_INSTITUTE,
        token: supportToken,
      });
      expect(read.errors).toBeUndefined();
      const write = await gqlRequest(result.httpServer, { query: WRITE, token: supportToken });
      expect(write.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_READ_ONLY');

      const admin = await impersonate(teacher.userId);
      expect(admin.claims.impersonationReadOnly).toBeUndefined();
      // Reaches the resolver, which has its own rule for this one mutation.
      const adminWrite = await gqlRequest(result.httpServer, { query: WRITE, token: admin.token });
      expect(adminWrite.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('reseller → institute', () => {
    it('refuses a reseller whose token is for another reseller than the institute owner', async () => {
      const otherReseller = await createTestReseller(result.db);
      try {
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
            sub: otherReseller.userId,
            resellerId: otherReseller.resellerId,
            membershipId: otherReseller.membershipId,
            roleId: otherReseller.roleId,
          }),
        });

        expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        expect(response.errors?.[0]?.message).toBe('Institute does not belong to your reseller');
        expect(response.data).toBeNull();
      } finally {
        await cleanupTestReseller(result.db, otherReseller);
      }
    });
  });

  describe('reseller → institute, view-only for roles below full admin (ROV-183)', () => {
    const RESELLER_START = `
      mutation($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
        resellerStartImpersonation(
          targetUserId: $targetUserId
          targetTenantId: $targetTenantId
          reason: $reason
        ) { code requiresOtp sessionId }
      }
    `;
    const RESELLER_VERIFY = `
      mutation($sessionId: String!, $otp: String!) {
        resellerVerifyImpersonationOtp(sessionId: $sessionId, otp: $otp) { code }
      }
    `;
    const WRITE = `mutation { updateMyPreferredLocale(input: { locale: "hi" }) }`;
    const END = `mutation($id: String!) { endImpersonation(sessionId: $id) }`;

    let reseller: TestReseller;
    let owned: TestInstitute;
    let ownedTeacher: TestTeacher;

    beforeAll(async () => {
      reseller = await createTestReseller(result.db);
      owned = await createTestInstitute(result.db, { resellerId: reseller.resellerId });
      ownedTeacher = await createTestTeacher(result.db, owned.tenantId);
      await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), async (tx) => {
        // The OTP goes to the institute_admin's primary phone.
        await tx
          .update(roles)
          .set({ name: { en: 'institute_admin' } })
          .where(eq(roles.id, owned.roleId));
        await tx.insert(phoneNumbers).values({
          userId: owned.userId,
          countryCode: '+91',
          number: `98${Math.floor(Math.random() * 1e8)
            .toString()
            .padStart(8, '0')}`,
          isPrimary: true,
          createdBy: owned.userId,
          updatedBy: owned.userId,
        });
      });
    });

    afterAll(async () => {
      await withAdmin(result.db, mkAdminCtx('test:impersonation-integration'), async (tx) => {
        await tx
          .delete(impersonationSessions)
          .where(eq(impersonationSessions.targetTenantId, owned.tenantId));
        await tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, owned.userId));
      });
      await cleanupTestTeacher(result.db, ownedTeacher);
      await cleanupTestInstitute(result.db, owned);
      await cleanupTestReseller(result.db, reseller);
    });

    /** The reseller's one staff member, holding `role`, opens a session through the OTP. */
    async function impersonateAs(role: ResellerSystemRoleName) {
      const roleId = await withAdmin(
        result.db,
        mkAdminCtx('test:impersonation-integration'),
        async (tx) => {
          const ids = await provisionResellerSystemRoles(tx, reseller.resellerId, reseller.userId);
          await tx
            .update(resellerMemberships)
            .set({ roleId: ids[role], abilities: [] })
            .where(eq(resellerMemberships.id, reseller.membershipId));
          return ids[role];
        },
      );
      const token = createResellerToken({
        sub: reseller.userId,
        resellerId: reseller.resellerId,
        membershipId: reseller.membershipId,
        roleId,
      });
      const start = await gqlRequest(result.httpServer, {
        query: RESELLER_START,
        variables: {
          targetUserId: ownedTeacher.userId,
          targetTenantId: owned.tenantId,
          reason: REASON,
        },
        token,
      });
      expect(start.errors).toBeUndefined();
      expect(start.data?.resellerStartImpersonation.requiresOtp).toBe(true);
      const requestId = start.data?.resellerStartImpersonation.sessionId;
      const pending = await redis.get(`impersonation-otp:${requestId}`);
      assert(pending);
      const verify = await gqlRequest(result.httpServer, {
        query: RESELLER_VERIFY,
        variables: { sessionId: requestId, otp: JSON.parse(pending).otp },
        token,
      });
      expect(verify.errors).toBeUndefined();
      const exchange = await gqlRequest(result.httpServer, {
        query: EXCHANGE,
        variables: { code: verify.data?.resellerVerifyImpersonationOtp.code },
      });
      expect(exchange.errors).toBeUndefined();
      const accessToken = exchange.data?.exchangeImpersonationCode.accessToken as string;
      return { accessToken, claims: claimsOf(accessToken) };
    }

    it('a reseller support admin session reads, refuses every write, and can still end itself', async () => {
      const { accessToken, claims } = await impersonateAs('reseller_support_admin');
      expect(claims.impersonationReadOnly).toBe(true);

      const read = await gqlRequest(result.httpServer, { query: MY_INSTITUTE, token: accessToken });
      expect(read.errors).toBeUndefined();
      expect(read.data?.myInstitute.id).toBe(owned.tenantId);

      const write = await gqlRequest(result.httpServer, { query: WRITE, token: accessToken });
      expect(write.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_READ_ONLY');

      const end = await gqlRequest(result.httpServer, {
        query: END,
        variables: { id: claims.impersonationSessionId },
        token: accessToken,
      });
      expect(end.errors).toBeUndefined();
      expect(end.data?.endImpersonation).toBe(true);
    });

    it('records when the code was verified and by whom (ROV-285)', async () => {
      const before = Date.now();
      const { claims } = await impersonateAs('reseller_full_admin');

      const response = await gqlRequest(result.httpServer, {
        query: `query($sessionId: String!) {
          adminImpersonationSessions(sessionId: $sessionId) { otpVerifiedAt otpVerifiedByName }
        }`,
        variables: { sessionId: claims.impersonationSessionId },
        token: platformAdminToken,
      });
      expect(response.errors).toBeUndefined();
      const row = response.data?.adminImpersonationSessions[0];
      const verifiedAt = new Date(row.otpVerifiedAt).getTime();
      expect(verifiedAt).toBeGreaterThanOrEqual(before);
      expect(verifiedAt).toBeLessThanOrEqual(Date.now());
      expect(row.otpVerifiedByName).toBe(owned.username);
    });

    it('no longer answers the old otpVerified field (ROV-285)', async () => {
      // gqlRequest throws on the HTTP 400 that a validation error returns.
      await expect(
        gqlRequest(result.httpServer, {
          query: `query { adminImpersonationSessions(first: 1) { otpVerified } }`,
          token: platformAdminToken,
        }),
      ).rejects.toThrow(/Cannot query field \\"otpVerified\\"/);
    });

    it('a reseller full admin session is not view-only', async () => {
      const { accessToken, claims } = await impersonateAs('reseller_full_admin');
      expect(claims.impersonationReadOnly).toBeUndefined();

      // Reaches the resolver, which has its own rule for this one mutation.
      const write = await gqlRequest(result.httpServer, { query: WRITE, token: accessToken });
      expect(write.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('intra-institute', () => {
    const CAN = `query($id: String!) { canImpersonateUser(targetUserId: $id) }`;

    it('tells the institute admin whom they can view as, by the rule startImpersonation applies', async () => {
      const can = async (id: string) => {
        const response = await gqlRequest(result.httpServer, {
          query: CAN,
          variables: { id },
          token: instituteAdminToken,
        });
        expect(response.errors).toBeUndefined();
        return response.data?.canImpersonateUser;
      };
      expect(await can(teacher.userId)).toBe(true);
      // Themselves, and a user of another institute.
      expect(await can(tenant.userId)).toBe(false);
      expect(await can(otherTenant.userId)).toBe(false);
      expect(await can(randomUUID())).toBe(false);
    });

    it('refuses the question itself from a teacher, who cannot impersonate anyone', async () => {
      const response = await gqlRequest(result.httpServer, {
        query: CAN,
        variables: { id: tenant.userId },
        token: teacherToken,
      });
      expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

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
