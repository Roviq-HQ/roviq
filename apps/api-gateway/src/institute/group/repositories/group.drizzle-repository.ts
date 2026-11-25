import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessException,
  DynamicGroupStatus,
  ErrorCode,
  GroupMemberSource,
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
  type I18nContent,
  mapUniqueViolation,
  membershipsLive,
  mkInstituteCtx,
  type UniqueViolationErrors,
  usersLive,
  withTenant,
} from '@roviq/database';
import { groupRuleToDrizzleSql, type JsonLogicRule } from '@roviq/groups';
import { and, count, eq, ilike, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { GroupRepository } from './group.repository';
import type {
  CreateGroupData,
  GroupListQuery,
  GroupMemberListRow,
  GroupMemberRow,
  GroupRecord,
  GroupRuleData,
  GroupUpdate,
  MembershipUserRow,
  RulePreview,
  UserNameRow,
} from './types';

const ORIGIN = 'service:group';

const NAME_TAKEN: UniqueViolationErrors = {
  idx_group_name_active: () =>
    new BusinessException(
      ErrorCode.GROUP_NAME_DUPLICATE,
      'A group with this name already exists in this institute',
    ),
};

@Injectable()
export class GroupDrizzleRepository extends GroupRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async create(data: CreateGroupData): Promise<GroupRecord | null> {
    const { tenantId, actorId } = data;
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      // Foreign keys accept any institute's group; the view under RLS does not.
      const linkedIds = [
        ...new Set([...(data.parentGroupId ? [data.parentGroupId] : []), ...data.childGroupIds]),
      ];
      if (linkedIds.length > 0) {
        const found = await tx
          .select({ id: groupsLive.id })
          .from(groupsLive)
          .where(inArray(groupsLive.id, linkedIds));
        if (found.length !== linkedIds.length) return [];
      }

      const newGroups = await tx
        .insert(groups)
        .values({
          tenantId,
          name: data.name,
          description: data.description,
          groupType: data.groupType,
          membershipType: data.membershipType,
          memberTypes: data.memberTypes,
          isSystem: data.isSystem,
          status: DynamicGroupStatus.ACTIVE,
          parentGroupId: data.parentGroupId,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();

      const groupId = newGroups[0].id;

      if (data.rule) {
        await tx.insert(groupRules).values({
          createdBy: actorId,
          updatedBy: actorId,
          groupId,
          tenantId,
          rule: data.rule.rule,
          ruleDimensions: data.rule.ruleDimensions,
          description: data.rule.description,
        });
      }

      for (const childId of data.childGroupIds) {
        await tx.insert(groupChildren).values({
          createdBy: actorId,
          updatedBy: actorId,
          parentGroupId: groupId,
          childGroupId: childId,
          tenantId,
        });
      }

      return newGroups;
    }).catch(mapUniqueViolation(NAME_TAKEN));
    return rows.length === 0 ? null : (rows[0] as GroupRecord);
  }

  async findById(tenantId: string, id: string): Promise<GroupRecord | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx.select().from(groupsLive).where(eq(groupsLive.id, id)).limit(1);
    });
    return rows.length === 0 ? null : (rows[0] as GroupRecord);
  }

  async list(tenantId: string, query: GroupListQuery): Promise<GroupRecord[]> {
    const conditions: SQL[] = [];
    if (query.groupType) conditions.push(eq(groupsLive.groupType, query.groupType));
    if (query.membershipType) conditions.push(eq(groupsLive.membershipType, query.membershipType));
    if (query.status) conditions.push(eq(groupsLive.status, query.status));
    if (query.search) conditions.push(ilike(groupsLive.name, `%${query.search}%`));

    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .select()
        .from(groupsLive)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(groupsLive.name);
      return rows as GroupRecord[];
    });
  }

  async update(
    tenantId: string,
    id: string,
    actorId: string,
    updates: GroupUpdate,
    rule: GroupRuleData | null,
  ): Promise<GroupRecord | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      // The group first: RLS makes another institute's group match nothing, and the rule rows
      // below would otherwise be stored against its id (a foreign key does not apply RLS).
      const updated = await tx
        .update(groups)
        .set({ updatedBy: actorId, ...updates })
        .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
        .returning();
      if (updated.length === 0 || !rule) return updated;

      await tx
        .update(groupRules)
        .set({ deletedAt: new Date(), deletedBy: actorId, updatedBy: actorId })
        .where(and(eq(groupRules.groupId, id), isNull(groupRules.deletedAt)));
      await tx.insert(groupRules).values({
        createdBy: actorId,
        updatedBy: actorId,
        groupId: id,
        tenantId,
        rule: rule.rule,
        ruleDimensions: rule.ruleDimensions,
        description: rule.description,
      });
      return updated;
    }).catch(mapUniqueViolation(NAME_TAKEN));
    return rows.length === 0 ? null : (rows[0] as GroupRecord);
  }

  async softDelete(tenantId: string, id: string, actorId: string): Promise<boolean> {
    const deleted = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .update(groups)
        .set({ deletedAt: new Date(), deletedBy: actorId, updatedBy: actorId })
        .where(and(eq(groups.id, id), sql`${groups.deletedAt} IS NULL`))
        .returning({ id: groups.id });
    });
    return deleted.length > 0;
  }

  async countActiveMembers(tenantId: string, groupId: string): Promise<number> {
    const [{ total }] = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ total: count() })
        .from(groupMembersLive)
        .where(and(eq(groupMembersLive.groupId, groupId), eq(groupMembersLive.isExcluded, false)));
    });
    return total;
  }

  async setResolution(
    tenantId: string,
    groupId: string,
    memberCount: number,
    resolvedAt: Date,
    actorId: string,
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      await tx
        .update(groups)
        .set({ memberCount, resolvedAt, updatedBy: actorId })
        .where(eq(groups.id, groupId));
    });
  }

  async findRuleMatches(tenantId: string, groupId: string): Promise<string[]> {
    const ruleRows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx.select().from(groupRulesLive).where(eq(groupRulesLive.groupId, groupId));
    });

    if (ruleRows.length === 0) return [];

    // Each rule becomes a parameter-bound SQL condition.
    const drizzleConditions = ruleRows
      .map((r) => groupRuleToDrizzleSql(r.rule as JsonLogicRule))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    if (drizzleConditions.length === 0) return [];

    // Any rule matching makes a member.
    const combinedWhere =
      drizzleConditions.length === 1
        ? drizzleConditions[0]
        : sql.join(drizzleConditions, sql` OR `);

    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx.execute(
        sql`SELECT student_profiles.membership_id FROM student_profiles_live AS student_profiles
            INNER JOIN tenant_user_profiles_live AS tenant_user_profiles ON tenant_user_profiles.user_id = student_profiles.user_id AND tenant_user_profiles.tenant_id = student_profiles.tenant_id
            LEFT JOIN student_academics_live AS student_academics ON student_academics.student_profile_id = student_profiles.id
            LEFT JOIN sections_live AS sections ON sections.id = student_academics.section_id
            WHERE ${combinedWhere}`,
      );
    });

    return (rows.rows as { membership_id: string }[]).map((r) => r.membership_id);
  }

  async findCompositeMembers(tenantId: string, groupId: string): Promise<string[]> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
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
    });

    return rows.map((r) => r.membership_id);
  }

  async listExcludedMembershipIds(tenantId: string, groupId: string): Promise<string[]> {
    const excluded = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ membershipId: groupMembersLive.membershipId })
        .from(groupMembersLive)
        .where(and(eq(groupMembersLive.groupId, groupId), eq(groupMembersLive.isExcluded, true)));
    });
    return excluded.map((r) => r.membershipId);
  }

  async listManualMembershipIds(tenantId: string, groupId: string): Promise<string[]> {
    const manual = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
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
    });
    return manual.map((r) => r.membershipId);
  }

  async syncRuleMembers(
    tenantId: string,
    groupId: string,
    actorId: string,
    matchingMembershipIds: string[],
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
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

      await tx
        .update(groups)
        .set({
          memberCount: matchingMembershipIds.length,
          resolvedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(groups.id, groupId));
    });
  }

  async previewRule(tenantId: string, rule: JsonLogicRule): Promise<RulePreview> {
    const whereClause = groupRuleToDrizzleSql(rule) ?? sql`true`;

    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      // Read from `*_live` views (soft-delete-hiding) but alias them back to
      // the base table names so the column references emitted by
      // `groupRuleToDrizzleSql` (DIMENSION_TO_COLUMN — e.g., "student_profiles"."gender")
      // resolve, including "tenant_user_profiles" (the institute's copy of the demographics).
      const rows = await tx.execute(
        sql`SELECT student_profiles.membership_id, student_profiles.admission_number,
                   tenant_user_profiles.first_name, tenant_user_profiles.last_name
            FROM student_profiles_live AS student_profiles
            INNER JOIN tenant_user_profiles_live AS tenant_user_profiles ON tenant_user_profiles.user_id = student_profiles.user_id AND tenant_user_profiles.tenant_id = student_profiles.tenant_id
            LEFT JOIN student_academics_live AS student_academics ON student_academics.student_profile_id = student_profiles.id
            LEFT JOIN sections_live AS sections ON sections.id = student_academics.section_id
            WHERE ${whereClause}
            LIMIT 10`,
      );

      const countRows = await tx.execute(
        sql`SELECT COUNT(*)::int AS total FROM student_profiles_live AS student_profiles
            INNER JOIN tenant_user_profiles_live AS tenant_user_profiles ON tenant_user_profiles.user_id = student_profiles.user_id AND tenant_user_profiles.tenant_id = student_profiles.tenant_id
            LEFT JOIN student_academics_live AS student_academics ON student_academics.student_profile_id = student_profiles.id
            LEFT JOIN sections_live AS sections ON sections.id = student_academics.section_id
            WHERE ${whereClause}`,
      );

      const sample = rows.rows as {
        membership_id: string;
        admission_number: string;
        first_name: I18nContent;
        last_name: I18nContent | null;
      }[];
      return {
        count: (countRows.rows[0] as { total: number }).total,
        sampleMembershipIds: sample.map((r) => r.membership_id),
        sampleMembers: sample.map((r) => ({
          membershipId: r.membership_id,
          firstName: r.first_name,
          lastName: r.last_name,
          admissionNumber: r.admission_number,
        })),
      };
    });
  }

  async listMemberRows(tenantId: string, groupId: string): Promise<GroupMemberListRow[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
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
    });
  }

  async findMembershipUsers(
    tenantId: string,
    membershipIds: string[],
  ): Promise<MembershipUserRow[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: membershipsLive.id, userId: membershipsLive.userId })
        .from(membershipsLive)
        .where(inArray(membershipsLive.id, membershipIds));
    });
  }

  async findUserNames(tenantId: string, userIds: string[]): Promise<UserNameRow[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: usersLive.id, username: usersLive.username, email: usersLive.email })
        .from(usersLive)
        .where(inArray(usersLive.id, userIds));
    });
  }

  async setMemberExcluded(
    tenantId: string,
    groupId: string,
    memberId: string,
    excluded: boolean,
    actorId: string,
  ): Promise<GroupMemberRow | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .update(groupMembers)
        .set({ isExcluded: excluded, updatedBy: actorId })
        .where(and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)))
        .returning();
    });
    return rows[0] ?? null;
  }

  async refreshMemberCount(
    tenantId: string,
    groupId: string,
    resolvedAt: Date,
    actorId: string,
  ): Promise<number> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [{ total }] = await tx
        .select({ total: count() })
        .from(groupMembersLive)
        .where(and(eq(groupMembersLive.groupId, groupId), eq(groupMembersLive.isExcluded, false)));

      await tx
        .update(groups)
        .set({ memberCount: total, resolvedAt, updatedBy: actorId })
        .where(eq(groups.id, groupId));

      return total;
    });
  }
}
