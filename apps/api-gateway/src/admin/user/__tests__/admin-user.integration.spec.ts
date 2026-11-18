/**
 * Admin user queries (ROV-181) through the full pipeline: JWT → platform scope
 * guard → CASL → AdminUserDrizzleRepository → withAdmin → *_live views.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  authEvents,
  memberships,
  mkAdminCtx,
  phoneNumbers,
  SYSTEM_USER_ID,
  userAddresses,
  userDocuments,
  userIdentifiers,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';
import { AdminUserRepository } from '../repositories/admin-user.repository';

const GET_USER = /* GraphQL */ `
  query ($userId: ID!) {
    adminGetUser(userId: $userId) {
      id
      username
      lastActiveAt
      primaryPhone { countryCode number }
      profile { firstName gender nationality }
      memberships { tenantId instituteName roleName status }
      resellerMemberships { id }
      platformMembership { id }
      identifiers { type displayValue isVerified }
      documents { type fileUrls isVerified }
      addresses { type city district }
    }
  }
`;

const LIST_USERS = /* GraphQL */ `
  query ($filter: AdminListUsersFilterInput) {
    adminListUsers(filter: $filter) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { node { id username memberships { id } primaryPhone { number } } }
    }
  }
`;

const STATS = /* GraphQL */ `
  query {
    adminUserStatistics { totalUsers activeThisMonth newThisWeek multiInstituteUsers }
  }
`;

interface Stats {
  totalUsers: number;
  activeThisMonth: number;
  newThisWeek: number;
  multiInstituteUsers: number;
}

interface ListResult {
  adminListUsers: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{
      node: {
        id: string;
        username: string;
        memberships: Array<{ id: string }>;
        primaryPhone: { number: string } | null;
      };
    }>;
  };
}

