import { Inject, Injectable } from '@nestjs/common';
import {
  assignableResellerRoleNames,
  BusinessException,
  canManageResellerMember,
  ErrorCode,
  type ResellerTier,
} from '@roviq/common-types';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { IdentityService } from '../../auth/identity.service';
import {
  RESELLER_MEMBER_BLOCKED,
  requireResellerMemberRole,
} from '../../auth/reseller-access-cache';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { ResellerInviteTeamMemberInput } from './dto/reseller-invite-team-member.input';
import type { ResellerTeamFilterInput } from './dto/reseller-team-filter.input';
import {
  ResellerTeamRepository,
  type TeamMemberRecord,
  type TeamRoleRecord,
} from './repositories/reseller-team.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TeamActor {
  resellerId: string;
  userId: string;
}

/** What the caller is allowed to do, read from the database rather than the token. */
interface ActorStanding {
  actor: TeamActor;
  roles: Map<string, TeamRoleRecord>;
  actorRoleName: string | null;
  tier: ResellerTier;
}

@Injectable()
export class ResellerTeamService {
  constructor(
    private readonly repo: ResellerTeamRepository,
    private readonly identityService: IdentityService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(actor: TeamActor, filter: ResellerTeamFilterInput) {
    const first = filter.first ?? 20;
    const standing = await this.loadStanding(actor);
    const { rows, totalCount } = await this.repo.list(actor.resellerId, {
      search: filter.search,
      isActive: filter.isActive,
      first: first + 1,
      afterId: filter.after ? parseCursor(filter.after) : undefined,
    });

    const hasNextPage = rows.length > first;
    const page = hasNextPage ? rows.slice(0, first) : rows;
    const lastActive = await this.repo.findLastActive(page.map((row) => row.userId));
    const edges = page.map((row) => ({
      node: toModel(row, standing, lastActive),
      cursor: encodeCursor({ id: row.id }),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!filter.after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount,
    };
  }

  async get(actor: TeamActor, membershipId: string) {
    const standing = await this.loadStanding(actor);
    const member = await this.requireMember(actor.resellerId, membershipId);
    const lastActive = await this.repo.findLastActive([member.userId]);
    // Sessions carry IP and device: only for the member themselves or someone ranked to manage them.
    const maySeeSessions = member.userId === actor.userId || canManage(standing, member);
    return {
      ...toModel(member, standing, lastActive),
      sessions: maySeeSessions ? await this.repo.listSessions(member.id) : null,
    };
  }

  /** Roles the caller may hand out, most senior first. Empty for a viewer. */
  async assignableRoles(actor: TeamActor): Promise<TeamRoleRecord[]> {
    const standing = await this.loadStanding(actor);
    return this.assignableRoleIds(standing).flatMap((id) => standing.roles.get(id) ?? []);
  }

  async invite(actor: TeamActor, input: ResellerInviteTeamMemberInput) {
    const standing = await this.loadStanding(actor);
    this.assertAssignable(standing, input.roleId);

    const resolved = await this.identityService.findOrCreateUserByEmail(input.email, actor.userId);
    if (resolved.kind === 'unavailable') {
      // One code for every reason: the caller must not learn why an address is taken.
      throw new BusinessException(
        ErrorCode.TEAM_MEMBER_EMAIL_UNAVAILABLE,
        'This email cannot be used for a team member',
      );
    }
    if (
      resolved.kind === 'existing' &&
      (await this.repo.findMemberByUser(actor.resellerId, resolved.userId))
    ) {
      throw new BusinessException(
        ErrorCode.TEAM_MEMBER_ALREADY_EXISTS,
        'This person is already on the team',
      );
    }

    const { membershipId } = await this.identityService.createMembership({
      userId: resolved.userId,
      scope: 'reseller',
      resellerId: actor.resellerId,
      roleId: input.roleId,
      actorId: actor.userId,
    });

    // An existing user keeps their password, so only a new one gets the welcome.
    if (resolved.kind === 'created') {
      this.identityService.sendWelcomeNotification({
        userId: resolved.userId,
        username: resolved.email,
        email: resolved.email,
        tempPassword: resolved.tempPassword,
        scope: 'reseller',
        resellerId: actor.resellerId,
      });
    }

    return this.reload(standing, membershipId);
  }

  async changeRole(actor: TeamActor, membershipId: string, roleId: string) {
    const standing = await this.loadStanding(actor);
    const member = await this.requireMember(actor.resellerId, membershipId);
    this.assertManageable(standing, member);
    this.assertAssignable(standing, roleId);
    if (member.roleId === roleId) return this.reload(standing, membershipId);

    await this.repo.updateRole(actor.resellerId, membershipId, roleId, actor.userId);
    // Tokens issued under the old role stop working now, not when they expire.
    await requireResellerMemberRole(this.redis, membershipId, roleId);
    return this.reload(standing, membershipId);
  }

  /** The user account and their other memberships are untouched; a DB trigger ends the sessions. */
  async deactivate(actor: TeamActor, membershipId: string) {
    const standing = await this.loadStanding(actor);
    const member = await this.requireMember(actor.resellerId, membershipId);
    this.assertManageable(standing, member);
    if (!member.isActive) {
      throw new BusinessException(
        ErrorCode.TEAM_MEMBER_STATUS_UNCHANGED,
        'Team member is already inactive',
      );
    }

    await this.repo.setActive(actor.resellerId, membershipId, false, actor.userId);
    await requireResellerMemberRole(this.redis, membershipId, RESELLER_MEMBER_BLOCKED);
    return this.reload(standing, membershipId);
  }

  async reactivate(actor: TeamActor, membershipId: string) {
    const standing = await this.loadStanding(actor);
    const member = await this.requireMember(actor.resellerId, membershipId);
    this.assertManageable(standing, member);
    if (member.isActive) {
      throw new BusinessException(
        ErrorCode.TEAM_MEMBER_STATUS_UNCHANGED,
        'Team member is already active',
      );
    }
    // The tier may have dropped below the member's role while they were inactive.
    this.assertAssignable(standing, member.roleId);

    await this.repo.setActive(actor.resellerId, membershipId, true, actor.userId);
    await requireResellerMemberRole(this.redis, membershipId, member.roleId);
    return this.reload(standing, membershipId);
  }

  private async loadStanding(actor: TeamActor): Promise<ActorStanding> {
    const [roles, self, tier] = await Promise.all([
      this.repo.listRoles(actor.resellerId),
      this.repo.findMemberByUser(actor.resellerId, actor.userId),
      this.repo.findTier(actor.resellerId),
    ]);
    if (!self?.isActive || !tier) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'No active membership in this reseller');
    }
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return {
      actor,
      roles: roleMap,
      actorRoleName: roleMap.get(self.roleId)?.name.en ?? null,
      tier,
    };
  }

  private assignableRoleIds(standing: ActorStanding): string[] {
    const idByName = new Map([...standing.roles.values()].map((role) => [role.name.en, role.id]));
    return assignableResellerRoleNames(standing.actorRoleName, standing.tier).flatMap(
      (name) => idByName.get(name) ?? [],
    );
  }

  private assertAssignable(standing: ActorStanding, roleId: string): void {
    if (!standing.roles.has(roleId)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Role does not belong to this reseller');
    }
    if (!this.assignableRoleIds(standing).includes(roleId)) {
      throw new BusinessException(
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
        "Role is senior to the caller's own role or to the reseller's tier",
      );
    }
  }

  private assertManageable(standing: ActorStanding, member: TeamMemberRecord): void {
    if (member.userId === standing.actor.userId) {
      throw new BusinessException(
        ErrorCode.TEAM_MEMBER_SELF_CHANGE,
        'Team members cannot change their own role or status',
      );
    }
    if (!canManage(standing, member)) {
      throw new BusinessException(
        ErrorCode.TEAM_ROLE_NOT_ASSIGNABLE,
        "Team member holds a role senior to the caller's own",
      );
    }
  }

  private async requireMember(resellerId: string, membershipId: string): Promise<TeamMemberRecord> {
    const member = UUID_RE.test(membershipId)
      ? await this.repo.findMember(resellerId, membershipId)
      : null;
    if (!member) {
      throw new BusinessException(
        ErrorCode.TEAM_MEMBER_NOT_FOUND,
        'Team member not found in this reseller',
      );
    }
    return member;
  }

  private async reload(standing: ActorStanding, membershipId: string) {
    const member = await this.requireMember(standing.actor.resellerId, membershipId);
    return toModel(member, standing, await this.repo.findLastActive([member.userId]));
  }
}

function canManage(standing: ActorStanding, member: TeamMemberRecord): boolean {
  return (
    member.userId !== standing.actor.userId &&
    canManageResellerMember(standing.actorRoleName, standing.roles.get(member.roleId)?.name.en)
  );
}

function toModel(member: TeamMemberRecord, standing: ActorStanding, lastActive: Map<string, Date>) {
  return {
    ...member,
    roleName: standing.roles.get(member.roleId)?.name ?? null,
    lastActiveAt: lastActive.get(member.userId) ?? null,
    canManage: canManage(standing, member),
  };
}

function parseCursor(after: string): string {
  let id: unknown;
  try {
    ({ id } = decodeCursor(after));
  } catch {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  return id;
}
