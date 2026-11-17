/**
 * Group CRUD service (ROV-163).
 *
 * Handles group CRUD, dynamic rule-based resolution, composite group
 * resolution with recursive CTE, and hybrid (rule + manual) logic.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BusinessException,
  DomainGroupType,
  DynamicGroupStatus,
  ErrorCode,
  GroupMemberSource,
  GroupMembershipType,
} from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  groupChildren,
  groupMembers,
  groupMembersLive,
  groupRules,
  groupRulesLive,
  groups,
  groupsLive,
  membershipsLive,
  mkAdminCtx,
  mkInstituteCtx,
  usersLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import type { JsonLogicRule } from '@roviq/groups';
import { extractDimensions, groupRuleToDrizzleSql } from '@roviq/groups';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { and, count, eq, ilike, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type {
  CreateGroupInput,
  GroupFilterInput,
  UpdateGroupInput,
} from './dto/create-group.input';

/** Drizzle row type for the `groups` table — avoids `as GroupRecord` casts. */
type GroupRecord = typeof groups.$inferSelect;

import type {
  GroupMemberModel,
  GroupResolutionUpdate,
  RulePreviewResult,
} from './models/group.model';

@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
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

    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        // Create the group
        const newGroups = await tx
          .insert(groups)
          .values({
            tenantId,
            name: input.name,
            description: input.description ?? null,
            groupType: input.groupType,
            membershipType: input.membershipType ?? GroupMembershipType.DYNAMIC,
            memberTypes: input.memberTypes ?? ['student'],
            isSystem: input.isSystem ?? false,
            status: DynamicGroupStatus.ACTIVE,
            parentGroupId: input.parentGroupId ?? null,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();

        const groupId = newGroups[0].id;

        // Create rule if provided
        if (input.rule && Object.keys(input.rule).length > 0) {
          const dimensions = extractDimensions(input.rule);
          await tx.insert(groupRules).values({
            createdBy: actorId,
            updatedBy: actorId,
            groupId,
            tenantId,
            rule: input.rule,
            ruleDimensions: dimensions,
            description: input.ruleDescription ?? null,
          });
        }

        // Create composite children if provided
        if (input.childGroupIds && input.childGroupIds.length > 0) {
          for (const childId of input.childGroupIds) {
            await tx.insert(groupChildren).values({
              createdBy: actorId,
              updatedBy: actorId,
              parentGroupId: groupId,
              childGroupId: childId,
              tenantId,
            });
          }
        }

        return newGroups;
      },
    );

    this.logger.log(`Group created: ${rows[0].id} (${input.groupType}/${input.membershipType})`);
    return rows[0] as GroupRecord;
  }

  async findById(id: string): Promise<GroupRecord> {
    const tenantId = this.getTenantId();
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        return tx.select().from(groupsLive).where(eq(groupsLive.id, id)).limit(1);
      },
    );
    if (rows.length === 0)
      throw new BusinessException(ErrorCode.GROUP_NOT_FOUND, 'Group not found');
    return rows[0] as GroupRecord;
  }

  async list(filter: GroupFilterInput): Promise<GroupRecord[]> {
    const tenantId = this.getTenantId();
    const conditions: SQL[] = [];
    if (filter.groupType) conditions.push(eq(groupsLive.groupType, filter.groupType));
    if (filter.membershipType)
      conditions.push(eq(groupsLive.membershipType, filter.membershipType));
    if (filter.status) conditions.push(eq(groupsLive.status, filter.status));
    if (filter.search) conditions.push(ilike(groupsLive.name, `%${filter.search}%`));

    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:group'), async (tx) => {
      const rows = await tx
        .select()
        .from(groupsLive)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(groupsLive.name);
      return rows as GroupRecord[];
    });
  }

  async update(id: string, input: UpdateGroupInput): Promise<GroupRecord> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();

    const updates: Record<string, unknown> = { updatedBy: actorId };
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

    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        if (input.rule !== undefined) {
          const dimensions = extractDimensions(input.rule);
          // Replace any existing rule rows before the groups UPDATE so the
          // invalidation is atomic with the rule change.
          await tx
            .update(groupRules)
            .set({ deletedAt: new Date(), deletedBy: actorId, updatedBy: actorId })
            .where(and(eq(groupRules.groupId, id), isNull(groupRules.deletedAt)));
          await tx.insert(groupRules).values({
            createdBy: actorId,
            updatedBy: actorId,
            groupId: id,
            tenantId,
            rule: input.rule,
            ruleDimensions: dimensions,
            description: input.ruleDescription ?? null,
          });

          this.eventBus.emit(EVENT_PATTERNS.GROUP.rules_updated, { groupId: id, tenantId });
        }

        return tx
          .update(groups)
          .set(updates)
          .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
          .returning();
      },
    );

    if (rows.length === 0)
      throw new BusinessException(ErrorCode.GROUP_NOT_FOUND, 'Group not found');
    return rows[0] as GroupRecord;
  }

  async delete(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const actorId = this.getUserId();
    const deleted = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        return tx
          .update(groups)
          .set({ deletedAt: new Date(), deletedBy: actorId, updatedBy: actorId })
          .where(and(eq(groups.id, id), sql`${groups.deletedAt} IS NULL`))
          .returning({ id: groups.id });
      },
    );
    if (deleted.length === 0)
      throw new BusinessException(ErrorCode.GROUP_NOT_FOUND, 'Group not found');
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
      // Count existing manual members
      const [{ total }] = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:group'),
        async (tx) => {
          return tx
            .select({ total: count() })
            .from(groupMembersLive)
            .where(
              and(eq(groupMembersLive.groupId, groupId), eq(groupMembersLive.isExcluded, false)),
            );
        },
      );

      const resolvedAt = new Date();
      await withTenant(this.db, mkInstituteCtx(tenantId, 'service:group'), async (tx) => {
        await tx
          .update(groups)
          .set({ memberCount: total, resolvedAt, updatedBy: actorId })
          .where(eq(groups.id, groupId));
      });

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
      matchingMembershipIds = await this.resolveComposite(tenantId, groupId);
    } else {
      matchingMembershipIds = await this.resolveDynamic(tenantId, groupId);
    }

    // For hybrid: apply manual exclusions and additions
    if (group.membershipType === GroupMembershipType.HYBRID) {
      const excluded = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:group'),
        async (tx) => {
          return tx
            .select({ membershipId: groupMembersLive.membershipId })
            .from(groupMembersLive)
            .where(
              and(eq(groupMembersLive.groupId, groupId), eq(groupMembersLive.isExcluded, true)),
            );
        },
      );
      const excludedSet = new Set(excluded.map((r) => r.membershipId));
      matchingMembershipIds = matchingMembershipIds.filter((id) => !excludedSet.has(id));

      // Add manual members
      const manual = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:group'),
        async (tx) => {
          return tx
            .select({ membershipId: groupMembersLive.membershipId })
            .from(groupMembersLive)
            .where(
              and(
                eq(groupMembersLive.groupId, groupId),
                eq(groupMembersLive.source, GroupMemberSource.MANUAL),
                eq(groupMembersLive.isExcluded, false),
              ),
            );
        },
      );
      const manualIds = manual.map((r) => r.membershipId);
      const allIds = new Set([...matchingMembershipIds, ...manualIds]);
      matchingMembershipIds = [...allIds];
    }

    await withTenant(this.db, mkInstituteCtx(tenantId, 'service:group'), async (tx) => {
      const now = new Date();
      const current = await tx
        .select({
          id: groupMembersLive.id,
          membershipId: groupMembersLive.membershipId,
          source: groupMembersLive.source,
        })
        .from(groupMembersLive)
        .where(eq(groupMembersLive.groupId, groupId));

      // Diff instead of delete-and-reinsert: unchanged members keep their row,
      // so a re-resolve only leaves a tombstone for a member that really left.
      const matching = new Set(matchingMembershipIds);
      const staleIds = current
        .filter((m) => m.source === GroupMemberSource.RULE && !matching.has(m.membershipId))
        .map((m) => m.id);
      if (staleIds.length > 0) {
        await tx
          .update(groupMembers)
          .set({ deletedAt: now, deletedBy: actorId, updatedBy: actorId })
          .where(inArray(groupMembers.id, staleIds));
      }

      const present = new Set(current.map((m) => m.membershipId));
      const added = matchingMembershipIds.filter((id) => !present.has(id));
      if (added.length > 0) {
        await tx.insert(groupMembers).values(
          added.map((membershipId) => ({
            createdBy: actorId,
            updatedBy: actorId,
            groupId,
            tenantId,
            membershipId,
            source: GroupMemberSource.RULE,
            isExcluded: false,
            resolvedAt: now,
          })),
        );
      }

      // Update group metadata
      await tx
        .update(groups)
        .set({
          memberCount: matchingMembershipIds.length,
          resolvedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(groups.id, groupId));
    });

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
    const tenantId = this.getTenantId();
    const whereClause = groupRuleToDrizzleSql(rule) ?? sql`true`;

    return withTenant(this.db, mkInstituteCtx(tenantId, 'service:group'), async (tx) => {
      // Read from `*_live` views (soft-delete-hiding) but alias them back to
      // the base table names so the column references emitted by
      // `groupRuleToDrizzleSql` (DIMENSION_TO_COLUMN — e.g., "student_profiles"."gender")
      // resolve. user_profiles is not soft-deletable, so it stays as-is.
      const rows = await tx.execute(
        sql`SELECT student_profiles.membership_id FROM student_profiles_live AS student_profiles
            INNER JOIN user_profiles ON user_profiles.user_id = student_profiles.user_id
            LEFT JOIN student_academics_live AS student_academics ON student_academics.student_profile_id = student_profiles.id
            LEFT JOIN sections_live AS sections ON sections.id = student_academics.section_id
            WHERE ${whereClause}
            LIMIT 10`,
      );

      const countRows = await tx.execute(
        sql`SELECT COUNT(*)::int AS total FROM student_profiles_live AS student_profiles
            INNER JOIN user_profiles ON user_profiles.user_id = student_profiles.user_id
            LEFT JOIN student_academics_live AS student_academics ON student_academics.student_profile_id = student_profiles.id
            LEFT JOIN sections_live AS sections ON sections.id = student_academics.section_id
            WHERE ${whereClause}`,
      );

      return {
        count: (countRows.rows[0] as { total: number }).total,
        sampleMembershipIds: (rows.rows as { membership_id: string }[]).map((r) => r.membership_id),
      };
    });
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

    // 1. Fetch group_members (tenant-scoped via RLS).
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        return tx
          .select({
            id: groupMembersLive.id,
            groupId: groupMembersLive.groupId,
            membershipId: groupMembersLive.membershipId,
            source: groupMembersLive.source,
            isExcluded: groupMembersLive.isExcluded,
            resolvedAt: groupMembersLive.resolvedAt,
          })
          .from(groupMembersLive)
          .where(eq(groupMembersLive.groupId, groupId))
          .orderBy(groupMembersLive.isExcluded, groupMembersLive.id);
      },
    );

    if (rows.length === 0) return [];

    // 2. Resolve display names via memberships → users.
    //    `memberships` is tenant-scoped (withTenant), `users` is a platform
    //    table and must be read under withAdmin.
    const membershipIds = rows.map((r) => r.membershipId);
    const membershipRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        return tx
          .select({ id: membershipsLive.id, userId: membershipsLive.userId })
          .from(membershipsLive)
          .where(inArray(membershipsLive.id, membershipIds));
      },
    );

    const userIds = membershipRows.map((m) => m.userId);
    const userRows =
      userIds.length > 0
        ? await withAdmin(this.db, mkAdminCtx('service:group'), async (tx) => {
            return tx
              .select({ id: usersLive.id, username: usersLive.username, email: usersLive.email })
              .from(usersLive)
              .where(inArray(usersLive.id, userIds));
          })
        : [];

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

    const updated = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        const rows = await tx
          .update(groupMembers)
          .set({ isExcluded: excluded, updatedBy: actorId })
          .where(and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)))
          .returning();
        return rows;
      },
    );

    if (updated.length === 0)
      throw new BusinessException(ErrorCode.GROUP_MEMBER_NOT_FOUND, 'Group member not found');

    // Recompute active count and update groups.memberCount + resolvedAt.
    const resolvedAt = new Date();
    const newCount = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        const [{ total }] = await tx
          .select({ total: count() })
          .from(groupMembersLive)
          .where(
            and(eq(groupMembersLive.groupId, groupId), eq(groupMembersLive.isExcluded, false)),
          );

        await tx
          .update(groups)
          .set({ memberCount: total, resolvedAt, updatedBy: actorId })
          .where(eq(groups.id, groupId));

        return total;
      },
    );

    this.eventBus.emit(EVENT_PATTERNS.GROUP.membership_resolved, {
      groupId,
      memberCount: newCount,
      resolvedAt,
      tenantId,
    });

    const row = updated[0];
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

  // ── PRIVATE HELPERS ───────────────────────────────────────

  /** Resolve dynamic group: evaluate JsonLogic rules → membership_ids */
  private async resolveDynamic(tenantId: string, groupId: string): Promise<string[]> {
    const ruleRows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        return tx.select().from(groupRulesLive).where(eq(groupRulesLive.groupId, groupId));
      },
    );

    if (ruleRows.length === 0) return [];

    // Convert each rule to a Drizzle SQL object with proper param binding
    const drizzleConditions = ruleRows
      .map((r) => groupRuleToDrizzleSql(r.rule as JsonLogicRule))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    if (drizzleConditions.length === 0) return [];

    // Combine multiple rules with OR (any rule matching = member)
    const combinedWhere =
      drizzleConditions.length === 1
        ? drizzleConditions[0]
        : sql.join(drizzleConditions, sql` OR `);

    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        return tx.execute(
          sql`SELECT student_profiles.membership_id FROM student_profiles_live AS student_profiles
            INNER JOIN user_profiles ON user_profiles.user_id = student_profiles.user_id
            LEFT JOIN student_academics_live AS student_academics ON student_academics.student_profile_id = student_profiles.id
            LEFT JOIN sections_live AS sections ON sections.id = student_academics.section_id
            WHERE ${combinedWhere}`,
        );
      },
    );

    return (rows.rows as { membership_id: string }[]).map((r) => r.membership_id);
  }

  /**
   * Resolve composite group: WITH RECURSIVE CTE to collect all
   * child groups (max depth 5, cycle detection), then UNION their members.
   */
  private async resolveComposite(tenantId: string, groupId: string): Promise<string[]> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:group'),
      async (tx) => {
        // Use recursive CTE to traverse the group hierarchy
        const result = await tx.execute(sql`
        WITH RECURSIVE group_tree AS (
          -- Base case: direct children of this composite group
          SELECT child_group_id AS group_id, 1 AS depth, ARRAY[${groupId}::uuid] AS path
          FROM group_children
          WHERE parent_group_id = ${groupId}::uuid

          UNION ALL

          -- Recursive case: children of children
          SELECT gc.child_group_id, gt.depth + 1, gt.path || gc.child_group_id
          FROM group_children gc
          INNER JOIN group_tree gt ON gt.group_id = gc.parent_group_id
          WHERE gt.depth < 5
            AND NOT gc.child_group_id = ANY(gt.path)  -- cycle detection
        )
        SELECT DISTINCT gm.membership_id
        FROM group_tree gt
        INNER JOIN group_members gm ON gm.group_id = gt.group_id
        WHERE gm.is_excluded = false
      `);

        return result.rows as { membership_id: string }[];
      },
    );

    return rows.map((r) => r.membership_id);
  }
}
