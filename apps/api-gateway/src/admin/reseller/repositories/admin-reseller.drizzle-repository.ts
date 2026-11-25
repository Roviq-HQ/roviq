import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  ResellerStatus,
  type ResellerTier,
} from '@roviq/common-types';
import {
  authEvents,
  DRIZZLE_DB,
  type DrizzleDB,
  impersonationSessions,
  institutes,
  institutesLive,
  mapUniqueViolation,
  mkAdminCtx,
  provisionResellerSystemRoles,
  resellerMemberships,
  resellerMembershipsLive,
  resellers,
  roles,
  rolesLive,
  type UniqueViolationErrors,
  userProfilesLive,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { AdminResellerRepository } from './admin-reseller.repository';
import type {
  AdminResellerListQuery,
  AdminResellerTeamMemberRow,
  CreateResellerData,
  ResellerCounts,
  ResellerDeleteResult,
  ResellerPatch,
  ResellerRecord,
  ResellerSuspendResult,
  ResellerSystemRoleIds,
  ResellerTierChangeResult,
  ResellerTierChangeRules,
  ResellerUnsuspendResult,
  ResellerUpdateResult,
} from './types';

/** Activity events that count as the user being active — same set as the admin user list. */
const ACTIVITY_EVENT_TYPES = ['LOGIN_SUCCESS', 'TOKEN_REFRESH', 'INSTITUTE_SWITCH'];

function buildListConditions(query: AdminResellerListQuery): SQL[] {
  const { search, status, tier, isSystem, after } = query;
  const conditions: SQL[] = [];

  if (status && status.length > 0) conditions.push(inArray(resellers.status, status));
  if (tier && tier.length > 0) conditions.push(inArray(resellers.tier, tier));
  if (typeof isSystem === 'boolean') conditions.push(eq(resellers.isSystem, isSystem));
  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim()}%`;
    const cond = or(ilike(resellers.name, pattern), ilike(resellers.slug, pattern));
    if (cond) conditions.push(cond);
  }
  if (after) {
    conditions.push(
      sql`(${resellers.createdAt}, ${resellers.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
    );
  }
  return conditions;
}

// The service checks the slug first; only a second create running at once gets here.
const SLUG_TAKEN: UniqueViolationErrors = {
  resellers_slug_key: () =>
    new BusinessException(
      ErrorCode.SLUG_DUPLICATE,
      'This slug is already taken by another reseller',
    ),
};

