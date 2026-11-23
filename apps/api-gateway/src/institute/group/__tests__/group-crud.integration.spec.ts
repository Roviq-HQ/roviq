/**
 * Integration tests for getGroup, updateGroup, deleteGroup, listGroupMembers and
 * setGroupMemberExcluded against the real database, including another institute's ids.
 */
import { randomUUID } from 'node:crypto';
import { DomainGroupType, DynamicGroupStatus, GroupMembershipType } from '@roviq/common-types';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const CREATE_GROUP = /* GraphQL */ `
  mutation CreateGroup($input: CreateGroupInput!) {
    createGroup(input: $input) { id name status resolvedAt }
  }
`;
const GET_GROUP = /* GraphQL */ `
  query GetGroup($id: ID!) { getGroup(id: $id) { id name description status resolvedAt } }
`;
const UPDATE_GROUP = /* GraphQL */ `
  mutation UpdateGroup($id: ID!, $input: UpdateGroupInput!) {
    updateGroup(id: $id, input: $input) { id name description status resolvedAt }
  }
`;
const DELETE_GROUP = /* GraphQL */ `
  mutation DeleteGroup($id: ID!) { deleteGroup(id: $id) }
`;
const RESOLVE_GROUP_MEMBERS = /* GraphQL */ `
  mutation ResolveGroupMembers($groupId: ID!) {
    resolveGroupMembers(groupId: $groupId) { groupId memberCount resolvedAt }
  }
`;
const LIST_GROUP_MEMBERS = /* GraphQL */ `
  query ListGroupMembers($groupId: ID!) { listGroupMembers(groupId: $groupId) { id } }
`;
const SET_MEMBER_EXCLUDED = /* GraphQL */ `
  mutation SetGroupMemberExcluded($groupId: ID!, $memberId: ID!, $excluded: Boolean!) {
    setGroupMemberExcluded(groupId: $groupId, memberId: $memberId, excluded: $excluded) { id }
  }
`;

interface GroupNode {
  id: string;
  name: string;
  description: string | null;
  status: DynamicGroupStatus;
  resolvedAt: string | null;
}

describe('Group CRUD (integration)', () => {
  let result: IntegrationAppResult;
  let tokenA: string;
  let tokenB: string;

  function tokenFor(institute: TestInstitute) {
    return createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
  }

  async function createGroup(token: string, name: string): Promise<string> {
    const res = await gqlRequest<{ createGroup: GroupNode }>(result.httpServer, {
      query: CREATE_GROUP,
      token,
      variables: {
        input: {
          name,
          groupType: DomainGroupType.CLUB,
          membershipType: GroupMembershipType.STATIC,
        },
      },
    });
    expect(res.errors).toBeUndefined();
    const id = res.data?.createGroup.id;
    expect(id).toBeDefined();
    return id ?? '';
  }

  async function getGroup(token: string, id: string) {
    return gqlRequest<{ getGroup: GroupNode }>(result.httpServer, {
      query: GET_GROUP,
      token,
      variables: { id },
    });
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    tokenA = tokenFor(await createTestInstitute(result.db));
    tokenB = tokenFor(await createTestInstitute(result.db));
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should update the name, description and status of a group', async () => {
    const id = await createGroup(tokenA, 'Debate Club');

    const res = await gqlRequest<{ updateGroup: GroupNode }>(result.httpServer, {
      query: UPDATE_GROUP,
      token: tokenA,
      variables: {
        id,
        input: {
          name: 'Debate Society',
          description: 'Fridays',
          status: DynamicGroupStatus.INACTIVE,
        },
      },
    });

    expect(res.errors).toBeUndefined();
    const stored = await getGroup(tokenA, id);
    expect(stored.data?.getGroup).toEqual({
      id,
      name: 'Debate Society',
      description: 'Fridays',
      status: DynamicGroupStatus.INACTIVE,
      resolvedAt: null,
    });
  });

  it('should clear the last resolution when the rule changes', async () => {
    const id = await createGroup(tokenA, 'Rule Club');
    const resolved = await gqlRequest(result.httpServer, {
      query: RESOLVE_GROUP_MEMBERS,
      token: tokenA,
      variables: { groupId: id },
    });
    expect(resolved.errors).toBeUndefined();
    expect((await getGroup(tokenA, id)).data?.getGroup.resolvedAt).not.toBeNull();

    const res = await gqlRequest<{ updateGroup: GroupNode }>(result.httpServer, {
      query: UPDATE_GROUP,
      token: tokenA,
      variables: { id, input: { rule: { '==': [{ var: 'academic_status' }, 'ENROLLED'] } } },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.updateGroup.resolvedAt).toBeNull();
    expect((await getGroup(tokenA, id)).data?.getGroup.resolvedAt).toBeNull();
  });

  it("should refuse to read, update or delete another institute's group and change nothing", async () => {
    const id = await createGroup(tokenA, 'Chess Club');

    expect((await getGroup(tokenB, id)).errors?.[0]?.extensions?.code).toBe('GROUP_NOT_FOUND');
    const update = await gqlRequest(result.httpServer, {
      query: UPDATE_GROUP,
      token: tokenB,
      variables: { id, input: { name: 'Taken over' } },
    });
    expect(update.errors?.[0]?.extensions?.code).toBe('GROUP_NOT_FOUND');
    const del = await gqlRequest(result.httpServer, {
      query: DELETE_GROUP,
      token: tokenB,
      variables: { id },
    });
    expect(del.errors?.[0]?.extensions?.code).toBe('GROUP_NOT_FOUND');

    expect((await getGroup(tokenA, id)).data?.getGroup.name).toBe('Chess Club');
  });

  it('should delete a group once and then answer GROUP_NOT_FOUND', async () => {
    const id = await createGroup(tokenA, 'Drama Club');

    const del = await gqlRequest<{ deleteGroup: boolean }>(result.httpServer, {
      query: DELETE_GROUP,
      token: tokenA,
      variables: { id },
    });
    expect(del.errors).toBeUndefined();
    expect(del.data?.deleteGroup).toBe(true);

    expect((await getGroup(tokenA, id)).errors?.[0]?.extensions?.code).toBe('GROUP_NOT_FOUND');
    const again = await gqlRequest(result.httpServer, {
      query: DELETE_GROUP,
      token: tokenA,
      variables: { id },
    });
    expect(again.errors?.[0]?.extensions?.code).toBe('GROUP_NOT_FOUND');
  });

  it('should list no members for a new static group', async () => {
    const id = await createGroup(tokenA, 'Quiet Club');

    const res = await gqlRequest<{ listGroupMembers: { id: string }[] }>(result.httpServer, {
      query: LIST_GROUP_MEMBERS,
      token: tokenA,
      variables: { groupId: id },
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.listGroupMembers).toEqual([]);
  });

  it('should refuse to exclude a member the group does not have', async () => {
    const id = await createGroup(tokenA, 'Music Club');

    const res = await gqlRequest(result.httpServer, {
      query: SET_MEMBER_EXCLUDED,
      token: tokenA,
      variables: { groupId: id, memberId: randomUUID(), excluded: true },
    });

    expect(res.errors?.[0]?.extensions?.code).toBe('GROUP_MEMBER_NOT_FOUND');
  });
});
