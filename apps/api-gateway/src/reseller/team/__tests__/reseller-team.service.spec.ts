import { ErrorCode, type ResellerTier } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectBusinessError } from '../../../__tests__/expect-business-error';
import { IdentityService } from '../../../auth/identity.service';
import {
  ResellerTeamRepository,
  type TeamMemberRecord,
} from '../repositories/reseller-team.repository';
import { ResellerTeamService } from '../reseller-team.service';

const RESELLER_ID = '11111111-1111-4111-a111-111111111111';
const FULL = '00000000-0000-4000-a000-000000000001';
const SUPPORT = '00000000-0000-4000-a000-000000000002';
const VIEWER = '00000000-0000-4000-a000-000000000003';
const FOREIGN_ROLE = '00000000-0000-4000-a000-0000000000ff';

const ROLES = [
  { id: FULL, name: { en: 'reseller_full_admin' } },
  { id: SUPPORT, name: { en: 'reseller_support_admin' } },
  { id: VIEWER, name: { en: 'reseller_viewer' } },
];

const JOINED = new Date('2026-01-10T00:00:00.000Z');

function member(n: number, roleId: string, overrides: Partial<TeamMemberRecord> = {}) {
  return {
    id: `aaaaaaaa-aaaa-4aaa-aaaa-00000000000${n}`,
    userId: `bbbbbbbb-bbbb-4bbb-bbbb-00000000000${n}`,
    email: `member${n}@team.test`,
    username: `member${n}`,
    roleId,
    isActive: true,
    joinedAt: JOINED,
    profile: null,
    ...overrides,
  } satisfies TeamMemberRecord;
}

const admin = member(1, FULL);
const support = member(2, SUPPORT);
const viewer = member(3, VIEWER);
const otherAdmin = member(4, FULL);

