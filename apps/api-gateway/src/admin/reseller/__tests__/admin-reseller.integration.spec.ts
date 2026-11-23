/** Platform reseller management: create, read, team, list paging and versioned update. */
import { randomUUID } from 'node:crypto';
import {
  createIntegrationApp,
  createPlatformToken,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const RESELLER_FIELDS = 'id name slug tier status version instituteCount teamSize';
const CREATE = `mutation ($input: AdminCreateResellerInput!) {
  adminCreateReseller(input: $input) { ${RESELLER_FIELDS} }
}`;
const GET = `query ($id: ID!) { adminGetReseller(id: $id) { ${RESELLER_FIELDS} } }`;
const TEAM = `query ($id: ID!) {
  adminListResellerTeam(resellerId: $id) { userId username email isActive }
}`;
const UPDATE = `mutation ($id: ID!, $input: AdminUpdateResellerInput!) {
  adminUpdateReseller(id: $id, input: $input) { ${RESELLER_FIELDS} }
}`;
const LIST = `query ($filter: AdminListResellersFilterInput) {
  adminListResellers(filter: $filter) {
    totalCount
    edges { cursor node { id slug } }
    pageInfo { hasNextPage hasPreviousPage endCursor }
  }
}`;

interface ResellerRow {
  id: string;
  name: string;
  slug: string;
  tier: string;
  status: string;
  version: number;
  instituteCount: number;
  teamSize: number;
}

interface ListResult {
  adminListResellers: {
    totalCount: number;
    edges: { cursor: string; node: { id: string; slug: string } }[];
    pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; endCursor: string | null };
  };
}

describe('Admin reseller management (integration)', () => {
  let result: IntegrationAppResult;
  let token: string;
  const suffix = randomUUID().slice(0, 8);
  let first: ResellerRow;
  let second: ResellerRow;

  const create = (name: string, slug: string, email: string) =>
    gqlRequest<{ adminCreateReseller: ResellerRow }>(result.httpServer, {
      query: CREATE,
      token,
      variables: { input: { name, slug, tier: 'READ_ONLY', initialAdminEmail: email } },
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    token = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

    const a = await create(
      `Repo One ${suffix}`,
      `repo-one-${suffix}`,
      `one-${suffix}@example.test`,
    );
    expect(a.errors).toBeUndefined();
    const b = await create(
      `Repo Two ${suffix}`,
      `repo-two-${suffix}`,
      `two-${suffix}@example.test`,
    );
    expect(b.errors).toBeUndefined();
    first = a.data?.adminCreateReseller as ResellerRow;
    second = b.data?.adminCreateReseller as ResellerRow;
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should create an active reseller with its first admin on the team', async () => {
    expect(first).toEqual({
      id: first.id,
      name: `Repo One ${suffix}`,
      slug: `repo-one-${suffix}`,
      tier: 'READ_ONLY',
      status: 'ACTIVE',
      version: 1,
      instituteCount: 0,
      teamSize: 1,
    });

    const got = await gqlRequest<{ adminGetReseller: ResellerRow }>(result.httpServer, {
      query: GET,
      token,
      variables: { id: first.id },
    });
    expect(got.errors).toBeUndefined();
    expect(got.data?.adminGetReseller).toEqual(first);

    const team = await gqlRequest<{
      adminListResellerTeam: {
        userId: string;
        username: string;
        email: string;
        isActive: boolean;
      }[];
    }>(result.httpServer, { query: TEAM, token, variables: { id: first.id } });
    expect(team.errors).toBeUndefined();
    expect(team.data?.adminListResellerTeam).toEqual([
      {
        userId: team.data?.adminListResellerTeam[0]?.userId,
        username: `one-${suffix}@example.test`,
        email: `one-${suffix}@example.test`,
        isActive: true,
      },
    ]);
  });

  it('should refuse a slug that another reseller holds', async () => {
    const res = await create(
      `Repo Dup ${suffix}`,
      `repo-one-${suffix}`,
      `dup-${suffix}@example.test`,
    );
    expect(res.errors?.[0]?.extensions?.code).toBe('SLUG_DUPLICATE');
  });

  it('should answer RESELLER_NOT_FOUND for an unknown id on read and team', async () => {
    const id = randomUUID();
    const got = await gqlRequest(result.httpServer, { query: GET, token, variables: { id } });
    expect(got.errors?.[0]?.extensions?.code).toBe('RESELLER_NOT_FOUND');
    const team = await gqlRequest(result.httpServer, { query: TEAM, token, variables: { id } });
    expect(team.errors?.[0]?.extensions?.code).toBe('RESELLER_NOT_FOUND');
  });

  it('should page the search newest first with a cursor', async () => {
    const page1 = await gqlRequest<ListResult>(result.httpServer, {
      query: LIST,
      token,
      variables: { filter: { search: suffix, first: 1 } },
    });
    expect(page1.errors).toBeUndefined();
    const list1 = page1.data?.adminListResellers;
    expect(list1?.totalCount).toBe(2);
    expect(list1?.edges.map((e) => e.node.id)).toEqual([second.id]);
    expect(list1?.pageInfo.hasNextPage).toBe(true);
    expect(list1?.pageInfo.hasPreviousPage).toBe(false);

    const page2 = await gqlRequest<ListResult>(result.httpServer, {
      query: LIST,
      token,
      variables: { filter: { search: suffix, first: 1, after: list1?.pageInfo.endCursor } },
    });
    expect(page2.errors).toBeUndefined();
    const list2 = page2.data?.adminListResellers;
    expect(list2?.edges.map((e) => e.node.id)).toEqual([first.id]);
    expect(list2?.pageInfo.hasNextPage).toBe(false);
    expect(list2?.pageInfo.hasPreviousPage).toBe(true);
  });

  it('should update under the current version and refuse a stale one', async () => {
    const updated = await gqlRequest<{ adminUpdateReseller: ResellerRow }>(result.httpServer, {
      query: UPDATE,
      token,
      variables: { id: second.id, input: { version: second.version, name: `Renamed ${suffix}` } },
    });
    expect(updated.errors).toBeUndefined();
    expect(updated.data?.adminUpdateReseller).toEqual({
      ...second,
      name: `Renamed ${suffix}`,
      version: second.version + 1,
    });

    const stale = await gqlRequest(result.httpServer, {
      query: UPDATE,
      token,
      variables: { id: second.id, input: { version: second.version, name: 'Too late' } },
    });
    expect(stale.errors?.[0]?.extensions?.code).toBe('CONCURRENT_MODIFICATION');

    const got = await gqlRequest<{ adminGetReseller: ResellerRow }>(result.httpServer, {
      query: GET,
      token,
      variables: { id: second.id },
    });
    expect(got.data?.adminGetReseller.name).toBe(`Renamed ${suffix}`);
  });
});
