import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import type {
  AuthPayload,
  ImpersonationAuthPayload,
  InstituteLoginResult,
  StartImpersonationResult,
} from '@roviq/graphql/generated';
import { beforeAll, describe, expect, it } from 'vitest';
import { E2E_USERS, SEED_IDS } from '../../shared/seed-fixtures';
import { E2eMeDocument } from './__generated__/graphql';
import {
  loginAsInstituteAdmin,
  loginAsPlatformAdmin,
  loginAsReseller,
  loginAsTeacher,
} from './helpers/auth';
import { gql } from './helpers/gql-client';
import { connectWithParams, exchangeWsTicket } from './helpers/ws-client';

// Strip only the trailing `/graphql` so the NestJS global prefix (`/api`)
// stays intact — `POST /api/graphql` (GraphQL) vs `GET /api/auth/ws-ticket`
// (REST controller) both live under `/api`. Dropping `/api/graphql` wholesale
// would route ws-ticket requests to `/auth/ws-ticket` → 404.
const API_BASE_URL = (
  process.env.API_URL || `http://localhost:${process.env.E2E_API_PORT ?? '3004'}/api/graphql`
).replace(/\/graphql$/, '');

const REFRESH_MUTATION = `mutation Refresh($token: String!) {
  refreshToken(token: $token) { accessToken refreshToken }
}`;

const SWITCH_MUTATION = `mutation SwitchInstitute($membershipId: String!, $currentRefreshToken: String!) {
  switchInstitute(membershipId: $membershipId, currentRefreshToken: $currentRefreshToken) {
    accessToken
    refreshToken
  }
}`;