describe('Admin user queries (integration)', () => {
  let result: IntegrationAppResult;
  let instituteA: TestInstitute;
  let instituteB: TestInstitute;
  let platformToken: string;
  const run = randomUUID().slice(0, 6);
  const firstName = `Zorvik${run}`;
  const phone = `9${Date.now().toString().slice(-9)}`;

  const gql = <T>(query: string, variables: Record<string, unknown> = {}, token = platformToken) =>
    gqlRequest<T>(result.httpServer, { query, variables, token });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    platformToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

    instituteA = await createTestInstitute(result.db, { slugSuffix: `${run}a` });
    instituteB = await createTestInstitute(result.db, { slugSuffix: `${run}b` });

    const userId = instituteA.userId;
    const audit = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
    await withAdmin(result.db, mkAdminCtx('test:admin-user'), async (tx) => {
      // Second institute makes this a multi-institute user.
      await tx.insert(memberships).values({
        userId,
        tenantId: instituteB.tenantId,
        roleId: instituteB.roleId,
        ...audit,
      });
      await tx.insert(userProfiles).values({
        userId,
        firstName: { en: firstName },
        lastName: { en: 'Sharma' },
        gender: 'FEMALE',
        ...audit,
      });
      await tx
        .insert(phoneNumbers)
        .values({ userId, countryCode: '91', number: phone, isPrimary: true, ...audit });
      await tx.insert(userIdentifiers).values([
        {
          userId,
          type: 'AADHAAR',
          valueEncrypted: Buffer.from('ciphertext'),
          valueHash: 'a'.repeat(64),
          valueMasked: 'XXXX-XXXX-4321',
          isVerified: true,
          ...audit,
        },
        { userId, type: 'APAAR', valuePlain: '123456789012', ...audit },
      ]);
      await tx.insert(userDocuments).values({
        userId,
        type: 'BIRTH_CERTIFICATE',
        fileUrls: ['https://files.test/birth.pdf'],
        ...audit,
      });
      await tx.insert(userAddresses).values({
        userId,
        type: 'PERMANENT',
        line1: '12 Model Town',
        city: 'Hisar',
        district: 'Hisar',
        state: 'Haryana',
        postalCode: '125001',
        ...audit,
      });
      await tx.insert(authEvents).values({ userId, eventType: 'token_refresh' });
    });
  });

  afterAll(async () => {
    const userIds = [instituteA?.userId, instituteB?.userId].filter(Boolean);
    if (userIds.length > 0) {
      await withAdmin(result.db, mkAdminCtx('test:admin-user'), async (tx) => {
        await tx.delete(authEvents).where(inArray(authEvents.userId, userIds));
        await tx.delete(userAddresses).where(inArray(userAddresses.userId, userIds));
        await tx.delete(userDocuments).where(inArray(userDocuments.userId, userIds));
        await tx.delete(userIdentifiers).where(inArray(userIdentifiers.userId, userIds));
        await tx.delete(phoneNumbers).where(inArray(phoneNumbers.userId, userIds));
        await tx.delete(userProfiles).where(inArray(userProfiles.userId, userIds));
        await tx.delete(memberships).where(eq(memberships.userId, instituteA.userId));
      });
    }
    if (instituteA) await cleanupTestInstitute(result.db, instituteA);
    if (instituteB) await cleanupTestInstitute(result.db, instituteB);
    await result?.close();
  });

  it('returns the full detail with Aadhaar reduced to its last four digits', async () => {
    const res = await gql<{
      adminGetUser: {
        id: string;
        lastActiveAt: string | null;
        primaryPhone: { countryCode: string; number: string };
        profile: { firstName: Record<string, string>; gender: string; nationality: string };
        memberships: Array<{ tenantId: string; instituteName: Record<string, string> }>;
        resellerMemberships: unknown[];
        platformMembership: unknown;
        identifiers: Array<{ type: string; displayValue: string; isVerified: boolean }>;
        documents: Array<{ type: string; fileUrls: string[]; isVerified: boolean }>;
        addresses: Array<{ type: string; city: string; district: string }>;
      };
    }>(GET_USER, { userId: instituteA.userId });

    expect(res.errors).toBeUndefined();
    const user = res.data?.adminGetUser;
    expect(user?.profile).toEqual({
      firstName: { en: firstName },
      gender: 'FEMALE',
      nationality: 'Indian',
    });
    expect(user?.primaryPhone).toEqual({ countryCode: '91', number: phone });
    expect(user?.lastActiveAt).not.toBeNull();
    expect(user?.memberships.map((m) => m.tenantId).sort()).toEqual(
      [instituteA.tenantId, instituteB.tenantId].sort(),
    );
    expect(
      user?.memberships.find((m) => m.tenantId === instituteA.tenantId)?.instituteName,
    ).toEqual({
      en: `Test Institute ${run}a`,
    });
    expect(user?.resellerMemberships).toEqual([]);
    expect(user?.platformMembership).toBeNull();
    expect(user?.identifiers).toEqual([
      { type: 'AADHAAR', displayValue: 'XXXX XXXX 4321', isVerified: true },
      { type: 'APAAR', displayValue: '123456789012', isVerified: false },
    ]);
    expect(user?.documents).toEqual([
      { type: 'BIRTH_CERTIFICATE', fileUrls: ['https://files.test/birth.pdf'], isVerified: false },
    ]);
    expect(user?.addresses).toEqual([{ type: 'PERMANENT', city: 'Hisar', district: 'Hisar' }]);
  });

  it('returns NOT_FOUND for an unknown user and rejects a malformed id', async () => {
    const missing = await gql(GET_USER, { userId: randomUUID() });
    expect(missing.errors?.[0]?.extensions?.code).toBe('NOT_FOUND');

    const malformed = await gql(GET_USER, { userId: 'not-a-uuid' });
    expect(malformed.data).toBeNull();
    expect(malformed.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
  });

  it('finds the user by profile name, phone and email, with membership count and phone', async () => {
    for (const search of [firstName.toLowerCase(), phone.slice(-6), `test_admin_${run}a@`]) {
      const res = await gql<ListResult>(LIST_USERS, { filter: { search } });
      expect(res.errors).toBeUndefined();
      const nodes = res.data?.adminListUsers.edges.map((e) => e.node) ?? [];
      expect(nodes.map(({ memberships: _, ...rest }) => rest)).toEqual([
        { id: instituteA.userId, username: instituteA.username, primaryPhone: { number: phone } },
      ]);
      expect(nodes[0]?.memberships).toHaveLength(2);
    }
  });

  it('tolerates tsquery operators in the search text', async () => {
    const res = await gql<ListResult>(LIST_USERS, { filter: { search: `${firstName} & :* (` } });
    expect(res.errors).toBeUndefined();
    expect(res.data?.adminListUsers.edges.map((e) => e.node.id)).toEqual([instituteA.userId]);
  });

  it('applies membership and date filters', async () => {
    const search = `test_admin_${run}`;
    const ids = async (filter: Record<string, unknown>) => {
      const res = await gql<ListResult>(LIST_USERS, { filter: { search, ...filter } });
      expect(res.errors).toBeUndefined();
      return res.data?.adminListUsers.edges.map((e) => e.node.id).sort() ?? [];
    };
    const both = [instituteA.userId, instituteB.userId].sort();

    expect(await ids({ hasInstituteMembership: true })).toEqual(both);
    expect(await ids({ hasInstituteMembership: false })).toEqual([]);
    expect(await ids({ hasPlatformMembership: true })).toEqual([]);
    expect(await ids({ hasResellerMembership: false })).toEqual(both);
    expect(await ids({ tenantId: instituteB.tenantId })).toEqual(both);
    expect(await ids({ createdAfter: new Date(Date.now() + 86_400_000).toISOString() })).toEqual(
      [],
    );
    expect(await ids({ createdBefore: new Date(Date.now() + 86_400_000).toISOString() })).toEqual(
      both,
    );
  });

  it('pages newest first without overlap and keeps totalCount stable', async () => {
    const filter = { search: `test_admin_${run}`, first: 1 };
    const page1 = await gql<ListResult>(LIST_USERS, { filter });
    const after = page1.data?.adminListUsers.pageInfo.endCursor;
    const page2 = await gql<ListResult>(LIST_USERS, { filter: { ...filter, after } });

    expect(page1.data?.adminListUsers.totalCount).toBe(2);
    expect(page2.data?.adminListUsers.totalCount).toBe(2);
    expect(page1.data?.adminListUsers.pageInfo.hasNextPage).toBe(true);
    expect(page2.data?.adminListUsers.pageInfo.hasNextPage).toBe(false);
    expect([
      page1.data?.adminListUsers.edges[0]?.node.id,
      page2.data?.adminListUsers.edges[0]?.node.id,
    ]).toEqual([instituteB.userId, instituteA.userId]);
  });

  it('pages through users created in one transaction (identical microsecond timestamps)', async () => {
    const prefix = `twin_${run}_`;
    const twins = await withAdmin(result.db, mkAdminCtx('test:admin-user'), (tx) =>
      tx
        .insert(users)
        .values(
          [1, 2, 3].map((n) => ({
            username: `${prefix}${n}`,
            email: `${prefix}${n}@test.local`,
            passwordHash: 'not-a-real-hash',
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })),
        )
        .returning({ id: users.id }),
    );
    try {
      const seen: string[] = [];
      let after: string | null | undefined;
      for (let i = 0; i < 4; i++) {
        const res = await gql<ListResult>(LIST_USERS, {
          filter: { search: prefix, first: 1, ...(after ? { after } : {}) },
        });
        seen.push(...(res.data?.adminListUsers.edges.map((e) => e.node.id) ?? []));
        after = res.data?.adminListUsers.pageInfo.endCursor;
        if (!res.data?.adminListUsers.pageInfo.hasNextPage) break;
      }

      expect(seen.sort()).toEqual(twins.map((t) => t.id).sort());
    } finally {
      await withAdmin(result.db, mkAdminCtx('test:admin-user'), (tx) =>
        tx.delete(users).where(
          inArray(
            users.id,
            twins.map((t) => t.id),
          ),
        ),
      );
    }
  });

  it('counts the window metrics relative to the given now', async () => {
    // A window in 2001 holds only these fixtures, so parallel suites cannot shift the counts.
    const now = new Date('2001-01-15T00:00:00Z');
    const prefix = `stats_${run}_`;
    const [newUser, oldUser] = await withAdmin(result.db, mkAdminCtx('test:admin-user'), (tx) =>
      tx
        .insert(users)
        .values(
          [new Date('2001-01-12T00:00:00Z'), new Date('2000-06-01T00:00:00Z')].map(
            (createdAt, n) => ({
              username: `${prefix}${n}`,
              email: `${prefix}${n}@test.local`,
              passwordHash: 'not-a-real-hash',
              createdAt,
              createdBy: SYSTEM_USER_ID,
              updatedBy: SYSTEM_USER_ID,
            }),
          ),
        )
        .returning({ id: users.id }),
    );
    assert(newUser && oldUser);
    try {
      await withAdmin(result.db, mkAdminCtx('test:admin-user'), (tx) =>
        tx.insert(authEvents).values([
          {
            userId: oldUser.id,
            eventType: 'token_refresh',
            createdAt: new Date('2001-01-01T00:00:00Z'),
          },
          {
            userId: newUser.id,
            eventType: 'token_refresh',
            createdAt: new Date('2000-11-01T00:00:00Z'),
          },
          {
            userId: newUser.id,
            eventType: 'institute_switch',
            createdAt: new Date('2001-02-01T00:00:00Z'),
          },
        ]),
      );

      const stats = await result.app.get(AdminUserRepository).statistics(now);

      expect({ activeThisMonth: stats.activeThisMonth, newThisWeek: stats.newThisWeek }).toEqual({
        activeThisMonth: 1,
        newThisWeek: 1,
      });
    } finally {
      const ids = [newUser.id, oldUser.id];
      await withAdmin(result.db, mkAdminCtx('test:admin-user'), async (tx) => {
        await tx.delete(authEvents).where(inArray(authEvents.userId, ids));
        await tx.delete(users).where(inArray(users.id, ids));
      });
    }
  });

  it('includes the fixtures in the platform-wide statistics', async () => {
    const res = await gql<{ adminUserStatistics: Stats }>(STATS);
    const stats = res.data?.adminUserStatistics;

    // Platform-wide totals move while other suites run, so only the fixtures' presence is exact.
    expect(res.errors).toBeUndefined();
    assert(stats);
    expect(stats.totalUsers).toBeGreaterThanOrEqual(2);
    expect(stats.multiInstituteUsers).toBeGreaterThanOrEqual(1);
    expect(stats.activeThisMonth).toBeGreaterThanOrEqual(1);
  });

  it('rejects an institute token on adminGetUser and adminUserStatistics', async () => {
    const token = createInstituteToken({
      sub: instituteA.userId,
      tenantId: instituteA.tenantId,
      membershipId: instituteA.membershipId,
      roleId: instituteA.roleId,
    });
    for (const [query, variables] of [
      [GET_USER, { userId: instituteA.userId }],
      [STATS, {}],
    ] as const) {
      const res = await gql(query, variables, token);
      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    }
  });
});
