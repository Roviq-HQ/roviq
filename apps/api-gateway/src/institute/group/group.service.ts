/**
 * Group CRUD service (ROV-163).
 *
 * Handles group CRUD, dynamic rule-based resolution, composite group
 * resolution with recursive CTE, and hybrid (rule + manual) logic.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  BusinessException,
  DomainGroupType,
  ErrorCode,
  GroupMembershipType,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import type { JsonLogicRule } from '@roviq/groups';
import { extractDimensions } from '@roviq/groups';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import type {
  CreateGroupInput,
  GroupFilterInput,
  UpdateGroupInput,
} from './dto/create-group.input';
import type {
  GroupMemberModel,
  GroupResolutionUpdate,
  RulePreviewResult,
} from './models/group.model';
import { GroupRepository } from './repositories/group.repository';
import type { GroupRecord, GroupUpdate } from './repositories/types';

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  constructor(
    private readonly repo: GroupRepository,
    private readonly eventBus: EventBusService,
  ) {}

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  private getUserId(): string {
    const { userId } = getRequestContext();
    if (!userId) throw new Error('User context is required');
    return userId;
  }

  // ── CRUD ──────────────────────────────────────────────────

  async create(input: CreateGroupInput): Promise<GroupRecord> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const rule =
      input.rule && Object.keys(input.rule).length > 0
        ? {
            rule: input.rule,
            ruleDimensions: extractDimensions(input.rule),
            description: input.ruleDescription ?? null,
          }
        : null;

    const group = await this.repo.create({
      tenantId,
      actorId,
      name: input.name,
      description: input.description ?? null,
      groupType: input.groupType,
      membershipType: input.membershipType ?? GroupMembershipType.DYNAMIC,
      memberTypes: input.memberTypes ?? ['student'],
      isSystem: input.isSystem ?? false,
      parentGroupId: input.parentGroupId ?? null,
      rule,
      childGroupIds: input.childGroupIds ?? [],
    });

    this.logger.log(`Group created: ${group.id} (${input.groupType}/${input.membershipType})`);
    return group;
  }

  async findById(id: string): Promise<GroupRecord> {
    const group = await this.repo.findById(this.getTenantId(), id);
    if (!group) throw new BusinessException(ErrorCode.GROUP_NOT_FOUND, 'Group not found');
    return group;
  }

  async list(filter: GroupFilterInput): Promise<GroupRecord[]> {
    return this.repo.list(this.getTenantId(), {
      groupType: filter.groupType,
      membershipType: filter.membershipType,
      status: filter.status,
      search: filter.search,
    });
  }

  async update(id: string, input: UpdateGroupInput): Promise<GroupRecord> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const updates: GroupUpdate = {};
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.status !== undefined) updates.status = input.status;

    // Fold the rule-change invalidation into the `updates` object so both
    // field updates and `resolvedAt = NULL` land in a single UPDATE with
    // `returning()`. Previously a follow-up `.update().set({ resolvedAt: null })`
    // ran after the first RETURNING fired, so the mutation payload captured
    // a stale `resolvedAt` while the DB row was correctly invalidated.
    if (input.rule !== undefined) {
      updates.resolvedAt = null;
    }

    const rule =
      input.rule !== undefined
        ? {
            rule: input.rule,
            ruleDimensions: extractDimensions(input.rule),
            description: input.ruleDescription ?? null,
          }
        : null;

    const group = await this.repo.update(tenantId, id, actorId, updates, rule);

    if (!group) throw new BusinessException(ErrorCode.GROUP_NOT_FOUND, 'Group not found');
    if (rule) {
      this.eventBus.emit(EVENT_PATTERNS.GROUP.rules_updated, { groupId: id, tenantId });
    }
    return group;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.repo.softDelete(this.getTenantId(), id, this.getUserId());
    if (!deleted) throw new BusinessException(ErrorCode.GROUP_NOT_FOUND, 'Group not found');
    return true;
  }

  // ── RESOLUTION ────────────────────────────────────────────

  /**
   * Resolve group members based on membership_type:
   * - static: no-op (manual members only)
   * - dynamic: evaluate rules → matching membership_ids
   * - hybrid: rules + manual exclusions + manual additions
   * - composite: recursive CTE to resolve all child groups
   */
  async resolveMembers(groupId: string): Promise<GroupResolutionUpdate> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const group = await this.findById(groupId);

    if (group.membershipType === GroupMembershipType.STATIC) {
      const total = await this.repo.countActiveMembers(tenantId, groupId);

      const resolvedAt = new Date();
      await this.repo.setResolution(tenantId, groupId, total, resolvedAt, actorId);

      this.eventBus.emit(EVENT_PATTERNS.GROUP.membership_resolved, {
        groupId,
        memberCount: total,
        resolvedAt,
        tenantId,
      });

      return { groupId, memberCount: total, resolvedAt };
    }

    let matchingMembershipIds: string[] = [];

    if (group.groupType === DomainGroupType.COMPOSITE) {
      matchingMembershipIds = await this.repo.findCompositeMembers(tenantId, groupId);
    } else {
      matchingMembershipIds = await this.repo.findRuleMatches(tenantId, groupId);
    }

    // For hybrid: apply manual exclusions and additions
    if (group.membershipType === GroupMembershipType.HYBRID) {
      const excluded = await this.repo.listExcludedMembershipIds(tenantId, groupId);
      const excludedSet = new Set(excluded);
      matchingMembershipIds = matchingMembershipIds.filter((id) => !excludedSet.has(id));

      const manualIds = await this.repo.listManualMembershipIds(tenantId, groupId);
      const allIds = new Set([...matchingMembershipIds, ...manualIds]);
      matchingMembershipIds = [...allIds];
    }

    await this.repo.syncRuleMembers(tenantId, groupId, actorId, matchingMembershipIds);

    this.eventBus.emit(EVENT_PATTERNS.GROUP.membership_resolved, {
      groupId,
      memberCount: matchingMembershipIds.length,
      resolvedAt: new Date(),
      tenantId,
    });

    this.logger.log(`Group ${groupId} resolved: ${matchingMembershipIds.length} members`);
    return {
      groupId,
      memberCount: matchingMembershipIds.length,
      resolvedAt: new Date(),
    };
  }

  /**
   * Preview a rule without saving — dry-run returns count + 10 sample members.
   */
  async previewRule(rule: JsonLogicRule): Promise<RulePreviewResult> {
    return this.repo.previewRule(this.getTenantId(), rule);
  }

  // ── MEMBERS LIST & EXCLUSION TOGGLE ───────────────────────

  /**
   * List all group_members rows for a group (both active and excluded)
   * enriched with a best-effort display name drawn from the user record.
   *
   * Used by the group detail Members tab. Hybrid groups render a per-row
   * Exclude toggle that calls {@link setMemberExcluded}.
   */
  async listMembers(groupId: string): Promise<GroupMemberModel[]> {
    const tenantId = this.getTenantId();
    await this.findById(groupId);

    const rows = await this.repo.listMemberRows(tenantId, groupId);

    if (rows.length === 0) return [];

    // Display names come from memberships (institute RLS) → users (platform table).
    const membershipIds = rows.map((r) => r.membershipId);
    const membershipRows = await this.repo.findMembershipUsers(tenantId, membershipIds);

    const userIds = membershipRows.map((m) => m.userId);
    const userRows = userIds.length > 0 ? await this.repo.findUserNames(userIds) : [];

    const userById = new Map(userRows.map((u) => [u.id, u]));
    const displayByMembership = new Map<string, string>();
    for (const m of membershipRows) {
      const u = userById.get(m.userId);
      if (u) displayByMembership.set(m.id, u.username || u.email);
    }

    return rows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      membershipId: r.membershipId,
      source: r.source,
      isExcluded: r.isExcluded,
      resolvedAt: r.resolvedAt,
      displayName: displayByMembership.get(r.membershipId) ?? null,
    }));
  }

  /**
   * Toggle the `is_excluded` flag on a single group_member row.
   *
   * Used by the hybrid-group per-member Exclude toggle. Recomputes the
   * active member count (WHERE is_excluded = false) and emits
   * `GROUP.membership_resolved` so connected clients refresh live.
   */
  async setMemberExcluded(
    groupId: string,
    memberId: string,
    excluded: boolean,
  ): Promise<GroupMemberModel> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const row = await this.repo.setMemberExcluded(tenantId, groupId, memberId, excluded, actorId);

    if (!row)
      throw new BusinessException(ErrorCode.GROUP_MEMBER_NOT_FOUND, 'Group member not found');

    const resolvedAt = new Date();
    const newCount = await this.repo.refreshMemberCount(tenantId, groupId, resolvedAt, actorId);

    this.eventBus.emit(EVENT_PATTERNS.GROUP.membership_resolved, {
      groupId,
      memberCount: newCount,
      resolvedAt,
      tenantId,
    });

    return {
      id: row.id,
      groupId: row.groupId,
      membershipId: row.membershipId,
      source: row.source,
      isExcluded: row.isExcluded,
      resolvedAt: row.resolvedAt,
      displayName: null,
    };
  }
}