describe('ResellerTeamService', () => {
  let repo: ResellerTeamRepository;
  let identity: IdentityService;
  let redis: Redis;
  let service: ResellerTeamService;
  let members: TeamMemberRecord[];
  let tier: ResellerTier;

  const actor = (who: TeamMemberRecord) => ({ resellerId: RESELLER_ID, userId: who.userId });

  beforeEach(() => {
    members = [admin, support, viewer, otherAdmin];
    tier = 'FULL_MANAGEMENT';
    repo = createMock<ResellerTeamRepository>({
      listRoles: vi.fn().mockResolvedValue(ROLES),
      findTier: vi.fn(async () => tier),
      findMember: vi.fn(async (_r: string, id: string) => members.find((m) => m.id === id) ?? null),
      findMemberByUser: vi.fn(
        async (_r: string, userId: string) => members.find((m) => m.userId === userId) ?? null,
      ),
      findLastActive: vi.fn().mockResolvedValue(new Map()),
      listSessions: vi.fn().mockResolvedValue([]),
      updateRole: vi.fn().mockResolvedValue(undefined),
      setActive: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(async () => ({ rows: members, totalCount: members.length })),
    });
    identity = createMock<IdentityService>({
      findOrCreateUserByEmail: vi.fn().mockResolvedValue({
        kind: 'created',
        userId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        email: 'new@team.test',
        tempPassword: 'temp-pass',
      }),
      createMembership: vi.fn(async () => {
        const created = member(9, VIEWER, { userId: 'cccccccc-cccc-4ccc-8ccc-000000000001' });
        members = [...members, created];
        return { membershipId: created.id, scope: 'reseller' as const };
      }),
      sendWelcomeNotification: vi.fn(),
    });
    redis = createMock<Redis>({ set: vi.fn().mockResolvedValue('OK') });
    service = new ResellerTeamService(repo, identity, redis);
  });

  describe('list', () => {
    it('marks who the caller may change: not themselves, not a senior', async () => {
      const asSupport = await service.list(actor(support), {});
      expect(asSupport.edges.map((e) => [e.node.username, e.node.canManage])).toEqual([
        ['member1', false],
        ['member2', false],
        ['member3', true],
        ['member4', false],
      ]);

      const asAdmin = await service.list(actor(admin), {});
      expect(asAdmin.edges.map((e) => e.node.canManage)).toEqual([false, true, true, true]);
      expect(asAdmin.totalCount).toBe(4);
    });

    it('lets a viewer read the list but change nobody', async () => {
      const result = await service.list(actor(viewer), {});
      expect(result.edges.map((e) => e.node.canManage)).toEqual([false, false, false, false]);
    });

    it('asks for one row more than the page and reports the next page', async () => {
      const result = await service.list(actor(admin), { first: 3 });
      expect(repo.list).toHaveBeenCalledWith(RESELLER_ID, {
        search: undefined,
        isActive: undefined,
        first: 4,
        afterId: undefined,
      });
      expect(result.edges).toHaveLength(3);
      expect(result.pageInfo.hasNextPage).toBe(true);
    });

    it('rejects a cursor that is not one of ours', async () => {
      await expectBusinessError(
        service.list(actor(admin), { after: 'not-a-cursor' }),
        ErrorCode.VALIDATION_FAILED,
      );
    });

    it('refuses a caller with no active membership in the reseller', async () => {
      members = [support, viewer];
      await expectBusinessError(service.list(actor(admin), {}), ErrorCode.FORBIDDEN);
      members = [{ ...admin, isActive: false }];
      await expectBusinessError(service.list(actor(admin), {}), ErrorCode.FORBIDDEN);
    });
  });

  describe('assignableRoles', () => {
    it('caps a support admin at their own role', async () => {
      const roles = await service.assignableRoles(actor(support));
      expect(roles.map((r) => r.id)).toEqual([SUPPORT, VIEWER]);
    });

    it('caps a full admin at the tier of the reseller', async () => {
      tier = 'SUPPORT_MANAGEMENT';
      const roles = await service.assignableRoles(actor(admin));
      expect(roles.map((r) => r.id)).toEqual([SUPPORT, VIEWER]);
    });

    it('gives a viewer nothing', async () => {
      expect(await service.assignableRoles(actor(viewer))).toEqual([]);
    });
  });

  describe('get', () => {
    it('shows sessions to a team manager', async () => {
      const sessions = [
        {
          id: 's1',
          ipAddress: '10.0.0.1',
          userAgent: 'Firefox',
          deviceInfo: null,
          createdAt: JOINED,
          lastUsedAt: null,
          expiresAt: JOINED,
        },
      ];
      vi.mocked(repo.listSessions).mockResolvedValue(sessions);
      const result = await service.get(actor(support), viewer.id);
      expect(result.sessions).toEqual(sessions);
      expect(repo.listSessions).toHaveBeenCalledWith(viewer.id);
    });

    it('hides a colleague sessions from a viewer but shows the viewer their own', async () => {
      expect((await service.get(actor(viewer), admin.id)).sessions).toBeNull();
      expect(repo.listSessions).not.toHaveBeenCalled();
      expect((await service.get(actor(viewer), viewer.id)).sessions).toEqual([]);
    });

    it('answers not-found for an unknown or malformed id without querying', async () => {
      await expectBusinessError(
        service.get(actor(admin), 'aaaaaaaa-aaaa-4aaa-aaaa-0000000000ee'),
        ErrorCode.TEAM_MEMBER_NOT_FOUND,
      );
      await expectBusinessError(service.get(actor(admin), 'nope'), ErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(repo.findMember).toHaveBeenCalledTimes(1);
    });
  });

  describe('invite', () => {
    it('creates the account, the membership and sends the welcome to a new person', async () => {
      const result = await service.invite(actor(admin), { email: 'New@Team.test', roleId: VIEWER });

      expect(identity.findOrCreateUserByEmail).toHaveBeenCalledWith('New@Team.test', admin.userId);
      expect(identity.createMembership).toHaveBeenCalledWith({
        userId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        scope: 'reseller',
        resellerId: RESELLER_ID,
        roleId: VIEWER,
        actorId: admin.userId,
      });
      expect(identity.sendWelcomeNotification).toHaveBeenCalledWith({
        userId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        username: 'new@team.test',
        email: 'new@team.test',
        tempPassword: 'temp-pass',
        scope: 'reseller',
        resellerId: RESELLER_ID,
      });
      expect(result.roleName).toEqual({ en: 'reseller_viewer' });
      expect(result.canManage).toBe(true);
    });

    it('links an existing account without sending a password', async () => {
      vi.mocked(identity.findOrCreateUserByEmail).mockResolvedValue({
        kind: 'existing',
        userId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        email: 'known@team.test',
      });
      await service.invite(actor(admin), { email: 'known@team.test', roleId: SUPPORT });
      expect(identity.createMembership).toHaveBeenCalledTimes(1);
      expect(identity.sendWelcomeNotification).not.toHaveBeenCalled();
    });

    it('refuses someone already on the team, active or not', async () => {
      vi.mocked(identity.findOrCreateUserByEmail).mockResolvedValue({
        kind: 'existing',
        userId: viewer.userId,
        email: viewer.email,
      });
      await expectBusinessError(
        service.invite(actor(admin), { email: viewer.email, roleId: VIEWER }),
        ErrorCode.TEAM_MEMBER_ALREADY_EXISTS,
      );
      expect(identity.createMembership).not.toHaveBeenCalled();
    });

    it.each([
      'ambiguous',
      'deleted',
      'username_taken',
    ] as const)('answers an unusable address (%s) with one code', async (reason) => {
      vi.mocked(identity.findOrCreateUserByEmail).mockResolvedValue({
        kind: 'unavailable',
        reason,
      });
      await expectBusinessError(
        service.invite(actor(admin), { email: 'x@team.test', roleId: VIEWER }),
        ErrorCode.TEAM_MEMBER_EMAIL_UNAVAILABLE,
      );
      expect(identity.createMembership).not.toHaveBeenCalled();
    });

    it('checks the role before touching any account', async () => {
      await expectBusinessError(
        service.invite(actor(support), { email: 'x@team.test', roleId: FULL }),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
      await expectBusinessError(
        service.invite(actor(admin), { email: 'x@team.test', roleId: FOREIGN_ROLE }),
        ErrorCode.FORBIDDEN,
      );
      await expectBusinessError(
        service.invite(actor(viewer), { email: 'x@team.test', roleId: VIEWER }),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
      expect(identity.findOrCreateUserByEmail).not.toHaveBeenCalled();
    });
  });

  describe('changeRole', () => {
    it('writes the role and makes tokens of the old role stale', async () => {
      await service.changeRole(actor(admin), viewer.id, SUPPORT);
      expect(repo.updateRole).toHaveBeenCalledWith(RESELLER_ID, viewer.id, SUPPORT, admin.userId);
      expect(redis.set).toHaveBeenCalledWith(
        `auth:reseller-member-access:${viewer.id}`,
        SUPPORT,
        'EX',
        660,
      );
    });

    it('does nothing when the role is unchanged', async () => {
      await service.changeRole(actor(admin), viewer.id, VIEWER);
      expect(repo.updateRole).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('refuses the caller changing their own role', async () => {
      await expectBusinessError(
        service.changeRole(actor(admin), admin.id, VIEWER),
        ErrorCode.TEAM_MEMBER_SELF_CHANGE,
      );
    });

    it('refuses a support admin touching a full admin or promoting to full admin', async () => {
      await expectBusinessError(
        service.changeRole(actor(support), admin.id, VIEWER),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
      await expectBusinessError(
        service.changeRole(actor(support), viewer.id, FULL),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
      expect(repo.updateRole).not.toHaveBeenCalled();
    });

    it('refuses a role above the tier of the reseller', async () => {
      tier = 'SUPPORT_MANAGEMENT';
      await expectBusinessError(
        service.changeRole(actor(admin), viewer.id, FULL),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
    });

    it('refuses a role of another reseller', async () => {
      await expectBusinessError(
        service.changeRole(actor(admin), viewer.id, FOREIGN_ROLE),
        ErrorCode.FORBIDDEN,
      );
    });
  });

  describe('deactivate and reactivate', () => {
    it('deactivates and blocks the member access tokens', async () => {
      await service.deactivate(actor(admin), support.id);
      expect(repo.setActive).toHaveBeenCalledWith(RESELLER_ID, support.id, false, admin.userId);
      expect(redis.set).toHaveBeenCalledWith(
        `auth:reseller-member-access:${support.id}`,
        'blocked',
        'EX',
        660,
      );
    });

    it('lets a full admin deactivate another full admin, never themselves', async () => {
      await service.deactivate(actor(admin), otherAdmin.id);
      expect(repo.setActive).toHaveBeenCalledTimes(1);
      await expectBusinessError(
        service.deactivate(actor(admin), admin.id),
        ErrorCode.TEAM_MEMBER_SELF_CHANGE,
      );
    });

    it('refuses a support admin deactivating a full admin', async () => {
      await expectBusinessError(
        service.deactivate(actor(support), admin.id),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
    });

    it('refuses a repeat of the current status', async () => {
      await expectBusinessError(
        service.reactivate(actor(admin), support.id),
        ErrorCode.TEAM_MEMBER_STATUS_UNCHANGED,
      );
      members = [admin, { ...support, isActive: false }];
      await expectBusinessError(
        service.deactivate(actor(admin), support.id),
        ErrorCode.TEAM_MEMBER_STATUS_UNCHANGED,
      );
    });

    it('reactivates and pins the member tokens to their current role', async () => {
      members = [admin, { ...support, isActive: false }];
      await service.reactivate(actor(admin), support.id);
      expect(repo.setActive).toHaveBeenCalledWith(RESELLER_ID, support.id, true, admin.userId);
      expect(redis.set).toHaveBeenCalledWith(
        `auth:reseller-member-access:${support.id}`,
        SUPPORT,
        'EX',
        660,
      );
    });

    it('refuses to reactivate a member whose role is now above the tier', async () => {
      tier = 'READ_ONLY';
      members = [
        { ...admin, roleId: VIEWER },
        { ...support, isActive: false },
      ];
      await expectBusinessError(
        service.reactivate(actor(admin), support.id),
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
      );
      expect(repo.setActive).not.toHaveBeenCalled();
    });
  });
});