describe('Security Invariant E2E Tests', () => {
  // ── 7. Impersonation token cannot be refreshed ──────────────────────
  describe('7 — Impersonation token has no refresh token', () => {
    it('exchangeImpersonationCode returns accessToken but NO refreshToken field', async () => {
      // The ImpersonationAuthPayload GraphQL type only has `accessToken`, `user`, and `institute`.
      // There is no `refreshToken` field at all — attempting to query it should return a GraphQL
      // validation error, proving impersonation tokens are non-renewable by design.
      // We don't need to actually impersonate — just verify the schema rejects the field.
      const res = await gql(
        `mutation {
          exchangeImpersonationCode(code: "fake-code") {
            accessToken
            refreshToken
          }
        }`,
      );

      // The GraphQL schema should reject `refreshToken` on ImpersonationAuthPayload
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
      expect(res.errors.map((e) => e.message).join('\n')).toContain(
        'Cannot query field "refreshToken" on type "ImpersonationAuthPayload"',
      );
    });
  });

  // ── 8. Revoked impersonation session rejects requests ───────────────
  describe('8 — Revoked impersonation session rejects requests', () => {
    it('impersonation accessToken is rejected after endImpersonation', async () => {
      // 1. Platform admin starts impersonation of the teacher in institute 1
      const { accessToken: adminToken } = await loginAsPlatformAdmin();
      const startRes = await gql<{ adminStartImpersonation: StartImpersonationResult }>(
        `mutation AdminStartImpersonation($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
          adminStartImpersonation(
            targetUserId: $targetUserId,
            targetTenantId: $targetTenantId,
            reason: $reason
          ) { code }
        }`,
        {
          targetUserId: SEED_IDS.USER_TEACHER,
          targetTenantId: SEED_IDS.INSTITUTE_1,
          reason: 'security invariant test — revoked session rejection',
        },
        adminToken,
      );
      expect(startRes.errors).toBeUndefined();
      assert(startRes.data);
      const code = startRes.data.adminStartImpersonation.code;
      assert(code);

      // 2. Exchange the one-time code for an impersonation access token
      const exchangeRes = await gql<{ exchangeImpersonationCode: ImpersonationAuthPayload }>(
        `mutation($code: String!) {
          exchangeImpersonationCode(code: $code) {
            accessToken
            user { id }
          }
        }`,
        { code },
      );
      expect(exchangeRes.errors).toBeUndefined();
      assert(exchangeRes.data);
      const impersonationToken = exchangeRes.data.exchangeImpersonationCode.accessToken;
      assert(impersonationToken);

      // 3. Verify impersonation token works initially
      const meRes1 = await gql<{ me: { id: string } }>(
        'query { me { id } }',
        undefined,
        impersonationToken,
      );
      expect(meRes1.errors).toBeUndefined();

      // 3b. Invariant 7: the token itself cannot be traded for a longer session.
      const refreshAttempt = await gql(REFRESH_MUTATION, { token: impersonationToken });
      expect(refreshAttempt.data ?? null).toBeNull();
      expect(refreshAttempt.errors?.[0]?.extensions?.code).toBe('SESSION_EXPIRED');

      // 4. End the impersonation (either party can end — use the impersonator here)
      //    We need the sessionId from the JWT itself.
      const payload = JSON.parse(
        Buffer.from(impersonationToken.split('.')[1], 'base64url').toString('utf8'),
      ) as { impersonationSessionId: string };
      const sessionId = payload.impersonationSessionId;
      assert(sessionId);

      const endRes = await gql<{ endImpersonation: boolean }>(
        `mutation($sessionId: String!) { endImpersonation(sessionId: $sessionId) }`,
        { sessionId },
        impersonationToken,
      );
      expect(endRes.errors).toBeUndefined();

      // 5. The impersonation token should now be rejected by ImpersonationSessionGuard
      const meRes2 = await gql(E2eMeDocument, undefined, impersonationToken);
      expect(meRes2.data ?? null).toBeNull();
      expect(meRes2.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_ENDED');
    });
  });

  // ── 12. Wrong portal is indistinguishable from a wrong password ─────
  describe('12 — Wrong portal is indistinguishable from a wrong password', () => {
    const LOGIN_MUTATIONS = {
      adminLogin: `mutation AdminLogin($username: String!, $password: String!) {
        adminLogin(username: $username, password: $password) { accessToken }
      }`,
      resellerLogin: `mutation ResellerLogin($username: String!, $password: String!) {
        resellerLogin(username: $username, password: $password) { accessToken }
      }`,
      instituteLogin: `mutation InstituteLogin($username: String!, $password: String!) {
        instituteLogin(username: $username, password: $password) { accessToken }
      }`,
    };

    async function loginFailure(
      mutation: keyof typeof LOGIN_MUTATIONS,
      username: string,
      password: string,
    ) {
      const res = await gql(LOGIN_MUTATIONS[mutation], { username, password });
      assert(res.errors);
      return { message: res.errors[0].message, code: res.errors[0].extensions?.code };
    }

    it('instituteLogin with admin credentials should work (admin has institute memberships)', async () => {
      const res = await gql<{ instituteLogin: InstituteLoginResult }>(
        `mutation InstituteLogin($username: String!, $password: String!) {
          instituteLogin(username: $username, password: $password) {
            requiresInstituteSelection
            memberships { membershipId }
          }
        }`,
        {
          username: E2E_USERS.INSTITUTE_ADMIN.username,
          password: E2E_USERS.INSTITUTE_ADMIN.password,
        },
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      // Admin has institute memberships, so login should succeed
      expect(
        res.data.instituteLogin.requiresInstituteSelection ||
          (res.data.instituteLogin.memberships?.length ?? 0) > 0,
      ).toBe(true);
    });

    it.each([
      ['resellerLogin', E2E_USERS.TEACHER],
      ['adminLogin', E2E_USERS.TEACHER],
      ['instituteLogin', E2E_USERS.RESELLER],
    ] as const)('%s with valid credentials of another portal fails exactly like a wrong password', async (mutation, user) => {
      // Wrong password first: the correct password that follows resets the
      // lockout counter of this shared seed user.
      const wrongPassword = await loginFailure(mutation, user.username, randomUUID());
      const wrongPortal = await loginFailure(mutation, user.username, user.password);

      expect(wrongPortal).toEqual({ message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      expect(wrongPortal).toEqual(wrongPassword);
    });
  });

  // ── 14. One-time impersonation code cannot be reused ────────────────
  describe('14 — One-time impersonation code cannot be reused', () => {
    it('exchangeImpersonationCode rejects the second exchange with the same code', async () => {
      const { accessToken: adminToken } = await loginAsPlatformAdmin();

      const startRes = await gql<{ adminStartImpersonation: StartImpersonationResult }>(
        `mutation AdminStartImpersonation($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
          adminStartImpersonation(
            targetUserId: $targetUserId,
            targetTenantId: $targetTenantId,
            reason: $reason
          ) { code }
        }`,
        {
          targetUserId: SEED_IDS.USER_TEACHER,
          targetTenantId: SEED_IDS.INSTITUTE_1,
          reason: 'security invariant test — single-use impersonation code',
        },
        adminToken,
      );
      assert(startRes.data);
      const code = startRes.data.adminStartImpersonation.code;

      // First exchange — should succeed (GETDEL consumes the code atomically)
      const first = await gql<{ exchangeImpersonationCode: ImpersonationAuthPayload }>(
        `mutation($code: String!) { exchangeImpersonationCode(code: $code) { accessToken } }`,
        { code },
      );
      expect(first.errors).toBeUndefined();
      assert(first.data);
      expect(first.data.exchangeImpersonationCode.accessToken).toBeTruthy();

      // Second exchange — the Redis key has been consumed; must be rejected
      const second = await gql(
        `mutation($code: String!) { exchangeImpersonationCode(code: $code) { accessToken } }`,
        { code },
      );
      expect(second.errors).toBeDefined();
      assert(second.errors);
      expect(second.errors[0].message).toMatch(/expired or already used|invalid|unauthor/i);
    });
  });

  // ── 14b. An impersonation token cannot touch the target's sessions ──
  describe("14b — Impersonation token cannot end or replace the target's sessions", () => {
    it('logout and switchInstitute are forbidden, the target stays signed in, subscriptions connect', async () => {
      const teacher = await loginAsTeacher();
      const { accessToken: adminToken } = await loginAsPlatformAdmin();

      const startRes = await gql<{ adminStartImpersonation: StartImpersonationResult }>(
        `mutation AdminStartImpersonation($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
          adminStartImpersonation(
            targetUserId: $targetUserId,
            targetTenantId: $targetTenantId,
            reason: $reason
          ) { code }
        }`,
        {
          targetUserId: SEED_IDS.USER_TEACHER,
          targetTenantId: SEED_IDS.INSTITUTE_1,
          reason: 'security invariant test — impersonation cannot manage target sessions',
        },
        adminToken,
      );
      expect(startRes.errors).toBeUndefined();
      const code = startRes.data?.adminStartImpersonation.code;
      assert(code);

      const exchange = await gql<{ exchangeImpersonationCode: ImpersonationAuthPayload }>(
        `mutation($code: String!) { exchangeImpersonationCode(code: $code) { accessToken } }`,
        { code },
      );
      expect(exchange.errors).toBeUndefined();
      const impersonationToken = exchange.data?.exchangeImpersonationCode.accessToken;
      assert(impersonationToken);

      const logoutRes = await gql(
        `mutation Logout($currentRefreshToken: String!) { logout(currentRefreshToken: $currentRefreshToken) }`,
        { currentRefreshToken: teacher.refreshToken },
        impersonationToken,
      );
      expect(logoutRes.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

      const switchRes = await gql(
        SWITCH_MUTATION,
        { membershipId: randomUUID(), currentRefreshToken: teacher.refreshToken },
        impersonationToken,
      );
      expect(switchRes.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(switchRes.data).toBeNull();

      const refreshRes = await gql<{ refreshToken: AuthPayload }>(REFRESH_MUTATION, {
        token: teacher.refreshToken,
      });
      expect(refreshRes.errors).toBeUndefined();
      expect(refreshRes.data?.refreshToken.accessToken).toBeTruthy();

      const ticket = await exchangeWsTicket(impersonationToken);
      expect(await connectWithParams({ ticket })).toEqual({ acknowledged: true });
    });
  });

  // ── 15. Intra-institute impersonation respects role hierarchy ───────
  describe('15 — Intra-institute impersonation respects role hierarchy', () => {
    it('teacher cannot impersonate admin (higher role)', async () => {
      const { accessToken } = await loginAsTeacher();

      const res = await gql<{ impersonateUser: StartImpersonationResult }>(
        `mutation ImpersonateUser($targetUserId: String!, $reason: String!) {
          impersonateUser(targetUserId: $targetUserId, reason: $reason) {
            code
            requiresOtp
          }
        }`,
        {
          targetUserId: SEED_IDS.USER_ADMIN,
          reason: 'testing role hierarchy enforcement for security audit',
        },
        accessToken,
      );

      // A teacher has no `impersonate User` ability, so the guard rejects
      // the call before the service compares roles.
      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(res.data).toBeNull();
    });
  });

  // ── 16. Institute switching returns new tokens ──────────────────────
  describe('16 — Institute switching returns new tokens', () => {
    it('switchInstitute returns new access and refresh tokens for the target institute', async () => {
      // Login as admin and select first institute
      const loginRes = await gql<{ instituteLogin: InstituteLoginResult }>(
        `mutation InstituteLogin($username: String!, $password: String!) {
          instituteLogin(username: $username, password: $password) {
            requiresInstituteSelection
            selectionToken
            memberships { membershipId tenantId }
          }
        }`,
        {
          username: E2E_USERS.INSTITUTE_ADMIN.username,
          password: E2E_USERS.INSTITUTE_ADMIN.password,
        },
      );

      assert(loginRes.data);
      const selectionToken = loginRes.data.instituteLogin.selectionToken;
      const memberships = loginRes.data.instituteLogin.memberships ?? [];
      assert(memberships.length >= 2, 'Admin must have at least 2 institute memberships');

      const firstMembership = memberships[0];
      const secondMembership = memberships[1];

      // Select first institute using selectionToken
      const selectRes = await gql<{ selectInstitute: AuthPayload }>(
        `mutation SelectInstitute($selectionToken: String!, $membershipId: String!) {
          selectInstitute(selectionToken: $selectionToken, membershipId: $membershipId) {
            accessToken
            refreshToken
          }
        }`,
        { selectionToken, membershipId: firstMembership.membershipId },
      );

      assert(selectRes.data);
      const firstAccessToken = selectRes.data.selectInstitute.accessToken;
      const firstRefreshToken = selectRes.data.selectInstitute.refreshToken;
      assert(firstAccessToken);
      assert(firstRefreshToken);

      // Switch to second institute
      const switchRes = await gql<{ switchInstitute: AuthPayload }>(
        `mutation SwitchInstitute($membershipId: String!, $currentRefreshToken: String!) {
          switchInstitute(membershipId: $membershipId, currentRefreshToken: $currentRefreshToken) {
            accessToken
            refreshToken
            user { tenantId }
          }
        }`,
        { membershipId: secondMembership.membershipId, currentRefreshToken: firstRefreshToken },
        firstAccessToken,
      );

      expect(switchRes.errors).toBeUndefined();
      assert(switchRes.data);
      const newAccessToken = switchRes.data.switchInstitute.accessToken;
      const newRefreshToken = switchRes.data.switchInstitute.refreshToken;

      // New tokens should be issued
      expect(newAccessToken).toBeTruthy();
      expect(newRefreshToken).toBeTruthy();

      // Tokens should be different from the first institute's tokens
      expect(newAccessToken).not.toBe(firstAccessToken);
      expect(newRefreshToken).not.toBe(firstRefreshToken);

      // New token should be scoped to the second institute
      const switchedUser = switchRes.data.switchInstitute.user;
      assert(switchedUser);
      expect(switchedUser.tenantId).toBe(secondMembership.tenantId);

      // The session that was switched away from is revoked.
      const staleRefresh = await gql(REFRESH_MUTATION, { token: firstRefreshToken });
      expect(staleRefresh.errors?.[0]?.extensions?.code).toBe('SESSION_EXPIRED');

      // Revoked as a deliberate switch, not a rotation: replaying the old
      // token must not cascade onto the new session.
      const freshRefresh = await gql<{ refreshToken: AuthPayload }>(REFRESH_MUTATION, {
        token: newRefreshToken,
      });
      expect(freshRefresh.errors).toBeUndefined();
      expect(freshRefresh.data?.refreshToken.accessToken).toBeTruthy();
    });

    it('a rejected switch keeps the current session usable', async () => {
      const { accessToken, refreshToken } = await loginAsInstituteAdmin();

      const switchRes = await gql(
        SWITCH_MUTATION,
        { membershipId: randomUUID(), currentRefreshToken: refreshToken },
        accessToken,
      );
      expect(switchRes.errors?.[0]?.extensions?.code).toBe('NO_ACTIVE_MEMBERSHIP');

      const refreshRes = await gql<{ refreshToken: AuthPayload }>(REFRESH_MUTATION, {
        token: refreshToken,
      });
      expect(refreshRes.errors).toBeUndefined();
      expect(refreshRes.data?.refreshToken.accessToken).toBeTruthy();
    });

    it('rejects a switch that does not present a live refresh token of the caller', async () => {
      const { accessToken } = await loginAsInstituteAdmin();
      const { refreshToken: teacherRefreshToken } = await loginAsTeacher();

      const unknown = await gql(
        SWITCH_MUTATION,
        { membershipId: randomUUID(), currentRefreshToken: 'not-a-refresh-token' },
        accessToken,
      );
      expect(unknown.errors?.[0]?.extensions?.code).toBe('SESSION_EXPIRED');
      expect(unknown.data).toBeNull();

      const foreign = await gql(
        SWITCH_MUTATION,
        { membershipId: randomUUID(), currentRefreshToken: teacherRefreshToken },
        accessToken,
      );
      expect(foreign.errors?.[0]?.extensions?.code).toBe('SESSION_EXPIRED');
      expect(foreign.data).toBeNull();
    });

    it('rejects switchInstitute from a platform-scope token', async () => {
      const { accessToken, refreshToken } = await loginAsPlatformAdmin();

      const res = await gql(
        SWITCH_MUTATION,
        { membershipId: randomUUID(), currentRefreshToken: refreshToken },
        accessToken,
      );

      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(res.data).toBeNull();
    });
  });

  // ── 17. Reseller cannot delete institutes ───────────────────────────
  describe('17 — Reseller cannot delete institutes', () => {
    const institute = () =>
      gql<{ adminGetInstitute: { id: string } }>(
        'query($id: ID!) { adminGetInstitute(id: $id) { id } }',
        { id: SEED_IDS.INSTITUTE_2 },
        adminToken,
      );
    let adminToken: string;
    let resellerToken: string;

    beforeAll(async () => {
      adminToken = (await loginAsPlatformAdmin()).accessToken;
      resellerToken = (await loginAsReseller()).accessToken;
    });

    it('the platform delete mutation refuses a reseller token and deletes nothing', async () => {
      const res = await gql(
        'mutation($id: ID!) { adminDeleteInstitute(id: $id) }',
        { id: SEED_IDS.INSTITUTE_2 },
        resellerToken,
      );
      expect(res.data ?? null).toBeNull();
      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

      const after = await institute();
      expect(after.errors).toBeUndefined();
      expect(after.data?.adminGetInstitute.id).toBe(SEED_IDS.INSTITUTE_2);
    });

    it('the reseller API has no delete mutation at all', async () => {
      const res = await gql(
        'mutation($id: ID!) { resellerDeleteInstitute(id: $id) }',
        { id: SEED_IDS.INSTITUTE_2 },
        resellerToken,
      );
      expect(res.errors?.[0]?.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
      expect(res.errors?.map((e) => e.message).join('\n')).toContain(
        'Cannot query field "resellerDeleteInstitute"',
      );
    });

    it('the signed-in reseller holds no delete grant on Institute', async () => {
      const res = await gql<{
        resellerLogin: {
          user: { abilityRules: { action: string; subject: string; inverted?: boolean }[] };
        };
      }>(
        `mutation($username: String!, $password: String!) {
          resellerLogin(username: $username, password: $password) { user { abilityRules } }
        }`,
        { username: E2E_USERS.RESELLER.username, password: E2E_USERS.RESELLER.password },
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const rules = res.data.resellerLogin.user.abilityRules;
      expect(rules.length).toBeGreaterThan(0);
      const grantsDelete = rules.some(
        (rule) =>
          rule.inverted !== true &&
          ['delete', 'manage'].includes(rule.action) &&
          ['Institute', 'all'].includes(rule.subject),
      );
      expect(grantsDelete).toBe(false);
    });
  });

  // ── 18. System reseller cannot be suspended or deleted ──────────────
  describe('18 — System reseller cannot be suspended or deleted', () => {
    it('adminSuspendReseller with Roviq Direct UUID should be rejected', async () => {
      const { accessToken: adminToken } = await loginAsPlatformAdmin();

      // Try to suspend the system reseller "Roviq Direct"
      const res = await gql<{ adminSuspendReseller: { id: string } }>(
        `mutation SuspendReseller($resellerId: String!) {
          adminSuspendReseller(resellerId: $resellerId) { id }
        }`,
        { resellerId: SEED_IDS.RESELLER_DIRECT },
        adminToken,
      );

      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/cannot suspend system reseller|forbidden/i);
    });

    it('adminDeleteReseller with Roviq Direct UUID should be rejected', async () => {
      const { accessToken: adminToken } = await loginAsPlatformAdmin();

      // Try to delete the system reseller "Roviq Direct"
      const res = await gql<{ adminDeleteReseller: { id: string } }>(
        `mutation DeleteReseller($resellerId: String!) {
          adminDeleteReseller(resellerId: $resellerId) { id }
        }`,
        { resellerId: SEED_IDS.RESELLER_DIRECT },
        adminToken,
      );

      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/cannot delete system reseller|forbidden/i);
    });
  });

  // ── 19. ws-ticket is single-use and expires ─────────────────────────
  describe('19 — ws-ticket requires auth and issues a fresh per-request ticket', () => {
    it('rejects unauthenticated ws-ticket requests', async () => {
      const res = await fetch(`${API_BASE_URL}/auth/ws-ticket`, { method: 'GET' });
      expect(res.status).toBe(401);
    });

    it('issues a fresh ticket on each authenticated call (never the same token twice)', async () => {
      const { accessToken } = await loginAsTeacher();

      const res1 = await fetch(`${API_BASE_URL}/auth/ws-ticket`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { ticket?: string };
      expect(body1.ticket).toBeTruthy();
      expect(typeof body1.ticket).toBe('string');
      expect(body1.ticket?.length).toBeGreaterThanOrEqual(32);

      const res2 = await fetch(`${API_BASE_URL}/auth/ws-ticket`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { ticket?: string };
      expect(body2.ticket).toBeTruthy();

      // Each request must mint a distinct single-use ticket
      expect(body2.ticket).not.toBe(body1.ticket);
    });

    // graphql-ws closes with 4403 when onConnect refuses the connection.
    const REJECTED = { acknowledged: false, closeCode: 4403 };

    it('acknowledges a connection that presents a fresh ticket', async () => {
      const { accessToken } = await loginAsTeacher();
      const ticket = await exchangeWsTicket(accessToken);

      expect(await connectWithParams({ ticket })).toEqual({ acknowledged: true });
    });

    it('rejects a ticket that was already used', async () => {
      const { accessToken } = await loginAsTeacher();
      const ticket = await exchangeWsTicket(accessToken);
      expect(await connectWithParams({ ticket })).toEqual({ acknowledged: true });

      expect(await connectWithParams({ ticket })).toEqual(REJECTED);
    });

    it('lets only one of two connections racing on the same ticket through', async () => {
      const { accessToken } = await loginAsTeacher();
      const ticket = await exchangeWsTicket(accessToken);

      const outcomes = await Promise.all([
        connectWithParams({ ticket }),
        connectWithParams({ ticket }),
      ]);

      expect(outcomes.filter((outcome) => outcome.acknowledged)).toHaveLength(1);
      expect(outcomes).toContainEqual(REJECTED);
    });

    it('rejects a connection without a ticket', async () => {
      expect(await connectWithParams({})).toEqual(REJECTED);
    });

    it('rejects a ticket that was never issued', async () => {
      expect(await connectWithParams({ ticket: randomUUID() })).toEqual(REJECTED);
    });

    it('rejects a malformed ticket', async () => {
      expect(await connectWithParams({ ticket: 'not-a-ticket' })).toEqual(REJECTED);
    });

    it('rejects a raw access token sent in place of a ticket', async () => {
      const { accessToken } = await loginAsTeacher();

      expect(await connectWithParams({ ticket: accessToken })).toEqual(REJECTED);
      expect(await connectWithParams({ Authorization: `Bearer ${accessToken}` })).toEqual(REJECTED);
    });
  });

  // ── 20. revokeAllOtherSessions keeps the current session alive ──────
  describe('20 — revokeAllOtherSessions keeps the current session alive', () => {
    it('session A calling revokeAllOther keeps A alive and kills B', async () => {
      // Two independent logins as teacher → two refresh token rows
      const loginA = await gql<{ instituteLogin: InstituteLoginResult }>(
        `mutation($u: String!, $p: String!) {
          instituteLogin(username: $u, password: $p) { accessToken refreshToken }
        }`,
        { u: E2E_USERS.TEACHER.username, p: E2E_USERS.TEACHER.password },
      );
      const loginB = await gql<{ instituteLogin: InstituteLoginResult }>(
        `mutation($u: String!, $p: String!) {
          instituteLogin(username: $u, password: $p) { accessToken refreshToken }
        }`,
        { u: E2E_USERS.TEACHER.username, p: E2E_USERS.TEACHER.password },
      );
      assert(loginA.data?.instituteLogin.accessToken);
      assert(loginA.data.instituteLogin.refreshToken);
      assert(loginB.data?.instituteLogin.refreshToken);

      const tokenA_access = loginA.data.instituteLogin.accessToken;
      const tokenA_refresh = loginA.data.instituteLogin.refreshToken;
      const tokenB_refresh = loginB.data.instituteLogin.refreshToken;

      // Session A revokes all other sessions
      const revokeRes = await gql<{ revokeAllOtherSessions: boolean }>(
        `mutation($t: String!) { revokeAllOtherSessions(currentRefreshToken: $t) }`,
        { t: tokenA_refresh },
        tokenA_access,
      );
      expect(revokeRes.errors).toBeUndefined();

      // B's refresh token should now be rejected
      const refreshB = await gql(
        `mutation($t: String!) { refreshToken(token: $t) { accessToken } }`,
        { t: tokenB_refresh },
      );
      expect(refreshB.errors).toBeDefined();

      // A's refresh token should still work (it was the "keep-alive" session)
      const refreshA = await gql<{ refreshToken: AuthPayload }>(
        `mutation($t: String!) { refreshToken(token: $t) { accessToken refreshToken } }`,
        { t: tokenA_refresh },
      );
      expect(refreshA.errors).toBeUndefined();
      assert(refreshA.data);
      expect(refreshA.data.refreshToken.accessToken).toBeTruthy();
    });
  });

  // ── 21. selectInstitute requires a valid selectionToken ─────────────
  describe('21 — selectInstitute requires a valid selectionToken', () => {
    it('rejects an obviously invalid selectionToken', async () => {
      const res = await gql(
        `mutation($t: String!, $m: String!) {
          selectInstitute(selectionToken: $t, membershipId: $m) { accessToken }
        }`,
        { t: 'not-a-jwt', m: '00000000-0000-0000-0000-000000000000' },
      );
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/selection token|unauthor|invalid/i);
    });

    it('rejects an expired/tampered selectionToken', async () => {
      // Structurally valid JWT but not signed with the right secret
      const fakeToken =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwicHVycG9zZSI6Imluc3RpdHV0ZS1zZWxlY3Rpb24iLCJleHAiOjF9.fake';
      const res = await gql(
        `mutation($t: String!, $m: String!) {
          selectInstitute(selectionToken: $t, membershipId: $m) { accessToken }
        }`,
        { t: fakeToken, m: '00000000-0000-0000-0000-000000000000' },
      );
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors[0].message).toMatch(/selection token|unauthor|invalid|expired/i);
    });
  });
});
