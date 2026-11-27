/**
 * Integration tests for getGroup, updateGroup, deleteGroup, listGroupMembers and
 * setGroupMemberExcluded against the real database, including another institute's ids.
 */
import { randomUUID } from 'node:crypto';
import { DomainGroupType, DynamicGroupStatus, GroupMembershipType } from '@roviq/common-types';
import { groupMembers, mkAdminCtx, SYSTEM_USER_ID, withAdmin } from '@roviq/database';
import {
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
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
const LIST_GROUPS = /* GraphQL */ `
  query ListGroups($filter: GroupFilterInput) { listGroups(filter: $filter) { id name } }
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
  let instA: TestInstitute;
  let tokenA: string;
  let tokenB: string;

  /** Groups of institute A, which institute B must not be able to read. */
  const groupsOfA: string[] = [];
  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => groupsOfA,
    callerTokens: () => [tokenB],
    specFile: __filename,
  });

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
    instA = await createTestInstitute(result.db);
    tokenA = tokenFor(instA);
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

  describe('listGroupMembers with a group of another institute (ROV-293)', () => {
    let foreignGroupId: string;
    let foreignMemberId: string;

    beforeAll(async () => {
      foreignGroupId = await createGroup(tokenA, 'Robotics Club');
      groupsOfA.push(foreignGroupId);
      foreignMemberId = await withAdmin(result.db, mkAdminCtx('test:group-crud'), async (tx) => {
        const [row] = await tx
          .insert(groupMembers)
          .values({
            tenantId: instA.tenantId,
            groupId: foreignGroupId,
            membershipId: instA.membershipId,
            source: 'MANUAL',
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })
          .returning({ id: groupMembers.id });
        return row.id;
      });
      const own = await gqlRequest<{ listGroupMembers: { id: string }[] }>(result.httpServer, {
        query: LIST_GROUP_MEMBERS,
        token: tokenA,
        variables: { groupId: foreignGroupId },
      });
      expect(own.data?.listGroupMembers).toEqual([{ id: foreignMemberId }]);
    });

    it('should return no member of the other institute group', async () => {
      const res = await request<{ listGroupMembers: { id: string }[] }>({
        query: LIST_GROUP_MEMBERS,
        token: tokenB,
        variables: { groupId: foreignGroupId },
      });

      expect(res.data?.listGroupMembers ?? []).toEqual([]);
    });

    it('should answer GROUP_NOT_FOUND, as getGroup does', async () => {
      const res = await request<{ listGroupMembers: { id: string }[] }>({
        query: LIST_GROUP_MEMBERS,
        token: tokenB,
        variables: { groupId: foreignGroupId },
      });

      expect(res.errors?.[0]?.extensions?.code).toBe('GROUP_NOT_FOUND');
    });
  });

  describe('members picked when the group is created', () => {
    const CREATE_WITH_MEMBERS = /* GraphQL */ `
      mutation CreateGroup($input: CreateGroupInput!) {
        createGroup(input: $input) { id memberCount }
      }
    `;
    const MEMBERS = /* GraphQL */ `
      query ListGroupMembers($groupId: ID!) {
        listGroupMembers(groupId: $groupId) { membershipId source isExcluded }
      }
    `;
    let teacher: TestTeacher;

    beforeAll(async () => {
      teacher = await createTestTeacher(result.db, instA.tenantId);
    });

    afterAll(async () => {
      await cleanupTestTeacher(result.db, teacher);
    });

    function createWithMembers(
      name: string,
      membershipType: GroupMembershipType,
      memberMembershipIds: string[],
    ) {
      return gqlRequest<{ createGroup: { id: string; memberCount: number } }>(result.httpServer, {
        query: CREATE_WITH_MEMBERS,
        token: tokenA,
        variables: {
          input: {
            name,
            groupType: DomainGroupType.CLUB,
            membershipType,
            memberMembershipIds,
            ...(membershipType === GroupMembershipType.STATIC
              ? {}
              : { rule: { '==': [{ var: 'gender' }, 'female'] } }),
          },
        },
      });
    }

    async function membersOf(groupId: string) {
      const res = await gqlRequest<{
        listGroupMembers: { membershipId: string; source: string; isExcluded: boolean }[];
      }>(result.httpServer, { query: MEMBERS, token: tokenA, variables: { groupId } });
      expect(res.errors).toBeUndefined();
      return [...(res.data?.listGroupMembers ?? [])].sort((x, y) =>
        x.membershipId.localeCompare(y.membershipId),
      );
    }

    it('should store each picked membership as a manual member and count them', async () => {
      const res = await createWithMembers('Library Club', GroupMembershipType.STATIC, [
        instA.membershipId,
        teacher.membershipId,
      ]);

      expect(res.errors).toBeUndefined();
      const id = res.data?.createGroup.id ?? '';
      expect(res.data?.createGroup.memberCount).toBe(2);
      expect(await membersOf(id)).toEqual(
        [instA.membershipId, teacher.membershipId].sort().map((membershipId) => ({
          membershipId,
          source: 'MANUAL',
          isExcluded: false,
        })),
      );
    });

    it('should refuse a membership picked twice and create nothing', async () => {
      const res = await createWithMembers('Garden Club', GroupMembershipType.HYBRID, [
        teacher.membershipId,
        teacher.membershipId,
      ]);

      expect(res.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      const listed = await gqlRequest<{ listGroups: { id: string }[] }>(result.httpServer, {
        query: LIST_GROUPS,
        token: tokenA,
        variables: { filter: { search: 'Garden Club' } },
      });
      expect(listed.data?.listGroups).toEqual([]);
    });

    it('should refuse members for a dynamic group and create nothing', async () => {
      const res = await createWithMembers('Sports Club', GroupMembershipType.DYNAMIC, [
        instA.membershipId,
      ]);

      expect(res.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
      const listed = await gqlRequest<{ listGroups: { id: string }[] }>(result.httpServer, {
        query: LIST_GROUPS,
        token: tokenA,
        variables: { filter: { search: 'Sports Club' } },
      });
      expect(listed.data?.listGroups).toEqual([]);
    });
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
