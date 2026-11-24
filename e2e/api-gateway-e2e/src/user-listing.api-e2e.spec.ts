/**
 * User listings over HTTP (ROV-216): adminListUsers, adminSearchUsers, resellerListUsers.
 *
 * Search ranking, statistics and role names are proven in depth by the integration specs
 * (admin-user.integration.spec.ts, user-listing-roles.integration.spec.ts). This file proves
 * the operations through real logins and guards, and that a reseller never receives a user of
 * another reseller's institute.
 */
import assert from 'node:assert';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  E2eAdminListUsersDocument,
  E2eAdminSearchUsersDocument,
  E2eMutationNamesDocument,
  E2eResellerListUsersDocument,
  E2eResellerOwnInstituteIdsDocument,
  E2eUserListingCreateResellerDocument,
} from './__generated__/graphql';
import { loginAsInstituteAdmin, loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { gql } from './helpers/gql-client';
import { waitForEmail } from './helpers/mailpit';

const SUPERUSER_URL =
  process.env.DATABASE_URL_E2E_MIGRATE ??
  process.env.DATABASE_URL_TEST_MIGRATE ??
  `postgresql://roviq:roviq_dev@localhost:${process.env.E2E_POSTGRES_PORT ?? '5435'}/roviq_test`;

const NEW_PASSWORD = 'User-Listing-Reseller-9';

const RESELLER_LOGIN = `mutation ($u: String!, $p: String!) {
  resellerLogin(username: $u, password: $p) { accessToken }
}`;

function errorCode(res: { errors?: ReadonlyArray<{ extensions?: Record<string, unknown> }> }) {
  return res.errors?.[0]?.extensions?.code;
}

/** A new reseller with no institutes, and its first admin's token past the password change. */
async function createSecondReseller(platformToken: string): Promise<{ id: string; token: string }> {
  const suffix = Date.now().toString(36);
  const email = `e2e-user-listing-${suffix}@roviq.test`;
  const created = await gql(
    E2eUserListingCreateResellerDocument,
    {
      input: {
        name: `E2E User Listing ${suffix}`,
        slug: `e2e-user-listing-${suffix}`,
        tier: 'FULL_MANAGEMENT',
        initialAdminEmail: email,
      },
    },
    platformToken,
  );
  expect(created.errors).toBeUndefined();
  const id = created.data?.adminCreateReseller.id;
  assert(id);

  const welcome = await waitForEmail(email, 'Welcome to Roviq');
  const tempPassword = /^Temporary password: (\S+)$/m.exec(welcome.text)?.[1];
  assert(tempPassword);
  const first = await gql<{ resellerLogin: { accessToken: string } }>(RESELLER_LOGIN, {
    u: email,
    p: tempPassword,
  });
  expect(first.errors).toBeUndefined();
  const firstToken = first.data?.resellerLogin.accessToken;
  assert(firstToken);
  const changed = await gql<{ changePassword: boolean }>(
    `mutation ($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }`,
    { c: tempPassword, n: NEW_PASSWORD },
    firstToken,
  );
  expect(changed.errors).toBeUndefined();
  const fresh = await gql<{ resellerLogin: { accessToken: string } }>(RESELLER_LOGIN, {
    u: email,
    p: NEW_PASSWORD,
  });
  expect(fresh.errors).toBeUndefined();
  const token = fresh.data?.resellerLogin.accessToken;
  assert(token);
  return { id, token };
}

describe('User listings E2E (ROV-216)', () => {
  let platformToken: string;
  let resellerToken: string;
  let instituteToken: string;

  beforeAll(async () => {
    platformToken = (await loginAsPlatformAdmin()).accessToken;
    resellerToken = (await loginAsReseller()).accessToken;
    instituteToken = (await loginAsInstituteAdmin()).accessToken;
  });

  describe('adminListUsers', () => {
    it('should return only users with a membership in the filtered institute', async () => {
      const res = await gql(
        E2eAdminListUsersDocument,
        { filter: { tenantId: SEED.INSTITUTE_1.id, first: 100 } },
        platformToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const nodes = res.data.adminListUsers.edges.map((e) => e.node);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.memberships.map((m) => m.tenantId)).toContain(SEED.INSTITUTE_1.id);
      }
      expect(nodes.map((n) => n.id)).toContain(SEED.ADMIN_USER.id);
    });

    it('should find the seeded admin by username', async () => {
      const res = await gql(
        E2eAdminListUsersDocument,
        // Other specs create many accounts whose names contain the seeded username, so the
        // search is narrowed to the seeded institute to keep the admin on the first page.
        { filter: { search: SEED.ADMIN_USER.username, tenantId: SEED.INSTITUTE_1.id, first: 100 } },
        platformToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const usernames = res.data.adminListUsers.edges.map((e) => e.node.username);
      expect(usernames).toContain(SEED.ADMIN_USER.username);
    });

    it('should answer a search made of tsquery operators without an error', async () => {
      const res = await gql(
        E2eAdminListUsersDocument,
        { filter: { search: 'a & | ! :* (' } },
        platformToken,
      );
      expect(res.errors).toBeUndefined();
      expect(res.data?.adminListUsers.totalCount).toBeGreaterThanOrEqual(0);
    });

    it('should page through users without repeating one, with the same total on each page', async () => {
      const page1 = await gql(E2eAdminListUsersDocument, { filter: { first: 2 } }, platformToken);
      expect(page1.errors).toBeUndefined();
      assert(page1.data);
      const first = page1.data.adminListUsers;
      expect(first.edges).toHaveLength(2);
      expect(first.pageInfo.hasNextPage).toBe(true);
      assert(first.pageInfo.endCursor);

      const page2 = await gql(
        E2eAdminListUsersDocument,
        { filter: { first: 2, after: first.pageInfo.endCursor } },
        platformToken,
      );
      expect(page2.errors).toBeUndefined();
      assert(page2.data);
      const second = page2.data.adminListUsers;
      expect(second.edges).toHaveLength(2);
      expect(second.totalCount).toBe(first.totalCount);
      const firstIds = first.edges.map((e) => e.node.id);
      for (const edge of second.edges) expect(firstIds).not.toContain(edge.node.id);
    });
  });

  describe('adminSearchUsers', () => {
    it('should return the seeded admin for its username', async () => {
      const res = await gql(
        E2eAdminSearchUsersDocument,
        { query: SEED.ADMIN_USER.username },
        platformToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminSearchUsers.map((u) => u.id)).toContain(SEED.ADMIN_USER.id);
    });

    it('should return exactly one row for limit 1', async () => {
      const res = await gql(E2eAdminSearchUsersDocument, { query: 'e', limit: 1 }, platformToken);
      expect(res.errors).toBeUndefined();
      expect(res.data?.adminSearchUsers).toHaveLength(1);
    });

    it('should cap a limit above 50 at 50 rows', async () => {
      const res = await gql(E2eAdminSearchUsersDocument, { query: 'e', limit: 500 }, platformToken);
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.adminSearchUsers.length).toBeLessThanOrEqual(50);
    });
  });

  describe('resellerListUsers', () => {
    let pool: pg.Pool;
    let second: { id: string; token: string };

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: SUPERUSER_URL });
      second = await createSecondReseller(platformToken);
    }, 60_000);

    afterAll(async () => {
      if (second) {
        await pool.query('DELETE FROM reseller_memberships WHERE reseller_id = $1', [second.id]);
        await pool.query('DELETE FROM roles WHERE reseller_id = $1', [second.id]);
        await pool.query('DELETE FROM resellers WHERE id = $1', [second.id]);
      }
      await pool?.end();
    });

    it("should list users of the reseller's institutes and only memberships in them", async () => {
      const own = await gql(
        E2eResellerOwnInstituteIdsDocument,
        { filter: { first: 100 } },
        resellerToken,
      );
      expect(own.errors).toBeUndefined();
      assert(own.data);
      expect(own.data.resellerListInstitutes.pageInfo.hasNextPage).toBe(false);
      const ownIds = own.data.resellerListInstitutes.edges.map((e) => e.node.id);
      expect(ownIds).toContain(SEED.INSTITUTE_1.id);

      const res = await gql(
        E2eResellerListUsersDocument,
        { filter: { instituteId: SEED.INSTITUTE_1.id, first: 100 } },
        resellerToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const nodes = res.data.resellerListUsers.edges.map((e) => e.node);
      expect(nodes.map((n) => n.id)).toContain(SEED.ADMIN_USER.id);
      for (const node of nodes) {
        expect(node.memberships.length).toBeGreaterThan(0);
        for (const m of node.memberships) expect(ownIds).toContain(m.tenantId);
      }
    });

    it('should give a reseller with no institutes an empty list', async () => {
      const res = await gql(E2eResellerListUsersDocument, { filter: { first: 100 } }, second.token);
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.resellerListUsers.edges).toEqual([]);
      expect(res.data.resellerListUsers.totalCount).toBe(0);
    });

    it("should answer another reseller's institute id with an empty list, not its users", async () => {
      const res = await gql(
        E2eResellerListUsersDocument,
        { filter: { instituteId: SEED.INSTITUTE_1.id } },
        second.token,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.resellerListUsers.edges).toEqual([]);
      expect(res.data.resellerListUsers.totalCount).toBe(0);
    });

    it('should not find a user of another reseller by search', async () => {
      const res = await gql(
        E2eResellerListUsersDocument,
        { filter: { search: SEED.ADMIN_USER.username } },
        second.token,
      );
      expect(res.errors).toBeUndefined();
      expect(res.data?.resellerListUsers.edges).toEqual([]);
    });

    it('should offer resellers no mutation on users', async () => {
      const res = await gql(E2eMutationNamesDocument, undefined, resellerToken);
      expect(res.errors).toBeUndefined();
      const names = res.data?.__schema.mutationType?.fields?.map((f) => f.name) ?? [];
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => /^reseller(Create|Update|Delete)User/.test(n))).toEqual([]);
    });
  });

  describe('wrong scope and no token', () => {
    it('should refuse adminListUsers and adminSearchUsers to institute and reseller tokens', async () => {
      for (const token of [instituteToken, resellerToken]) {
        const list = await gql(E2eAdminListUsersDocument, {}, token);
        expect(errorCode(list)).toBe('FORBIDDEN');
        expect(list.data).toBeNull();
        const search = await gql(E2eAdminSearchUsersDocument, { query: 'admin' }, token);
        expect(errorCode(search)).toBe('FORBIDDEN');
        expect(search.data).toBeNull();
      }
    });

    it('should refuse resellerListUsers to institute and platform tokens', async () => {
      for (const token of [instituteToken, platformToken]) {
        const res = await gql(E2eResellerListUsersDocument, {}, token);
        expect(errorCode(res)).toBe('FORBIDDEN');
        expect(res.data).toBeNull();
      }
    });

    it('should refuse every listing without a token', async () => {
      const results = [
        await gql(E2eAdminListUsersDocument, {}),
        await gql(E2eAdminSearchUsersDocument, { query: 'admin' }),
        await gql(E2eResellerListUsersDocument, {}),
      ];
      for (const res of results) expect(errorCode(res)).toBe('UNAUTHENTICATED');
    });
  });
});