@Injectable()
export class AdminResellerDrizzleRepository extends AdminResellerRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async list(
    query: AdminResellerListQuery,
  ): Promise<{ records: ResellerRecord[]; totalCount: number }> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const conditions = buildListConditions(query);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalResult, rows] = await Promise.all([
        tx.select({ value: count() }).from(resellers).where(where), // allow-base-read: admin list includes trashed (audit/restore)
        tx
          .select()
          .from(resellers) // allow-base-read: admin list includes trashed (audit/restore)
          .where(where)
          .orderBy(desc(resellers.createdAt), desc(resellers.id))
          .limit(query.limit),
      ]);
      return { records: rows, totalCount: totalResult[0]?.value ?? 0 };
    });
  }

  async findById(resellerId: string): Promise<ResellerRecord | null> {
    const record = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [row] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin getById intentionally includes trashed
      return row;
    });
    return record ?? null;
  }

  async listTeam(resellerId: string): Promise<AdminResellerTeamMemberRow[] | null> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [exists] = await tx
        .select({ id: resellers.id })
        .from(resellers) // allow-base-read: a deleted reseller's team page must answer, not 404
        .where(eq(resellers.id, resellerId));
      if (!exists) return null;
      return tx
        .select({
          id: resellerMembershipsLive.id,
          userId: usersLive.id,
          username: usersLive.username,
          email: usersLive.email,
          firstName: userProfilesLive.firstName,
          lastName: userProfilesLive.lastName,
          roleName: rolesLive.name,
          isActive: resellerMembershipsLive.isActive,
          joinedAt: resellerMembershipsLive.createdAt,
          lastActiveAt: sql<Date | null>`(
            SELECT max(ae.created_at) FROM auth_events ae
            WHERE ae.user_id = ${usersLive.id}
            AND ae.event_type IN (${sql.join(
              ACTIVITY_EVENT_TYPES.map((t) => sql`${t}`),
              sql`, `,
            )})
          )`.mapWith(authEvents.createdAt),
        })
        .from(resellerMembershipsLive)
        .innerJoin(usersLive, eq(usersLive.id, resellerMembershipsLive.userId))
        .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
        .leftJoin(rolesLive, eq(rolesLive.id, resellerMembershipsLive.roleId))
        .where(eq(resellerMembershipsLive.resellerId, resellerId))
        .orderBy(desc(resellerMembershipsLive.createdAt), asc(usersLive.username));
    });
  }

  async slugTaken(slug: string): Promise<boolean> {
    const [conflict] = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), (tx) =>
      tx
        .select({ id: resellers.id })
        .from(resellers) // allow-base-read: slug stays globally unique after deletion
        .where(eq(resellers.slug, slug)),
    );
    return Boolean(conflict);
  }

  async create(
    data: CreateResellerData,
  ): Promise<{ reseller: ResellerRecord; roleIds: ResellerSystemRoleIds }> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [created] = await tx
        .insert(resellers)
        .values({
          createdBy: data.actorId,
          updatedBy: data.actorId,
          name: data.name,
          slug: data.slug,
          tier: data.tier,
          status: ResellerStatus.ACTIVE,
          isActive: true,
          isSystem: false,
          branding: data.branding,
          customDomain: data.customDomain,
        })
        .returning();

      const roleIds = await provisionResellerSystemRoles(tx, created.id, data.actorId);
      return { reseller: created, roleIds };
    }).catch(mapUniqueViolation(SLUG_TAKEN));
  }

  async update(
    resellerId: string,
    version: number,
    actorId: string,
    buildPatch: (existing: ResellerRecord) => ResellerPatch,
  ): Promise<ResellerUpdateResult> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [existing] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: a deleted reseller must answer RESELLER_INVALID, not NOT_FOUND
      if (!existing) return { kind: 'not_found' };

      const patch = buildPatch(existing);

      const [updated] = await tx
        .update(resellers)
        .set({ ...patch, updatedBy: actorId, version: sql`${resellers.version} + 1` })
        .where(and(eq(resellers.id, resellerId), eq(resellers.version, version)))
        .returning();
      if (!updated) return { kind: 'conflict' };
      return { kind: 'ok', record: updated };
    });
  }

  async changeTier(
    resellerId: string,
    newTier: ResellerTier,
    actorId: string,
    rules: ResellerTierChangeRules,
  ): Promise<ResellerTierChangeResult> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [existing] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin tier change may target trashed (TODO: validate)
      if (!existing) return { kind: 'not_found' };
      if (rules.decide(existing) === 'skip') {
        return { kind: 'ok', record: existing, oldTier: existing.tier, moved: [] };
      }

      // Also covers resellers created before each reseller owned its roles
      const roleIds = await provisionResellerSystemRoles(tx, resellerId, actorId);

      const [updated] = await tx
        .update(resellers)
        .set({ tier: newTier, updatedBy: actorId, version: sql`${resellers.version} + 1` })
        .where(eq(resellers.id, resellerId))
        .returning();

      const members = await tx
        .select({
          id: resellerMembershipsLive.id,
          roleId: resellerMembershipsLive.roleId,
          roleName: sql<string>`${rolesLive.name}->>'en'`,
        })
        .from(resellerMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, resellerMembershipsLive.roleId))
        .where(eq(resellerMembershipsLive.resellerId, resellerId));

      const moved = rules.planMoves(existing, members, roleIds);
      for (const member of moved) {
        await tx
          .update(resellerMemberships)
          .set({ roleId: member.roleId, updatedBy: actorId })
          .where(eq(resellerMemberships.id, member.id));
      }

      return { kind: 'ok', record: updated, oldTier: existing.tier, moved };
    });
  }

  async suspend(
    resellerId: string,
    actorId: string,
    check: (reseller: ResellerRecord) => void,
  ): Promise<ResellerSuspendResult> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [reseller] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: a deleted reseller must answer RESELLER_INVALID, not NOT_FOUND
      if (!reseller) return { kind: 'not_found' };
      check(reseller);

      const staff = await tx
        .select({ userId: resellerMembershipsLive.userId })
        .from(resellerMembershipsLive)
        .where(eq(resellerMembershipsLive.resellerId, resellerId));
      const staffUserIds = [...new Set(staff.map((s) => s.userId))];

      const [updated] = await tx
        .update(resellers)
        .set({
          status: ResellerStatus.SUSPENDED,
          suspendedAt: new Date(),
          isActive: false,
          updatedBy: actorId,
          version: sql`${resellers.version} + 1`,
        })
        .where(eq(resellers.id, resellerId))
        .returning();

      // The `resellers_revoke_sessions` trigger ended the staff's sessions inside that
      // UPDATE, stamping them with this transaction's now(). Read back exactly those, so a
      // session opened while the suspension ran still has its Redis cache dropped.
      const ended = await tx
        .select({ id: impersonationSessions.id })
        .from(impersonationSessions)
        .where(
          and(
            eq(impersonationSessions.impersonatorScope, 'reseller'),
            eq(impersonationSessions.endedReason, 'revoked'),
            eq(impersonationSessions.endedAt, sql`now()`),
            inArray(
              impersonationSessions.impersonatorId,
              tx
                .select({ userId: resellerMemberships.userId })
                .from(resellerMemberships) // allow-base-read: matches the trigger, which ends sessions of every membership row
                .where(eq(resellerMemberships.resellerId, resellerId)),
            ),
          ),
        );
      const endedSessionIds = ended.map((s) => s.id);

      return {
        kind: 'ok',
        record: updated,
        previousStatus: reseller.status,
        staffUserIds,
        endedSessionIds,
      };
    });
  }

  async unsuspend(
    resellerId: string,
    actorId: string,
    check: (reseller: ResellerRecord) => void,
  ): Promise<ResellerUnsuspendResult> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [reseller] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin unsuspend may target trashed (TODO: validate)
      if (!reseller) return { kind: 'not_found' };
      check(reseller);

      const [updated] = await tx
        .update(resellers)
        .set({
          status: ResellerStatus.ACTIVE,
          suspendedAt: null,
          isActive: true,
          updatedBy: actorId,
          version: sql`${resellers.version} + 1`,
        })
        .where(eq(resellers.id, resellerId))
        .returning();
      return { kind: 'ok', record: updated };
    });
  }

  async delete(
    resellerId: string,
    actorId: string,
    defaultResellerId: string,
    check: (reseller: ResellerRecord) => void,
  ): Promise<ResellerDeleteResult> {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [reseller] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: deleteReseller checks for prior soft-delete (must see trashed)
      if (!reseller) return { kind: 'not_found' };
      check(reseller);

      // Capture affected institutes before reassignment
      const affectedInstitutes = await tx
        .select({ id: institutesLive.id })
        .from(institutesLive)
        .where(eq(institutesLive.resellerId, resellerId));

      await tx
        .update(institutes)
        .set({ resellerId: defaultResellerId, updatedBy: actorId })
        .where(eq(institutes.resellerId, resellerId));

      const deletedAt = new Date();

      await tx
        .update(resellerMemberships)
        .set({ deletedAt, deletedBy: actorId, updatedBy: actorId })
        .where(
          and(
            eq(resellerMemberships.resellerId, resellerId),
            isNull(resellerMemberships.deletedAt),
          ),
        );

      await tx
        .update(roles)
        .set({ deletedAt, deletedBy: actorId, updatedBy: actorId })
        .where(
          and(
            eq(roles.resellerId, resellerId),
            eq(roles.scope, 'reseller'),
            isNull(roles.deletedAt),
          ),
        );

      const [updated] = await tx
        .update(resellers)
        .set({
          status: ResellerStatus.DELETED,
          deletedAt,
          deletedBy: actorId,
          updatedBy: actorId,
          version: sql`${resellers.version} + 1`,
        })
        .where(eq(resellers.id, resellerId))
        .returning();

      return {
        kind: 'ok',
        record: updated,
        affectedInstituteIds: affectedInstitutes.map((i) => i.id),
      };
    });
  }

  async counts(resellerIds: string[]): Promise<ResellerCounts> {
    const instituteCount = new Map<string, number>();
    const teamSize = new Map<string, number>();
    await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [instRows, teamRows] = await Promise.all([
        tx
          .select({ resellerId: institutesLive.resellerId, count: count(institutesLive.id) })
          .from(institutesLive)
          .where(inArray(institutesLive.resellerId, resellerIds))
          .groupBy(institutesLive.resellerId),
        tx
          .select({
            resellerId: resellerMembershipsLive.resellerId,
            count: count(resellerMembershipsLive.id),
          })
          .from(resellerMembershipsLive)
          .where(
            and(
              inArray(resellerMembershipsLive.resellerId, resellerIds),
              eq(resellerMembershipsLive.isActive, true),
            ),
          )
          .groupBy(resellerMembershipsLive.resellerId),
      ]);
      for (const row of instRows) instituteCount.set(row.resellerId, Number(row.count));
      for (const row of teamRows) teamSize.set(row.resellerId, Number(row.count));
    });
    return { instituteCount, teamSize };
  }
}
