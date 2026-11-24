/**
 * ROV-293: every group operation that takes an id refuses a group or group member of another
 * institute, returns none of its data, and stores no row that points at it.
 */
import { randomUUID } from 'node:crypto';
import { DomainGroupType, ErrorCode, GroupMembershipType } from '@roviq/common-types';
import {
  type DrizzleDB,
  groupChildren,
  groupMembers,
  groupRules,
  groups,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:group-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const GET = /* GraphQL */ `
  query GetGroup($id: ID!) {
    getGroup(id: $id) {
      id
      name
    }
  }
`;
const CREATE = /* GraphQL */ `
  mutation CreateGroup($input: CreateGroupInput!) {
    createGroup(input: $input) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation UpdateGroup($id: ID!, $rule: JSON) {
    updateGroup(id: $id, input: { name: "Renamed", rule: $rule }) {
      id
    }
  }
`;
/** A rule change also replaces the group's rule row and announces it. */
const RULE = { '==': [{ var: 'academic_status' }, 'ENROLLED'] };
const DELETE = /* GraphQL */ `
  mutation DeleteGroup($id: ID!) {
    deleteGroup(id: $id)
  }
`;
const RESOLVE = /* GraphQL */ `
  mutation ResolveGroupMembers($id: ID!) {
    resolveGroupMembers(groupId: $id) {
      groupId
    }
  }
`;
const SET_EXCLUDED = /* GraphQL */ `
  mutation SetGroupMemberExcluded($groupId: ID!, $memberId: ID!) {
    setGroupMemberExcluded(groupId: $groupId, memberId: $memberId, excluded: true) {
      id
      isExcluded
    }
  }
`;

interface Fixture {
  /** A static club with no members. */
  groupId: string;
  /** A hybrid group holding one manual member. */
  hybridGroupId: string;
  memberId: string;
}

describe('group: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Group rows of both institutes, and every row in any institute that points at B's groups. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignGroups = [b.groupId, b.hybridGroupId];
      return {
        groups: await tx
          .select()
          .from(groups)
          .where(
            or(inArray(groups.tenantId, tenants), inArray(groups.parentGroupId, foreignGroups)),
          )
          .orderBy(groups.id),
        rules: await tx
          .select()
          .from(groupRules)
          .where(
            or(inArray(groupRules.tenantId, tenants), inArray(groupRules.groupId, foreignGroups)),
          )
          .orderBy(groupRules.id),
        children: await tx
          .select()
          .from(groupChildren)
          .where(
            or(
              inArray(groupChildren.tenantId, tenants),
              inArray(groupChildren.parentGroupId, foreignGroups),
              inArray(groupChildren.childGroupId, foreignGroups),
            ),
          )
          .orderBy(groupChildren.id),
        members: await tx
          .select()
          .from(groupMembers)
          .where(
            or(
              inArray(groupMembers.tenantId, tenants),
              inArray(groupMembers.groupId, foreignGroups),
            ),
          )
          .orderBy(groupMembers.id),
      };
    });

  const setUp = (inst: TestInstitute) =>
    asAdmin(async (tx): Promise<Fixture> => {
      const [club, hybrid] = await tx
        .insert(groups)
        .values([
          {
            tenantId: inst.tenantId,
            name: 'Chess Club',
            groupType: DomainGroupType.CLUB,
            membershipType: GroupMembershipType.STATIC,
            ...BY,
          },
          {
            tenantId: inst.tenantId,
            name: 'Science Club',
            groupType: DomainGroupType.CLUB,
            membershipType: GroupMembershipType.HYBRID,
            ...BY,
          },
        ])
        .returning({ id: groups.id });
      const [member] = await tx
        .insert(groupMembers)
        .values({
          tenantId: inst.tenantId,
          groupId: hybrid.id,
          membershipId: inst.membershipId,
          source: 'MANUAL',
          ...BY,
        })
        .returning({ id: groupMembers.id });
      return { groupId: club.id, hybridGroupId: hybrid.id, memberId: member.id };
    });

  const refusesAndWritesNothing = async (
    query: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');

    const res = await gqlRequest(result.httpServer, { query, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  };

  const createInput = (ids: { parentGroupId?: string; childGroupIds?: string[] }) => ({
    input: {
      // Names are unique per institute.
      name: `Debate Club ${randomUUID().slice(0, 8)}`,
      groupType: DomainGroupType.COMPOSITE,
      membershipType: GroupMembershipType.STATIC,
      ...ids,
    },
  });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    a = await setUp(instA);
    b = await setUp(instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('getGroup should refuse a group of another institute and return none of it', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: GET,
      variables: { id: b.groupId },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.GROUP_NOT_FOUND);
    expect(res.data).toBeNull();
  });

  it.each([
    ['updateGroup', UPDATE, { rule: RULE }],
    ['deleteGroup', DELETE, {}],
    ['resolveGroupMembers', RESOLVE, {}],
  ] as const)('%s should refuse a group of another institute and change neither institute', async (_operation, query, extra) => {
    await refusesAndWritesNothing(query, { id: b.groupId, ...extra }, ErrorCode.GROUP_NOT_FOUND);
  });

  it('createGroup should store its own parent and child groups', async () => {
    const res = await gqlRequest<{ createGroup: { id: string } }>(result.httpServer, {
      query: CREATE,
      variables: createInput({ parentGroupId: a.hybridGroupId, childGroupIds: [a.groupId] }),
      token: tokenA,
    });

    expect(res.errors).toBeUndefined();
    const id = res.data?.createGroup.id ?? '';
    const stored = await asAdmin(async (tx) => ({
      group: await tx
        .select({ tenantId: groups.tenantId, parentGroupId: groups.parentGroupId })
        .from(groups)
        .where(eq(groups.id, id)),
      children: await tx
        .select({ tenantId: groupChildren.tenantId, childGroupId: groupChildren.childGroupId })
        .from(groupChildren)
        .where(eq(groupChildren.parentGroupId, id)),
    }));
    expect(stored).toEqual({
      group: [{ tenantId: instA.tenantId, parentGroupId: a.hybridGroupId }],
      children: [{ tenantId: instA.tenantId, childGroupId: a.groupId }],
    });
  });

  it.each([
    ['input.parentGroupId', () => createInput({ parentGroupId: b.groupId })],
    ['input.childGroupIds', () => createInput({ childGroupIds: [a.groupId, b.groupId] })],
  ] as const)('createGroup should refuse %s of another institute and write nothing', async (_field, variables) => {
    await refusesAndWritesNothing(CREATE, variables(), ErrorCode.GROUP_NOT_FOUND);
  });

  describe('setGroupMemberExcluded', () => {
    it('should refuse groupId of another institute and change no member', async () => {
      await refusesAndWritesNothing(
        SET_EXCLUDED,
        { groupId: b.hybridGroupId, memberId: a.memberId },
        ErrorCode.GROUP_MEMBER_NOT_FOUND,
      );
    });

    it('should refuse memberId of another institute and change no member', async () => {
      await refusesAndWritesNothing(
        SET_EXCLUDED,
        { groupId: a.hybridGroupId, memberId: b.memberId },
        ErrorCode.GROUP_MEMBER_NOT_FOUND,
      );
    });

    it("should refuse the other institute's own member and leave it unchanged", async () => {
      await refusesAndWritesNothing(
        SET_EXCLUDED,
        { groupId: b.hybridGroupId, memberId: b.memberId },
        ErrorCode.GROUP_MEMBER_NOT_FOUND,
      );
    });

    it('should exclude a member of its own group', async () => {
      const res = await gqlRequest<{ setGroupMemberExcluded: { id: string; isExcluded: boolean } }>(
        result.httpServer,
        {
          query: SET_EXCLUDED,
          variables: { groupId: a.hybridGroupId, memberId: a.memberId },
          token: tokenA,
        },
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.setGroupMemberExcluded).toEqual({ id: a.memberId, isExcluded: true });
      const stored = await asAdmin((tx) =>
        tx
          .select({ isExcluded: groupMembers.isExcluded })
          .from(groupMembers)
          .where(and(eq(groupMembers.id, a.memberId), eq(groupMembers.groupId, a.hybridGroupId))),
      );
      expect(stored).toEqual([{ isExcluded: true }]);
    });
  });
});
