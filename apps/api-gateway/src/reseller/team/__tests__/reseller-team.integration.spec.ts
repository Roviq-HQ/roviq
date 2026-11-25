/**
 * Reseller team management (ROV-185) — full resolver pipeline against real
 * PostgreSQL, with a Redis that stores what the guards write.
 *
 * Covers what a unit test cannot: real role abilities through CASL, RLS between
 * two resellers, the session trigger, and tokens issued before a change.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { ErrorCode, type ResellerSystemRoleName } from '@roviq/common-types';
import {
  auditLogs,
  memberships,
  mkAdminCtx,
  provisionResellerSystemRoles,
  refreshTokens,
  resellerMemberships,
  users,
  withAdmin,
} from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createInMemoryRedis,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const PASSWORD = 'Team-Test-9!';
const TAG = `team-${randomUUID().slice(0, 8)}`;
const email = (name: string) => `${name}.${TAG}@team.test`;

const LOGIN = `
  mutation($username: String!, $password: String!) {
    resellerLogin(username: $username, password: $password) { accessToken refreshToken }
  }
`;
const REFRESH = `mutation($token: String!) { refreshToken(token: $token) { accessToken } }`;
const MEMBER = 'id userId email username roleId roleName isActive canManage';
const LIST = `query($filter: ResellerTeamFilterInput) {
  resellerListTeamMembers(filter: $filter) { totalCount edges { node { ${MEMBER} } } }
}`;
const GET = `query($id: ID!) { resellerGetTeamMember(membershipId: $id) { ${MEMBER} sessions { id } } }`;
const ROLES = `query { resellerAssignableTeamRoles { id name } }`;
const STATISTICS = `query { resellerInstituteStatistics { __typename } }`;
const INVITE = `mutation($input: ResellerInviteTeamMemberInput!) {
  resellerInviteTeamMember(input: $input) { ${MEMBER} }
}`;
const CHANGE_ROLE = `mutation($id: ID!, $roleId: ID!) {
  resellerChangeTeamMemberRole(membershipId: $id, roleId: $roleId) { ${MEMBER} }
}`;
const DEACTIVATE = `mutation($id: ID!) { resellerDeactivateTeamMember(membershipId: $id) { ${MEMBER} } }`;
const REACTIVATE = `mutation($id: ID!) { resellerReactivateTeamMember(membershipId: $id) { ${MEMBER} } }`;
const CHANGE_TIER = `mutation($id: ID!, $tier: ResellerTier!) {
  adminChangeResellerTier(id: $id, newTier: $tier) { id tier }
}`;

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface Member {
  id: string;
  userId: string;
  email: string;
  username: string;
  roleId: string;
  roleName: { en: ResellerSystemRoleName };
  isActive: boolean;
  canManage: boolean;
}

interface Team {
  reseller: TestReseller;
  roleIds: Record<ResellerSystemRoleName, string>;
  adminTokens: Tokens;
}

describe('Reseller team management (integration)', () => {
  let result: IntegrationAppResult;
  const createdResellers: TestReseller[] = [];
  const createdInstitutes: TestInstitute[] = [];

  const platformAdminToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  const gql = (query: string, variables?: Record<string, unknown>, token?: string) =>
    gqlRequest(result.httpServer, { query, variables, token });

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:reseller-team'), fn);

  const codeOf = (response: Awaited<ReturnType<typeof gql>>) =>
    response.errors?.[0]?.extensions?.code;

  async function login(username: string): Promise<Tokens> {
    const response = await gql(LOGIN, { username, password: PASSWORD });
    expect(response.errors).toBeUndefined();
    const tokens = response.data?.resellerLogin;
    assert(tokens);
    return tokens as Tokens;
  }

  /** A reseller with its three system roles, whose first admin holds the full-admin copy. */
  async function setUpTeam(): Promise<Team> {
    const reseller = await createTestReseller(result.db);
    createdResellers.push(reseller);
    const passwordHash = await hash(PASSWORD);
    const roleIds = await admin(async (tx) => {
      const ids = await provisionResellerSystemRoles(tx, reseller.resellerId, reseller.userId);
      await tx.update(users).set({ passwordHash }).where(eq(users.id, reseller.userId));
      await tx
        .update(resellerMemberships)
        .set({ roleId: ids.reseller_full_admin, abilities: [] })
        .where(eq(resellerMemberships.id, reseller.membershipId));
      return ids;
    });
    return { reseller, roleIds, adminTokens: await login(reseller.username) };
  }

  /** Invites through the API, then gives the new account a known password so it can sign in. */
  async function invite(team: Team, name: string, role: ResellerSystemRoleName): Promise<Member> {
    const response = await gql(
      INVITE,
      { input: { email: email(name), roleId: team.roleIds[role] } },
      team.adminTokens.accessToken,
    );
    expect(response.errors).toBeUndefined();
    const member = response.data?.resellerInviteTeamMember as Member;
    const passwordHash = await hash(PASSWORD);
    await admin((tx) =>
      tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false })
        .where(eq(users.id, member.userId)),
    );
    return member;
  }

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      // The access guard reads back the markers that team changes write.
      overrides: [{ provide: REDIS_CLIENT, useValue: createInMemoryRedis() }],
    });
  });

  afterAll(async () => {
    await admin(async (tx) => {
      const invited = await tx
        .select({ id: users.id })
        .from(users) // allow-base-read: test cleanup
        .where(like(users.email, `%.${TAG}@team.test`));
      const userIds = [
        ...invited.map((row) => row.id),
        ...createdResellers.map((r) => r.userId),
        ...createdInstitutes.map((i) => i.userId),
      ];
      if (userIds.length === 0) return;
      // An institute user linked to a team would block the institute cleanup below.
      await tx.delete(resellerMemberships).where(
        inArray(
          resellerMemberships.resellerId,
          createdResellers.map((r) => r.resellerId),
        ),
      );
      await tx.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
      await tx.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
    });
    for (const institute of createdInstitutes) await cleanupTestInstitute(result.db, institute);
    for (const reseller of createdResellers) await cleanupTestReseller(result.db, reseller);
    await admin((tx) => tx.delete(users).where(like(users.email, `%.${TAG}@team.test`)));
    await result?.close();
  });

  describe('inviting', () => {
    let team: Team;

    beforeAll(async () => {
      team = await setUpTeam();
    });

    it('creates an account whose Roviq ID is the lower-cased email, and the person can sign in', async () => {
      const response = await gql(
        INVITE,
        {
          input: {
            email: `  New.Person.${TAG}@Team.test `.trim(),
            roleId: team.roleIds.reseller_viewer,
          },
        },
        team.adminTokens.accessToken,
      );
      expect(response.errors).toBeUndefined();
      const member = response.data?.resellerInviteTeamMember as Member;
      expect(member).toMatchObject({
        email: `new.person.${TAG}@team.test`,
        username: `new.person.${TAG}@team.test`,
        roleName: { en: 'reseller_viewer' },
        isActive: true,
        canManage: true,
      });

      const [stored] = await admin((tx) =>
        tx
          .select({ mustChangePassword: users.mustChangePassword })
          .from(users) // allow-base-read: asserting the stored row
          .where(eq(users.id, member.userId)),
      );
      expect(stored.mustChangePassword).toBe(true);
    });

    it('refuses the same person twice, whatever the case of the email', async () => {
      const response = await gql(
        INVITE,
        {
          input: {
            email: `NEW.PERSON.${TAG}@TEAM.TEST`,
            roleId: team.roleIds.reseller_support_admin,
          },
        },
        team.adminTokens.accessToken,
      );
      expect(codeOf(response)).toBe(ErrorCode.TEAM_MEMBER_ALREADY_EXISTS);
    });

    it('links an existing account by email instead of creating a second one', async () => {
      const institute = await createTestInstitute(result.db, {
        resellerId: team.reseller.resellerId,
      });
      createdInstitutes.push(institute);
      const [existing] = await admin((tx) =>
        tx
          .select({ email: users.email })
          .from(users) // allow-base-read: test fixture lookup
          .where(eq(users.id, institute.userId)),
      );

      const invite = () =>
        gql(
          INVITE,
          { input: { email: existing.email.toUpperCase(), roleId: team.roleIds.reseller_viewer } },
          team.adminTokens.accessToken,
        );

      // SF-045: someone else created the account and its owner has not proved the mailbox.
      const unverified = await invite();
      expect(codeOf(unverified)).toBe(ErrorCode.TEAM_MEMBER_EMAIL_UNAVAILABLE);

      await admin((tx) =>
        tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, institute.userId)),
      );
      const response = await invite();
      expect(response.errors).toBeUndefined();
      expect((response.data?.resellerInviteTeamMember as Member).userId).toBe(institute.userId);
    });

    it('does not link an account whose Roviq ID merely equals the address', async () => {
      const address = email('lookalike');
      const passwordHash = await hash(PASSWORD);
      await admin((tx) =>
        tx.insert(users).values({
          email: email('someone-else'),
          username: address,
          passwordHash,
          createdBy: team.reseller.userId,
          updatedBy: team.reseller.userId,
        }),
      );

      const response = await gql(
        INVITE,
        { input: { email: address, roleId: team.roleIds.reseller_viewer } },
        team.adminTokens.accessToken,
      );
      expect(codeOf(response)).toBe(ErrorCode.TEAM_MEMBER_EMAIL_UNAVAILABLE);
    });

    it('rejects a malformed email and a role of another reseller', async () => {
      const other = await setUpTeam();
      const malformed = await gql(
        INVITE,
        { input: { email: 'not-an-email', roleId: team.roleIds.reseller_viewer } },
        team.adminTokens.accessToken,
      );
      expect(codeOf(malformed)).toBe(ErrorCode.VALIDATION_FAILED);

      const foreignRole = await gql(
        INVITE,
        { input: { email: email('foreign-role'), roleId: other.roleIds.reseller_viewer } },
        team.adminTokens.accessToken,
      );
      expect(codeOf(foreignRole)).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('who may change whom', () => {
    let team: Team;
    let support: Member;
    let viewer: Member;
    let supportTokens: Tokens;
    let viewerTokens: Tokens;

    beforeAll(async () => {
      team = await setUpTeam();
      support = await invite(team, 'support', 'reseller_support_admin');
      viewer = await invite(team, 'viewer', 'reseller_viewer');
      supportTokens = await login(support.username);
      viewerTokens = await login(viewer.username);
    });

    it('shows a support admin only the roles up to their own, and who they can change', async () => {
      const roles = await gql(ROLES, undefined, supportTokens.accessToken);
      expect(roles.data?.resellerAssignableTeamRoles).toEqual([
        { id: team.roleIds.reseller_support_admin, name: { en: 'reseller_support_admin' } },
        { id: team.roleIds.reseller_viewer, name: { en: 'reseller_viewer' } },
      ]);

      const list = await gql(LIST, undefined, supportTokens.accessToken);
      const edges = list.data?.resellerListTeamMembers.edges as { node: Member }[];
      expect(edges.map((edge) => [edge.node.username, edge.node.canManage])).toEqual([
        [team.reseller.username, false],
        [support.username, false],
        [viewer.username, true],
      ]);
    });

    it('refuses a support admin acting on the full admin, seeing their sessions, or handing out the full-admin role', async () => {
      const token = supportTokens.accessToken;
      const senior = await gql(GET, { id: team.reseller.membershipId }, token);
      expect(senior.data?.resellerGetTeamMember.sessions).toBeNull();
      const junior = await gql(GET, { id: viewer.id }, token);
      expect(junior.data?.resellerGetTeamMember.sessions).toHaveLength(1);

      const deactivate = await gql(DEACTIVATE, { id: team.reseller.membershipId }, token);
      expect(codeOf(deactivate)).toBe(ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE);

      const promote = await gql(
        CHANGE_ROLE,
        { id: viewer.id, roleId: team.roleIds.reseller_full_admin },
        token,
      );
      expect(codeOf(promote)).toBe(ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE);

      const inviteAdmin = await gql(
        INVITE,
        { input: { email: email('escalate'), roleId: team.roleIds.reseller_full_admin } },
        token,
      );
      expect(codeOf(inviteAdmin)).toBe(ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE);
    });

    it('refuses anyone changing themselves', async () => {
      const selfRole = await gql(
        CHANGE_ROLE,
        { id: team.reseller.membershipId, roleId: team.roleIds.reseller_viewer },
        team.adminTokens.accessToken,
      );
      expect(codeOf(selfRole)).toBe(ErrorCode.TEAM_MEMBER_SELF_CHANGE);

      const selfDeactivate = await gql(DEACTIVATE, { id: support.id }, supportTokens.accessToken);
      expect(codeOf(selfDeactivate)).toBe(ErrorCode.TEAM_MEMBER_SELF_CHANGE);
    });

    // ROV-284: a viewer has no team access at all, reading included.
    it('refuses a viewer every team operation at the ability check', async () => {
      const token = viewerTokens.accessToken;
      const attempts = [
        await gql(LIST, undefined, token),
        await gql(ROLES, undefined, token),
        await gql(GET, { id: support.id }, token),
        await gql(
          INVITE,
          { input: { email: email('v'), roleId: team.roleIds.reseller_viewer } },
          token,
        ),
        await gql(CHANGE_ROLE, { id: support.id, roleId: team.roleIds.reseller_viewer }, token),
        await gql(DEACTIVATE, { id: support.id }, token),
        await gql(REACTIVATE, { id: support.id }, token),
      ];
      expect(attempts.map(codeOf)).toEqual(Array(7).fill(ErrorCode.FORBIDDEN));
    });

    it('refuses a platform token and an anonymous caller', async () => {
      expect(codeOf(await gql(LIST, undefined, platformAdminToken))).toBe(ErrorCode.FORBIDDEN);
      expect(codeOf(await gql(LIST))).toBe(ErrorCode.UNAUTHENTICATED);
    });

    it('hides and protects the team of another reseller', async () => {
      const outsider = await setUpTeam();
      const token = outsider.adminTokens.accessToken;

      const list = await gql(LIST, undefined, token);
      expect(list.data?.resellerListTeamMembers.totalCount).toBe(1);

      const attempts = [
        await gql(GET, { id: viewer.id }, token),
        await gql(CHANGE_ROLE, { id: viewer.id, roleId: outsider.roleIds.reseller_viewer }, token),
        await gql(DEACTIVATE, { id: viewer.id }, token),
        await gql(REACTIVATE, { id: viewer.id }, token),
      ];
      expect(attempts.map(codeOf)).toEqual([
        ErrorCode.TEAM_MEMBER_NOT_FOUND,
        ErrorCode.TEAM_MEMBER_NOT_FOUND,
        ErrorCode.TEAM_MEMBER_NOT_FOUND,
        ErrorCode.TEAM_MEMBER_NOT_FOUND,
      ]);

      const [untouched] = await admin((tx) =>
        tx
          .select({ isActive: resellerMemberships.isActive, roleId: resellerMemberships.roleId })
          .from(resellerMemberships) // allow-base-read: asserting the stored row
          .where(eq(resellerMemberships.id, viewer.id)),
      );
      expect(untouched).toEqual({ isActive: true, roleId: team.roleIds.reseller_viewer });
    });

    it('filters the list by status and by search', async () => {
      const token = team.adminTokens.accessToken;
      const inactive = await gql(LIST, { filter: { isActive: false } }, token);
      expect(inactive.data?.resellerListTeamMembers.totalCount).toBe(0);

      const search = await gql(LIST, { filter: { search: `viewer.${TAG}` } }, token);
      const found = search.data?.resellerListTeamMembers.edges as { node: Member }[];
      expect(found.map((edge) => edge.node.id)).toEqual([viewer.id]);

      const paged = await gql(LIST, { filter: { first: 2 } }, token);
      expect(paged.data?.resellerListTeamMembers.edges).toHaveLength(2);
      expect(codeOf(await gql(LIST, { filter: { after: 'garbage' } }, token))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
    });
  });

  describe('tokens issued before a change', () => {
    let team: Team;
    let member: Member;
    let memberTokens: Tokens;

    beforeAll(async () => {
      team = await setUpTeam();
      member = await invite(team, 'changing', 'reseller_support_admin');
      memberTokens = await login(member.username);
    });

    it('a role change refuses the old access token at once; the refreshed one carries the new role', async () => {
      const before = await gql(ROLES, undefined, memberTokens.accessToken);
      expect(before.data?.resellerAssignableTeamRoles).toHaveLength(2);

      const change = await gql(
        CHANGE_ROLE,
        { id: member.id, roleId: team.roleIds.reseller_viewer },
        team.adminTokens.accessToken,
      );
      expect(change.data?.resellerChangeTeamMemberRole.roleName).toEqual({ en: 'reseller_viewer' });

      expect(codeOf(await gql(ROLES, undefined, memberTokens.accessToken))).toBe(
        ErrorCode.UNAUTHENTICATED,
      );

      const refreshed = await gql(REFRESH, { token: memberTokens.refreshToken });
      expect(refreshed.errors).toBeUndefined();
      const accessToken = refreshed.data?.refreshToken.accessToken as string;
      // The viewer role has no team access, so the new token is refused where the old one passed.
      expect(codeOf(await gql(ROLES, undefined, accessToken))).toBe(ErrorCode.FORBIDDEN);
      const forbidden = await gql(DEACTIVATE, { id: team.reseller.membershipId }, accessToken);
      expect(codeOf(forbidden)).toBe(ErrorCode.FORBIDDEN);
    });

    it('a deactivation ends the sessions: no access, no refresh, no sign-in, until reactivated', async () => {
      const tokens = await login(member.username);
      const sessions = await gql(GET, { id: member.id }, team.adminTokens.accessToken);
      expect(sessions.data?.resellerGetTeamMember.sessions.length).toBeGreaterThan(0);

      const deactivated = await gql(DEACTIVATE, { id: member.id }, team.adminTokens.accessToken);
      expect(deactivated.data?.resellerDeactivateTeamMember.isActive).toBe(false);

      expect(codeOf(await gql(LIST, undefined, tokens.accessToken))).toBe(
        ErrorCode.UNAUTHENTICATED,
      );
      expect((await gql(REFRESH, { token: tokens.refreshToken })).errors).toBeDefined();
      const signIn = await gql(LOGIN, { username: member.username, password: PASSWORD });
      expect(signIn.errors).toBeDefined();

      const live = await admin((tx) =>
        tx
          .select({ revokedReason: refreshTokens.revokedReason })
          .from(refreshTokens) // allow-base-read: asserting the stored rows
          .where(eq(refreshTokens.membershipId, member.id)),
      );
      expect(live.length).toBeGreaterThan(0);
      expect(live.every((row) => row.revokedReason !== null)).toBe(true);

      const again = await gql(DEACTIVATE, { id: member.id }, team.adminTokens.accessToken);
      expect(codeOf(again)).toBe(ErrorCode.TEAM_MEMBER_STATUS_UNCHANGED);

      const reactivated = await gql(REACTIVATE, { id: member.id }, team.adminTokens.accessToken);
      expect(reactivated.data?.resellerReactivateTeamMember.isActive).toBe(true);
      // The member is a viewer since the previous test: read what a viewer may read.
      const back = await login(member.username);
      const stats = await gql(STATISTICS, undefined, back.accessToken);
      expect(stats.errors).toBeUndefined();
    });
  });

  describe('ids of another reseller or of the platform (ROV-293)', () => {
    let team: Team;
    let outsider: Team;
    let ownViewer: Member;
    let outsiderViewer: Member;
    let platformOwned: TestInstitute;

    /** Team rows of both resellers and the platform-owned institute's membership. */
    const stored = () =>
      admin(async (tx) => ({
        team: await tx
          .select()
          .from(resellerMemberships) // allow-base-read: asserting the stored rows
          .where(
            inArray(resellerMemberships.resellerId, [
              team.reseller.resellerId,
              outsider.reseller.resellerId,
            ]),
          ),
        institute: await tx
          .select()
          .from(memberships) // allow-base-read: asserting the stored row
          .where(eq(memberships.id, platformOwned.membershipId)),
      }));

    beforeAll(async () => {
      team = await setUpTeam();
      outsider = await setUpTeam();
      ownViewer = await invite(team, 'fid-own-viewer', 'reseller_viewer');
      outsiderViewer = await invite(outsider, 'fid-outsider-viewer', 'reseller_viewer');
      platformOwned = await createTestInstitute(result.db);
      createdInstitutes.push(platformOwned);
    });

    const foreignMembers = [
      ['a member of another reseller', () => outsiderViewer.id],
      ['a membership of a platform-owned institute', () => platformOwned.membershipId],
    ] as const;

    it.each(
      foreignMembers,
    )('resellerGetTeamMember should refuse %s and return none of it', async (_label, pick) => {
      const response = await gql(GET, { id: pick() }, team.adminTokens.accessToken);

      expect(codeOf(response)).toBe(ErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(response.data).toBeNull();
    });

    it.each(
      foreignMembers,
    )('resellerChangeTeamMemberRole should refuse %s and change nothing', async (_label, pick) => {
      const before = await stored();

      const response = await gql(
        CHANGE_ROLE,
        { id: pick(), roleId: team.roleIds.reseller_support_admin },
        team.adminTokens.accessToken,
      );

      expect(codeOf(response)).toBe(ErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(response.data).toBeNull();
      expect(await stored()).toEqual(before);
    });

    const foreignRoles = [
      ['a role of another reseller', () => outsider.roleIds.reseller_viewer],
      ['a role of a platform-owned institute', () => platformOwned.roleId],
    ] as const;

    it.each(
      foreignRoles,
    )('resellerChangeTeamMemberRole should refuse %s for its own member and change nothing', async (_label, pick) => {
      const before = await stored();

      const response = await gql(
        CHANGE_ROLE,
        { id: ownViewer.id, roleId: pick() },
        team.adminTokens.accessToken,
      );

      expect(codeOf(response)).toBe(ErrorCode.FORBIDDEN);
      expect(response.data).toBeNull();
      expect(await stored()).toEqual(before);
    });

    it.each(
      foreignRoles,
    )('resellerInviteTeamMember should refuse %s and create no account or membership', async (_label, pick) => {
      const address = email(`fid-invite-${randomUUID().slice(0, 6)}`);
      const before = await stored();

      const response = await gql(
        INVITE,
        { input: { email: address, roleId: pick() } },
        team.adminTokens.accessToken,
      );

      expect(codeOf(response)).toBe(ErrorCode.FORBIDDEN);
      expect(response.data).toBeNull();
      expect(await stored()).toEqual(before);
      const accounts = await admin((tx) =>
        tx
          .select({ id: users.id })
          .from(users) // allow-base-read: asserting no account was created
          .where(eq(users.email, address)),
      );
      expect(accounts).toEqual([]);
    });

    it.each(
      foreignMembers,
    )('resellerDeactivateTeamMember should refuse %s and change nothing', async (_label, pick) => {
      const before = await stored();

      const response = await gql(DEACTIVATE, { id: pick() }, team.adminTokens.accessToken);

      expect(codeOf(response)).toBe(ErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(response.data).toBeNull();
      expect(await stored()).toEqual(before);
    });

    it.each(
      foreignMembers,
    )('resellerReactivateTeamMember should refuse %s while it is inactive and change nothing', async (_label, pick) => {
      await admin(async (tx) => {
        await tx
          .update(resellerMemberships)
          .set({ isActive: false })
          .where(eq(resellerMemberships.id, outsiderViewer.id));
        await tx
          .update(memberships)
          .set({ status: 'SUSPENDED' })
          .where(eq(memberships.id, platformOwned.membershipId));
      });
      const before = await stored();

      const response = await gql(REACTIVATE, { id: pick() }, team.adminTokens.accessToken);

      expect(codeOf(response)).toBe(ErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(response.data).toBeNull();
      expect(await stored()).toEqual(before);
    });
  });

  describe('tier of the reseller', () => {
    it('a downgrade brings the full admin down, keeps the viewer, and caps what can be assigned', async () => {
      const team = await setUpTeam();
      const viewer = await invite(team, 'tier-viewer', 'reseller_viewer');
      const support = await invite(team, 'tier-support', 'reseller_support_admin');

      const changed = await gql(
        CHANGE_TIER,
        { id: team.reseller.resellerId, tier: 'SUPPORT_MANAGEMENT' },
        platformAdminToken,
      );
      expect(changed.errors).toBeUndefined();

      // The admin's role moved, so the token from before the change is stale.
      expect(codeOf(await gql(LIST, undefined, team.adminTokens.accessToken))).toBe(
        ErrorCode.UNAUTHENTICATED,
      );
      const refreshed = await gql(REFRESH, { token: team.adminTokens.refreshToken });
      const token = refreshed.data?.refreshToken.accessToken as string;

      const list = await gql(LIST, undefined, token);
      const edges = list.data?.resellerListTeamMembers.edges as { node: Member }[];
      expect(edges.map((edge) => [edge.node.id, edge.node.roleName.en])).toEqual([
        [team.reseller.membershipId, 'reseller_support_admin'],
        [viewer.id, 'reseller_viewer'],
        [support.id, 'reseller_support_admin'],
      ]);

      const promote = await gql(
        CHANGE_ROLE,
        { id: viewer.id, roleId: team.roleIds.reseller_full_admin },
        token,
      );
      expect(codeOf(promote)).toBe(ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE);
    });
  });
});
