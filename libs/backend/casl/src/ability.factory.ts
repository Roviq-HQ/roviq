import { createMongoAbility } from '@casl/ability';
import { Inject, Injectable } from '@nestjs/common';
import type { AbilityRule, AppAbility } from '@roviq/common-types';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { MembershipAbilityRepository } from './repositories/membership-ability.repository';
import { RoleRepository } from './repositories/role.repository';
import { substituteUserVars, type UserContext } from './substitute-user-vars';

const ROLE_CACHE_PREFIX = 'casl:role:';
const ROLE_CACHE_TTL = 300; // 5 minutes

function roleCacheKey(roleId: string, tenantId?: string): string {
  return tenantId ? `${ROLE_CACHE_PREFIX}${tenantId}:${roleId}` : `${ROLE_CACHE_PREFIX}${roleId}`;
}

@Injectable()
export class AbilityFactory {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly roleRepo: RoleRepository,
    private readonly membershipAbilityRepo: MembershipAbilityRepository,
  ) {}

  async createForUser(user: {
    userId: string;
    scope: import('@roviq/common-types').AuthScope;
    tenantId?: string;
    membershipId: string;
    roleId: string;
    /** Optional context for variable substitution in CASL conditions */
    assignedSections?: string[];
    assignedSubjects?: string[];
    assignedDepartments?: string[];
  }): Promise<AppAbility> {
    const roleAbilities = await this.getRoleAbilities(
      user.roleId,
      user.scope === 'institute' ? user.tenantId : undefined,
    );

    // Fetch membership-specific abilities (only for institute scope where tenantId exists)
    const membership = user.tenantId
      ? await this.membershipAbilityRepo.findAbilities(user.membershipId, user.tenantId)
      : null;

    // A membership that ended or was revoked gives nothing, whatever its role allows: an access
    // token issued before then stays valid until it expires.
    if (user.tenantId && !membership) return createMongoAbility<AppAbility>([]);

    const memberAbilities = membership?.abilities ?? [];

    const needsAssignments = [...roleAbilities, ...memberAbilities].some((rule) => {
      const conditions = JSON.stringify(rule.conditions ?? {});
      return (
        conditions.includes('$user.assignedSections') ||
        conditions.includes('$user.linkedStudentIds')
      );
    });
    const assignments =
      user.scope === 'institute' && user.tenantId && needsAssignments
        ? await this.membershipAbilityRepo.findReadAssignments(user.membershipId, user.tenantId)
        : { assignedSections: [], linkedStudentIds: [] };

    // Assignments come from current database state, not token or client claims.
    const context: UserContext = {
      userId: user.userId,
      membershipId: user.membershipId,
      tenantId: user.tenantId,
      assignedSections: assignments.assignedSections,
      linkedStudentIds: assignments.linkedStudentIds,
      assignedSubjects: user.assignedSubjects,
      assignedDepartments: user.assignedDepartments,
    };

    // Resolve $user.* placeholders in conditions using substituteUserVars
    const resolvedRules = [...roleAbilities, ...memberAbilities].map((rule) => {
      if (!rule.conditions) return rule;
      return {
        ...rule,
        conditions: substituteUserVars(rule.conditions as Record<string, unknown>, context),
      };
    });

    return createMongoAbility<AppAbility>(resolvedRules);
  }

  /**
   * With `tenantId` (an institute caller) the role is read as the institute role, so a role of
   * another institute gives nothing. A role that is not found is not cached.
   */
  async getRoleAbilities(roleId: string, tenantId?: string): Promise<AbilityRule[]> {
    // An institute caller's entry is keyed by its institute too: a hit proves the same read.
    const cacheKey = roleCacheKey(roleId, tenantId);

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as AbilityRule[];
    }

    const role = tenantId
      ? await this.roleRepo.findInstituteAbilities(roleId, tenantId)
      : await this.roleRepo.findAbilities(roleId);
    if (!role) return [];

    const abilities = role.abilities ?? [];

    await this.redis.set(cacheKey, JSON.stringify(abilities), 'EX', ROLE_CACHE_TTL);

    return abilities;
  }

  /** Pass the institute of an institute role, so its callers' entry goes too. */
  async invalidateRoleCache(roleId: string, tenantId?: string): Promise<void> {
    await this.redis.del(roleCacheKey(roleId));
    if (tenantId) await this.redis.del(roleCacheKey(roleId, tenantId));
  }

  async getPrimaryNavSlugs(roleId: string): Promise<string[]> {
    return this.roleRepo.findPrimaryNavSlugs(roleId);
  }
}
