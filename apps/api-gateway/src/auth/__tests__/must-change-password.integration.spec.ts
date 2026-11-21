/**
 * First-login password change through the real pipeline (AppModule, real login mutations,
 * real tokens). A flagged account may only read `me`, log out and change its password; every
 * other root field and the WebSocket ticket answer PASSWORD_CHANGE_REQUIRED. After the change
 * a fresh login is not blocked. All three login mutations mint the claim (shared issueTokens).
 */
import { hash } from '@node-rs/argon2';
import { mkAdminCtx, platformMemberships, SYSTEM_USER_ID, users, withAdmin } from '@roviq/database';
import {
  createIntegrationApp,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';

const TEMP_PASSWORD = 'Temp-Password-1';
const NEW_PASSWORD = 'New-Password-2';

type Scope = 'institute' | 'reseller' | 'platform';

const LOGIN: Record<Scope, string> = {
  institute: 'instituteLogin',
  reseller: 'resellerLogin',
  platform: 'adminLogin',
};

/** A root query each scope may normally call, with the data a refused call leaves. */
const ORDINARY_QUERY: Record<Scope, { query: string; refused: unknown }> = {
  institute: { query: 'query { myInstitute { id } }', refused: null },
  reseller: { query: 'query { resellerListInstitutes { totalCount } }', refused: null },
  platform: { query: 'query { adminListInstitutes { totalCount } }', refused: null },
};

// The field is nullable, so a refusal leaves it null rather than the whole data.
const ORDINARY_MUTATION = {
  query: 'mutation { updateMyPreferredLocale(input: { locale: "hi" }) }',
  refused: { updateMyPreferredLocale: null },
};
const ME = 'query { me { id } }';
const LOGOUT = 'mutation ($t: String!) { logout(currentRefreshToken: $t) }';
const CHANGE_PASSWORD =
  'mutation ($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }';

function claimsOf(token: string): { mustChangePassword?: boolean } {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
}

describe('First-login password change (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let platformUser: TestInstitute;
  let reseller: TestReseller;
  let platformMembershipId: string;
  const usernames = {} as Record<Scope, string>;

  async function login(scope: Scope, password: string) {
    const res = await gqlRequest<Record<string, { accessToken: string; refreshToken: string }>>(
      result.httpServer,
      {
        query: `mutation ($u: String!, $p: String!) { ${LOGIN[scope]}(username: $u, password: $p) { accessToken refreshToken } }`,
        variables: { u: usernames[scope], p: password },
      },
    );
    expect(res.errors).toBeUndefined();
    const tokens = res.data?.[LOGIN[scope]];
    if (!tokens?.accessToken || !tokens.refreshToken) throw new Error(`${scope} login failed`);
    return tokens;
  }

  async function flag(userId: string) {
    const passwordHash = await hash(TEMP_PASSWORD);
    await withAdmin(result.db, mkAdminCtx('test:must-change-password'), (tx) =>
      tx.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, userId)),
    );
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    platformUser = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);
    const [membership] = await withAdmin(result.db, mkAdminCtx('test:must-change-password'), (tx) =>
      tx
        .insert(platformMemberships)
        .values({
          userId: platformUser.userId,
          roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: platformMemberships.id }),
    );
    platformMembershipId = membership.id;
    usernames.institute = institute.username;
    usernames.platform = platformUser.username;
    usernames.reseller = reseller.username;
    await flag(institute.userId);
    await flag(platformUser.userId);
    await flag(reseller.userId);
  });

  // The logins wrote auth_events rows, which keep the users; only the platform role is removed.
  afterAll(async () => {
    await withAdmin(result.db, mkAdminCtx('test:must-change-password'), (tx) =>
      tx.delete(platformMemberships).where(eq(platformMemberships.id, platformMembershipId)),
    );
    await result?.close();
  });

  describe.each<Scope>(['institute', 'reseller', 'platform'])('%s scope', (scope) => {
    it('allows only logout and changePassword until the password is changed', async () => {
      const first = await login(scope, TEMP_PASSWORD);
      expect(claimsOf(first.accessToken).mustChangePassword).toBe(true);

      for (const { query, refused } of [ORDINARY_QUERY[scope], ORDINARY_MUTATION]) {
        const blocked = await gqlRequest(result.httpServer, { query, token: first.accessToken });
        expect(blocked.errors?.[0]?.extensions?.code).toBe('PASSWORD_CHANGE_REQUIRED');
        expect(blocked.data ?? null).toEqual(refused);
      }

      const ticket = await request(result.httpServer)
        .get('/api/auth/ws-ticket')
        .set('Authorization', `Bearer ${first.accessToken}`);
      expect(ticket.status).toBe(403);

      // Logging out one session is allowed.
      const logout = await gqlRequest<{ logout: boolean }>(result.httpServer, {
        query: LOGOUT,
        variables: { t: first.refreshToken },
        token: first.accessToken,
      });
      expect(logout.errors).toBeUndefined();
      expect(logout.data?.logout).toBe(true);

      const second = await login(scope, TEMP_PASSWORD);
      const changed = await gqlRequest<{ changePassword: boolean }>(result.httpServer, {
        query: CHANGE_PASSWORD,
        variables: { c: TEMP_PASSWORD, n: NEW_PASSWORD },
        token: second.accessToken,
      });
      expect(changed.errors).toBeUndefined();
      expect(changed.data?.changePassword).toBe(true);

      const fresh = await login(scope, NEW_PASSWORD);
      expect(claimsOf(fresh.accessToken).mustChangePassword).toBe(false);
      const allowed = await gqlRequest(result.httpServer, {
        query: ORDINARY_QUERY[scope].query,
        token: fresh.accessToken,
      });
      expect(allowed.errors).toBeUndefined();
      const freshTicket = await request(result.httpServer)
        .get('/api/auth/ws-ticket')
        .set('Authorization', `Bearer ${fresh.accessToken}`);
      expect(freshTicket.status).toBe(200);
    });
  });

  it('lets a flagged institute user read me', async () => {
    const other = await createTestInstitute(result.db);
    usernames.institute = other.username;
    await flag(other.userId);
    const tokens = await login('institute', TEMP_PASSWORD);

    const me = await gqlRequest<{ me: { id: string } }>(result.httpServer, {
      query: ME,
      token: tokens.accessToken,
    });

    expect(me.errors).toBeUndefined();
    expect(me.data?.me.id).toBe(other.userId);
  });

  it('refuses a new password that breaks a rule and keeps the account flagged', async () => {
    const other = await createTestInstitute(result.db);
    usernames.institute = other.username;
    await flag(other.userId);
    const tokens = await login('institute', TEMP_PASSWORD);
    const mustChange = async () => {
      const [row] = await withAdmin(result.db, mkAdminCtx('test:must-change-password'), (tx) =>
        tx
          .select({ mustChangePassword: users.mustChangePassword })
          .from(users)
          .where(eq(users.id, other.userId)),
      );
      return row?.mustChangePassword;
    };

    for (const rejected of ['lowercase-only-1', 'abcdefghIJ', 'Ab1']) {
      const res = await gqlRequest(result.httpServer, {
        query: CHANGE_PASSWORD,
        variables: { c: TEMP_PASSWORD, n: rejected },
        token: tokens.accessToken,
      });
      expect(res.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      expect(await mustChange()).toBe(true);
    }

    const accepted = await gqlRequest<{ changePassword: boolean }>(result.httpServer, {
      query: CHANGE_PASSWORD,
      variables: { c: TEMP_PASSWORD, n: NEW_PASSWORD },
      token: tokens.accessToken,
    });
    expect(accepted.errors).toBeUndefined();
    expect(accepted.data?.changePassword).toBe(true);
    expect(await mustChange()).toBe(false);
  });

  it('does not expose public sign-up', async () => {
    const res = await request(result.httpServer)
      .post('/api/graphql')
      .set('Content-Type', 'application/json')
      .send({
        query: `mutation { register(input: { username: "squatter", email: "victim@institute.test", password: "Squat-123" }) { __typename } }`,
      });

    expect(res.status).toBe(400);
    expect(res.body.errors?.[0]?.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
    expect(res.body.errors?.[0]?.message).toBe('Cannot query field "register" on type "Mutation".');
  });
});
