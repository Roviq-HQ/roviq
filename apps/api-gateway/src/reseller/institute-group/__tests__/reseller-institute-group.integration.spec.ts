/**
 * ROV-290 — institute groups are isolated per reseller and per institute:
 * a reseller reads and manages only groups it owns (plus read access to
 * platform groups containing its institutes), and an institute reads only
 * the group it belongs to.
 */
import assert from 'node:assert';
import { GroupType } from '@roviq/common-types';
import {
  instituteGroups,
  institutes,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createInstituteToken,
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const CTX = 'test:reseller-institute-group';

const LIST = `query { resellerListInstituteGroups {
  totalCount
  edges { node { id instituteCount } }
} }`;
const CREATE = `mutation ($input: CreateInstituteGroupInput!) {
  resellerCreateInstituteGroup(input: $input) { id }
}`;
const ADD = `mutation ($instituteId: ID!, $groupId: ID!) {
  resellerAddInstituteToGroup(instituteId: $instituteId, groupId: $groupId)
}`;
const REMOVE = `mutation ($instituteId: ID!) {
  resellerRemoveInstituteFromGroup(instituteId: $instituteId)
}`;
const MY_GROUP = 'query { myInstituteGroup { id } }';

interface ListData {
  resellerListInstituteGroups: {
    totalCount: number;
    edges: { node: { id: string; instituteCount: number } }[];
  };
}

describe('Reseller institute groups (integration)', () => {
  let result: IntegrationAppResult;
  let r1: TestReseller;
  let r2: TestReseller;
  let r3: TestReseller;
  let a1: TestInstitute;
  let a2: TestInstitute;
  let b1: TestInstitute;
  let r1Token: string;
  let r2Token: string;
  let r3Token: string;
  let platformGroupId: string;
  let g1: string;
  let g2: string;

  const resellerToken = (r: TestReseller) =>
    createResellerToken({
      sub: r.userId,
      resellerId: r.resellerId,
      membershipId: r.membershipId,
      roleId: r.roleId,
    });
  const instituteToken = (t: TestInstitute) =>
    createInstituteToken({
      sub: t.userId,
      tenantId: t.tenantId,
      membershipId: t.membershipId,
      roleId: t.roleId,
    });

  async function groupOf(instituteId: string): Promise<string | null> {
    return withAdmin(result.db, mkAdminCtx(CTX), async (tx) => {
      const [row] = await tx
        .select({ groupId: institutes.groupId })
        .from(institutes)
        .where(eq(institutes.id, instituteId));
      assert(row);
      return row.groupId;
    });
  }

  async function list(token: string): Promise<ListData['resellerListInstituteGroups']> {
    const res = await gqlRequest<ListData>(result.httpServer, { query: LIST, token });
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.resellerListInstituteGroups;
  }

  async function createGroup(token: string, label: string): Promise<string> {
    const res = await gqlRequest<{ resellerCreateInstituteGroup: { id: string } }>(
      result.httpServer,
      {
        query: CREATE,
        variables: {
          input: {
            name: label,
            code: `${label}-${Date.now().toString(36)}`,
            type: GroupType.TRUST,
          },
        },
        token,
      },
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.resellerCreateInstituteGroup.id;
  }

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        {
          provide: 'JETSTREAM_CLIENT',
          useValue: {
            emit: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
            send: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
            connect: async () => undefined,
            close: async () => undefined,
          },
        },
      ],
    });

    r1 = await createTestReseller(result.db);
    r2 = await createTestReseller(result.db);
    r3 = await createTestReseller(result.db);
    a1 = await createTestInstitute(result.db, { resellerId: r1.resellerId });
    a2 = await createTestInstitute(result.db, { resellerId: r1.resellerId });
    b1 = await createTestInstitute(result.db, { resellerId: r2.resellerId });
    r1Token = resellerToken(r1);
    r2Token = resellerToken(r2);
    r3Token = resellerToken(r3);

    // A platform-managed group shared by one institute of each reseller.
    platformGroupId = await withAdmin(result.db, mkAdminCtx(CTX), async (tx) => {
      const [group] = await tx
        .insert(instituteGroups)
        .values({
          name: 'Shared platform group',
          code: `shared-${Date.now().toString(36)}`,
          type: GroupType.TRUST,
          resellerId: null,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: instituteGroups.id });
      assert(group);
      await tx
        .update(institutes)
        .set({ groupId: group.id })
        .where(inArray(institutes.id, [a2.tenantId, b1.tenantId]));
      return group.id;
    });

    g1 = await createGroup(r1Token, 'r1-own');
    g2 = await createGroup(r2Token, 'r2-own');
  });

  afterAll(async () => {
    for (const tenant of [a1, a2, b1]) {
      if (tenant) await cleanupTestInstitute(result.db, tenant);
    }
    const groupIds = [platformGroupId, g1, g2].filter((id): id is string => Boolean(id));
    if (groupIds.length > 0) {
      await withAdmin(result.db, mkAdminCtx(CTX), async (tx) => {
        await tx.delete(instituteGroups).where(inArray(instituteGroups.id, groupIds));
      });
    }
    for (const reseller of [r1, r2, r3]) {
      if (reseller) await cleanupTestReseller(result.db, reseller);
    }
    await result?.close();
  });

  it('lists the reseller’s own group and shared groups, counting only its own institutes', async () => {
    const page = await list(r1Token);
    const byId = new Map(page.edges.map((e) => [e.node.id, e.node.instituteCount]));

    expect([...byId.keys()].sort()).toEqual([g1, platformGroupId].sort());
    expect(page.totalCount).toBe(2);
    expect(byId.get(g1)).toBe(0);
    expect(byId.get(platformGroupId)).toBe(1);
  });

  it('returns an empty list for a reseller with no groups', async () => {
    const page = await list(r3Token);
    expect(page.edges).toEqual([]);
    expect(page.totalCount).toBe(0);
  });

  it('links the reseller’s own institute to its own group', async () => {
    const res = await gqlRequest<{ resellerAddInstituteToGroup: boolean }>(result.httpServer, {
      query: ADD,
      variables: { instituteId: a1.tenantId, groupId: g1 },
      token: r1Token,
    });
    expect(res.errors).toBeUndefined();
    expect(res.data?.resellerAddInstituteToGroup).toBe(true);
    expect(await groupOf(a1.tenantId)).toBe(g1);

    const page = await list(r1Token);
    expect(page.edges.find((e) => e.node.id === g1)?.node.instituteCount).toBe(1);
  });

  it('refuses to link another reseller’s institute', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: ADD,
      variables: { instituteId: b1.tenantId, groupId: g1 },
      token: r1Token,
    });
    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_NOT_FOUND');
    expect(await groupOf(b1.tenantId)).toBe(platformGroupId);
  });

  it('refuses to link into another reseller’s group', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: ADD,
      variables: { instituteId: a1.tenantId, groupId: g2 },
      token: r1Token,
    });
    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_GROUP_NOT_FOUND');
    expect(await groupOf(a1.tenantId)).toBe(g1);
  });

  it('refuses to link into a platform-managed group', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: ADD,
      variables: { instituteId: a1.tenantId, groupId: platformGroupId },
      token: r1Token,
    });
    expect(res.errors?.[0]?.extensions?.code).toBe('INSTITUTE_GROUP_NOT_FOUND');
    expect(await groupOf(a1.tenantId)).toBe(g1);
  });

  it('refuses to move an institute out of a platform-managed group', async () => {
    const moved = await gqlRequest(result.httpServer, {
      query: ADD,
      variables: { instituteId: a2.tenantId, groupId: g1 },
      token: r1Token,
    });
    expect(moved.errors?.[0]?.extensions?.code).toBe('INSTITUTE_NOT_FOUND');

    const removed = await gqlRequest(result.httpServer, {
      query: REMOVE,
      variables: { instituteId: a2.tenantId },
      token: r1Token,
    });
    expect(removed.errors?.[0]?.extensions?.code).toBe('INSTITUTE_NOT_FOUND');
    expect(await groupOf(a2.tenantId)).toBe(platformGroupId);
  });

  it('an institute reads only the group it belongs to', async () => {
    const own = await gqlRequest<{ myInstituteGroup: { id: string } | null }>(result.httpServer, {
      query: MY_GROUP,
      token: instituteToken(a1),
    });
    expect(own.errors).toBeUndefined();
    expect(own.data?.myInstituteGroup).toEqual({ id: g1 });

    const shared = await gqlRequest<{ myInstituteGroup: { id: string } | null }>(
      result.httpServer,
      { query: MY_GROUP, token: instituteToken(b1) },
    );
    expect(shared.errors).toBeUndefined();
    expect(shared.data?.myInstituteGroup).toEqual({ id: platformGroupId });
  });

  it('unlinks the reseller’s own institute, leaving it with no group', async () => {
    const res = await gqlRequest<{ resellerRemoveInstituteFromGroup: boolean }>(result.httpServer, {
      query: REMOVE,
      variables: { instituteId: a1.tenantId },
      token: r1Token,
    });
    expect(res.errors).toBeUndefined();
    expect(res.data?.resellerRemoveInstituteFromGroup).toBe(true);
    expect(await groupOf(a1.tenantId)).toBeNull();

    const none = await gqlRequest<{ myInstituteGroup: { id: string } | null }>(result.httpServer, {
      query: MY_GROUP,
      token: instituteToken(a1),
    });
    expect(none.errors).toBeUndefined();
    expect(none.data?.myInstituteGroup).toBeNull();
  });
});
