/**
 * Reseller team E2E (ROV-185) — the happy path on the running stack, as the
 * seeded reseller full admin.
 *
 * Role caps, cross-reseller isolation and tokens issued before a change need
 * several signed-in members, so they live in
 * apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts.
 */
import assert from 'node:assert';
import { ErrorCode } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_CREDENTIALS, SEED_IDS } from '../../shared/seed-fixtures';
import { loginAsInstituteAdmin, loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { gql } from './helpers/gql-client';

interface Member {
  id: string;
  userId: string;
  email: string;
  username: string;
  roleName: { en: string } | null;
  isActive: boolean;
  canManage: boolean;
  lastActiveAt: string | null;
}

const MEMBER = 'id userId email username roleName isActive canManage lastActiveAt';
const LIST = `query List($filter: ResellerTeamFilterInput) {
  resellerListTeamMembers(filter: $filter) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges { cursor node { ${MEMBER} } }
  }
}`;
const INVITE = `mutation Invite($input: ResellerInviteTeamMemberInput!) {
  resellerInviteTeamMember(input: $input) { ${MEMBER} }
}`;

const SUFFIX = Date.now().toString(36);
const EMAIL = `e2e.team.${SUFFIX}@team.test`;

describe('Reseller team E2E', () => {
  let token: string;
  let invited: Member;

  const codeOf = (res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) =>
    res.errors?.[0]?.extensions?.code;

  beforeAll(async () => {
    token = (await loginAsReseller()).accessToken;
  });

  it('lists the seeded admin as active, recently active and not self-manageable', async () => {
    const res = await gql<{ resellerListTeamMembers: { edges: { node: Member }[] } }>(
      LIST,
      { filter: { search: SEED_CREDENTIALS.RESELLER.username } },
      token,
    );
    expect(res.errors).toBeUndefined();
    const self = res.data?.resellerListTeamMembers.edges.find(
      (edge) => edge.node.userId === SEED_IDS.USER_RESELLER,
    )?.node;
    assert(self);
    expect(self).toMatchObject({
      username: SEED_CREDENTIALS.RESELLER.username,
      roleName: { en: 'reseller_full_admin' },
      isActive: true,
      canManage: false,
    });
    expect(self.lastActiveAt).not.toBeNull();
  });

  it('offers a full admin all three roles, most senior first', async () => {
    const res = await gql<{ resellerAssignableTeamRoles: { id: string; name: { en: string } }[] }>(
      'query { resellerAssignableTeamRoles { id name } }',
      undefined,
      token,
    );
    expect(res.data?.resellerAssignableTeamRoles).toEqual([
      { id: SEED_IDS.ROLE_RESELLER_FULL_ADMIN, name: { en: 'reseller_full_admin' } },
      { id: SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN, name: { en: 'reseller_support_admin' } },
      { id: SEED_IDS.ROLE_RESELLER_VIEWER, name: { en: 'reseller_viewer' } },
    ]);
  });

  it('invites by email and refuses the same address twice', async () => {
    const res = await gql<{ resellerInviteTeamMember: Member }>(
      INVITE,
      { input: { email: EMAIL.toUpperCase(), roleId: SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN } },
      token,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    invited = res.data.resellerInviteTeamMember;
    expect(invited).toMatchObject({
      email: EMAIL,
      username: EMAIL,
      roleName: { en: 'reseller_support_admin' },
      isActive: true,
      canManage: true,
      lastActiveAt: null,
    });

    const again = await gql(
      INVITE,
      { input: { email: EMAIL, roleId: SEED_IDS.ROLE_RESELLER_VIEWER } },
      token,
    );
    expect(codeOf(again)).toBe(ErrorCode.TEAM_MEMBER_ALREADY_EXISTS);
  });

  it('changes the role, deactivates and reactivates the member', async () => {
    const changed = await gql<{ resellerChangeTeamMemberRole: Member }>(
      `mutation Change($id: ID!, $roleId: ID!) {
        resellerChangeTeamMemberRole(membershipId: $id, roleId: $roleId) { ${MEMBER} }
      }`,
      { id: invited.id, roleId: SEED_IDS.ROLE_RESELLER_VIEWER },
      token,
    );
    expect(changed.data?.resellerChangeTeamMemberRole.roleName).toEqual({ en: 'reseller_viewer' });

    const deactivated = await gql<{ resellerDeactivateTeamMember: Member }>(
      `mutation Deactivate($id: ID!) {
        resellerDeactivateTeamMember(membershipId: $id) { ${MEMBER} }
      }`,
      { id: invited.id },
      token,
    );
    expect(deactivated.data?.resellerDeactivateTeamMember.isActive).toBe(false);

    const inactive = await gql<{ resellerListTeamMembers: { edges: { node: Member }[] } }>(
      LIST,
      { filter: { isActive: false, search: EMAIL } },
      token,
    );
    expect(inactive.data?.resellerListTeamMembers.edges.map((edge) => edge.node.id)).toEqual([
      invited.id,
    ]);

    const reactivated = await gql<{ resellerReactivateTeamMember: Member }>(
      `mutation Reactivate($id: ID!) {
        resellerReactivateTeamMember(membershipId: $id) { ${MEMBER} }
      }`,
      { id: invited.id },
      token,
    );
    expect(reactivated.data?.resellerReactivateTeamMember.isActive).toBe(true);
  });

  it('returns the member with no sessions before their first sign-in', async () => {
    const res = await gql<{ resellerGetTeamMember: Member & { sessions: { id: string }[] } }>(
      `query Get($id: ID!) { resellerGetTeamMember(membershipId: $id) { ${MEMBER} sessions { id } } }`,
      { id: invited.id },
      token,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.resellerGetTeamMember.sessions).toEqual([]);
  });

  it('pages one member at a time without repeating or skipping', async () => {
    const seen: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await gql<{
        resellerListTeamMembers: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: Member }[];
        };
      }>(LIST, { filter: { first: 1, after } }, token);
      assert(res.data);
      const connection = res.data.resellerListTeamMembers;
      seen.push(...connection.edges.map((edge) => edge.node.id));
      if (!connection.pageInfo.hasNextPage) {
        expect(seen).toHaveLength(connection.totalCount);
        break;
      }
      assert(connection.pageInfo.endCursor);
      after = connection.pageInfo.endCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(invited.id);
  });

  it('refuses the caller changing themselves and an unknown member', async () => {
    const list = await gql<{ resellerListTeamMembers: { edges: { node: Member }[] } }>(
      LIST,
      { filter: { search: SEED_CREDENTIALS.RESELLER.username } },
      token,
    );
    const self = list.data?.resellerListTeamMembers.edges.find(
      (edge) => edge.node.userId === SEED_IDS.USER_RESELLER,
    )?.node;
    assert(self);

    const selfChange = await gql(
      'mutation Deactivate($id: ID!) { resellerDeactivateTeamMember(membershipId: $id) { id } }',
      { id: self.id },
      token,
    );
    expect(codeOf(selfChange)).toBe(ErrorCode.TEAM_MEMBER_SELF_CHANGE);

    const unknown = await gql(
      'query Get($id: ID!) { resellerGetTeamMember(membershipId: $id) { id } }',
      { id: '00000000-0000-7000-a000-00000000dead' },
      token,
    );
    expect(codeOf(unknown)).toBe(ErrorCode.TEAM_MEMBER_NOT_FOUND);
  });

  it('refuses callers outside the reseller scope', async () => {
    const [platform, institute] = await Promise.all([
      loginAsPlatformAdmin(),
      loginAsInstituteAdmin(),
    ]);
    expect(codeOf(await gql(LIST))).toBe(ErrorCode.UNAUTHENTICATED);
    expect(codeOf(await gql(LIST, undefined, platform.accessToken))).toBe(ErrorCode.FORBIDDEN);
    expect(codeOf(await gql(LIST, undefined, institute.accessToken))).toBe(ErrorCode.FORBIDDEN);
  });

  it('records the invitation in the reseller audit log as a CREATE on TeamMember', async () => {
    const deadline = Date.now() + 10_000;
    let entry: { action: string; actionType: string; entityType: string } | undefined;
    while (!entry && Date.now() < deadline) {
      const res = await gql<{
        resellerAuditLogs: {
          edges: {
            node: { action: string; actionType: string; entityType: string; entityId: string };
          }[];
        };
      }>(
        `query Audit($userId: String!) {
          resellerAuditLogs(filter: { userId: $userId }, first: 50) {
            edges { node { action actionType entityType entityId } }
          }
        }`,
        { userId: SEED_IDS.USER_RESELLER },
        token,
      );
      entry = res.data?.resellerAuditLogs.edges.find(
        (edge) =>
          edge.node.action === 'resellerInviteTeamMember' && edge.node.entityId === invited.id,
      )?.node;
      if (!entry) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(entry).toMatchObject({ actionType: 'CREATE', entityType: 'TeamMember' });
  });
});
