/**
 * Auth events E2E (ROV-96).
 *
 * Every auth lifecycle step must leave a row in `auth_events`, read back here
 * through the platform-only `adminAuthEvents` query. Each request carries a
 * User-Agent unique to this run so rows from parallel suites never match.
 *
 * `password_change` + `all_sessions_revoked` are asserted in
 * `password-change.api-e2e.spec.ts`, which already owns the password rotation.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import type { FormattedExecutionResult } from 'graphql';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { E2E_USERS, SEED_IDS } from '../../shared/seed-fixtures';
import { loginAsPlatformAdmin, loginAsTeacher } from './helpers/auth';

const API_URL =
  process.env.API_URL || `http://localhost:${process.env.E2E_API_PORT ?? '3004'}/api/graphql`;
const USER_AGENT = `roviq-e2e-auth-events/${randomUUID()}`;

interface AuthEvent {
  id: string;
  userId: string | null;
  eventType: string;
  portal: string | null;
  scope: string | null;
  tenantId: string | null;
  authMethod: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown> | null;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function request<T>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<FormattedExecutionResult<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<FormattedExecutionResult<T>>;
}

function claims(accessToken: string): Record<string, string> {
  return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
}

async function teacherLogin(): Promise<Tokens> {
  const res = await request<{ instituteLogin: Tokens }>(
    `mutation($username: String!, $password: String!) {
      instituteLogin(username: $username, password: $password) { accessToken refreshToken }
    }`,
    { username: E2E_USERS.TEACHER.username, password: E2E_USERS.TEACHER.password },
  );
  expect(res.errors).toBeUndefined();
  assert(res.data?.instituteLogin.accessToken);
  return res.data.instituteLogin;
}

describe('Auth events E2E (ROV-96)', () => {
  let adminToken: string;

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsPlatformAdmin());
  });

  /** Events are written fire-and-forget, so poll until this run's row lands. */
  function findEvent(eventType: string, failureReason?: string): Promise<AuthEvent> {
    return vi.waitFor(
      async () => {
        const res = await request<{ adminAuthEvents: AuthEvent[] }>(
          `query($first: Int) {
            adminAuthEvents(first: $first) {
              id userId eventType portal scope tenantId authMethod ipAddress userAgent failureReason metadata
            }
          }`,
          { first: 200 },
          adminToken,
        );
        expect(res.errors).toBeUndefined();
        const event = res.data?.adminAuthEvents.find(
          (e) =>
            e.eventType === eventType &&
            e.userAgent === USER_AGENT &&
            (!failureReason || e.failureReason === failureReason),
        );
        assert(event, `no ${eventType} auth event recorded for this run`);
        return event;
      },
      { timeout: 5_000, interval: 100 },
    );
  }

  it('records login_success with scope, tenant, auth method, ip and user agent', async () => {
    await teacherLogin();

    const event = await findEvent('login_success');
    expect(event.userId).toBe(SEED_IDS.USER_TEACHER);
    expect(event.portal).toBe('institute');
    expect(event.scope).toBe('institute');
    expect(event.tenantId).toBe(SEED_IDS.INSTITUTE_1);
    expect(event.authMethod).toBe('password');
    expect(event.userAgent).toBe(USER_AGENT);
    expect(event.ipAddress).toBeTruthy();
  });

  it('records an unknown username as login_failed on the portal it was tried on', async () => {
    // An unknown username: a wrong password on a seed user would count toward its lockout.
    const username = `ghost-${randomUUID()}`;
    const res = await request(
      `mutation($username: String!, $password: String!) {
        resellerLogin(username: $username, password: $password) { accessToken }
      }`,
      { username, password: 'not-the-password' },
    );
    expect(res.errors?.[0]?.extensions?.code).toBe('INVALID_CREDENTIALS');

    const event = await findEvent('login_failed', 'UNKNOWN_USER');
    expect(event.userId).toBeNull();
    expect(event.portal).toBe('reseller');
    expect(event.scope).toBeNull();
    expect(event.tenantId).toBeNull();
    expect(event.authMethod).toBe('password');
    expect(event.ipAddress).toBeTruthy();
    expect(event.metadata).toEqual({ username_lower: username });
  });

  it('records a right password on the wrong portal without granting any scope', async () => {
    const res = await request(
      `mutation($username: String!, $password: String!) {
        adminLogin(username: $username, password: $password) { accessToken }
      }`,
      { username: E2E_USERS.TEACHER.username, password: E2E_USERS.TEACHER.password },
    );
    // Indistinguishable from a wrong password for the caller.
    expect(res.errors?.[0]?.extensions?.code).toBe('INVALID_CREDENTIALS');

    const event = await findEvent('login_failed', 'NO_PORTAL_ACCESS');
    expect(event.userId).toBe(SEED_IDS.USER_TEACHER);
    expect(event.portal).toBe('platform');
    expect(event.scope).toBeNull();
    expect(event.tenantId).toBeNull();
    expect(event.metadata).toEqual({});
  });

  it('records token_refresh and logout against the session membership', async () => {
    const login = await teacherLogin();
    const { membershipId } = claims(login.accessToken);

    const refreshRes = await request<{ refreshToken: Tokens }>(
      `mutation($token: String!) { refreshToken(token: $token) { accessToken refreshToken } }`,
      { token: login.refreshToken },
    );
    expect(refreshRes.errors).toBeUndefined();
    assert(refreshRes.data);
    const refreshed = refreshRes.data.refreshToken;

    const refreshEvent = await findEvent('token_refresh');
    expect(refreshEvent.userId).toBe(SEED_IDS.USER_TEACHER);
    expect(refreshEvent.scope).toBe('institute');
    expect(refreshEvent.tenantId).toBe(SEED_IDS.INSTITUTE_1);
    expect(refreshEvent.ipAddress).toBeTruthy();
    expect(refreshEvent.metadata).toEqual({ membership_id: membershipId });

    const logoutRes = await request<{ logout: boolean }>(
      `mutation($token: String!) { logout(currentRefreshToken: $token) }`,
      { token: refreshed.refreshToken },
      refreshed.accessToken,
    );
    expect(logoutRes.errors).toBeUndefined();

    const logoutEvent = await findEvent('logout');
    expect(logoutEvent.userId).toBe(SEED_IDS.USER_TEACHER);
    expect(logoutEvent.scope).toBe('institute');
    expect(logoutEvent.tenantId).toBe(SEED_IDS.INSTITUTE_1);
    expect(logoutEvent.metadata).toEqual({ membership_id: membershipId });
  });

  it('records impersonation_start and impersonation_end with the session id', async () => {
    const startRes = await request<{ adminStartImpersonation: { code: string | null } }>(
      `mutation($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
        adminStartImpersonation(
          targetUserId: $targetUserId, targetTenantId: $targetTenantId, reason: $reason
        ) { code }
      }`,
      {
        targetUserId: SEED_IDS.USER_TEACHER,
        targetTenantId: SEED_IDS.INSTITUTE_1,
        reason: 'ROV-96 auth events e2e verification',
      },
      adminToken,
    );
    expect(startRes.errors).toBeUndefined();
    const code = startRes.data?.adminStartImpersonation.code;
    assert(code);

    const exchangeRes = await request<{ exchangeImpersonationCode: { accessToken: string } }>(
      `mutation($code: String!) { exchangeImpersonationCode(code: $code) { accessToken } }`,
      { code },
    );
    expect(exchangeRes.errors).toBeUndefined();
    assert(exchangeRes.data);
    const impersonationToken = exchangeRes.data.exchangeImpersonationCode.accessToken;
    const { impersonationSessionId, impersonatorId } = claims(impersonationToken);

    const startEvent = await findEvent('impersonation_start');
    expect(startEvent.userId).toBe(impersonatorId);
    // The impersonator's scope, not the target's.
    expect(startEvent.scope).toBe('platform');
    expect(startEvent.tenantId).toBe(SEED_IDS.INSTITUTE_1);
    expect(startEvent.ipAddress).toBeTruthy();
    expect(startEvent.metadata).toEqual({
      target_user_id: SEED_IDS.USER_TEACHER,
      target_tenant_id: SEED_IDS.INSTITUTE_1,
      session_id: impersonationSessionId,
    });

    const endRes = await request<{ adminEndImpersonation: boolean }>(
      `mutation($sessionId: String!) { adminEndImpersonation(sessionId: $sessionId) }`,
      { sessionId: impersonationSessionId },
      adminToken,
    );
    expect(endRes.errors).toBeUndefined();

    const endEvent = await findEvent('impersonation_end');
    expect(endEvent.userId).toBe(impersonatorId);
    expect(endEvent.scope).toBe('platform');
    expect(endEvent.metadata).toEqual({
      session_id: impersonationSessionId,
      ended_reason: 'manual',
    });
  });

  it('refuses adminAuthEvents to an institute-scope token', async () => {
    const { accessToken } = await loginAsTeacher();

    const res = await request(`query { adminAuthEvents(first: 1) { id } }`, undefined, accessToken);

    expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
