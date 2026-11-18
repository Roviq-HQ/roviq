import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessException, ErrorCode, ResellerStatus, ResellerTier } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  impersonationSessions,
  institutes,
  institutesLive,
  mkAdminCtx,
  provisionResellerSystemRoles,
  type ResellerSystemRoleName,
  resellerMemberships,
  resellerMembershipsLive,
  resellers,
  roles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { REDIS_CLIENT } from '@roviq/redis';
import { and, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AuthEventService } from '../../auth/auth-event.service';
import { IdentityService } from '../../auth/identity.service';
import { invalidateImpersonationSessions } from '../../auth/impersonation-session-cache';
import { blockResellerAccess, clearResellerAccess } from '../../auth/reseller-access-cache';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { AdminCreateResellerInput } from './dto/admin-create-reseller.input';
import type { AdminListResellersFilterInput } from './dto/admin-list-resellers-filter.input';
import type { AdminUpdateResellerInput } from './dto/admin-update-reseller.input';

/** Default "Roviq Direct" system reseller UUID — hardcoded seed ID */
const DEFAULT_RESELLER_ID = '00000000-0000-7000-a000-000000000011';

/** Minimum days a reseller must be suspended before deletion */
const GRACE_PERIOD_DAYS = 30;

/**
 * Role name per tier. Each reseller owns its own copy of these roles, created
 * in `create`. The initial admin receives the copy matching the chosen tier;
 * `changeTier` moves every reseller_membership to the new tier's copy.
 */
const TIER_TO_ROLE_NAME: Record<ResellerTier, ResellerSystemRoleName> = {
  FULL_MANAGEMENT: 'reseller_full_admin',
  SUPPORT_MANAGEMENT: 'reseller_support_admin',
  READ_ONLY: 'reseller_viewer',
};

function buildListConditions(filter: AdminListResellersFilterInput): SQL[] {
  const { search, status, tier, isSystem, after } = filter;
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
    const cursor = decodeCursor(after);
    if (cursor.id) conditions.push(sql`${resellers.id} < ${cursor.id as string}`);
  }
  return conditions;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class AdminResellerService {
  private readonly logger = new Logger(AdminResellerService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly authEventService: AuthEventService,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
  ) {}

  // ── Read queries ────────────────────────────────────────────

  /**
   * List resellers for the platform-admin management UI.
   * Cursor-paginated, newest-first (ORDER BY created_at DESC, id DESC).
   * Batch-loads `instituteCount` (non-deleted) and `teamSize` (total memberships)
   * for the returned page — single extra query instead of N+1.
   */
  async list(filter: AdminListResellersFilterInput) {
    const limit = Math.min(filter.first ?? 20, 100);
    const after = filter.after;

    const { records, totalCount } = await withAdmin(
      this.db,
      mkAdminCtx('service:admin-reseller'),
      async (tx) => {
        const conditions = buildListConditions(filter);
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [totalResult, rows] = await Promise.all([
          tx.select({ value: count() }).from(resellers).where(where), // allow-base-read: admin list includes trashed (audit/restore)
          tx
            .select()
            .from(resellers) // allow-base-read: admin list includes trashed (audit/restore)
            .where(where)
            .orderBy(desc(resellers.createdAt), desc(resellers.id))
            .limit(limit + 1),
        ]);
        return { records: rows, totalCount: totalResult[0]?.value ?? 0 };
      },
    );

    const hasNextPage = records.length > limit;
    const nodes = hasNextPage ? records.slice(0, limit) : records;

    const { instituteCount, teamSize } = await this.loadCounts(nodes.map((r) => r.id));

    const edges = nodes.map((record) => ({
      node: {
        ...record,
        branding: (record.branding ?? null) as Record<string, unknown> | null,
        instituteCount: instituteCount.get(record.id) ?? 0,
        teamSize: teamSize.get(record.id) ?? 0,
      },
      cursor: encodeCursor({ id: record.id }),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount,
    };
  }

  /** Read a single reseller by id with computed counts. 404 if not found. */
  async getById(resellerId: string) {
    const record = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [row] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin getById intentionally includes trashed
      return row;
    });
    if (!record) {
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, `Reseller ${resellerId} not found`);
    }
    const { instituteCount, teamSize } = await this.loadCounts([resellerId]);
    return {
      ...record,
      branding: (record.branding ?? null) as Record<string, unknown> | null,
      instituteCount: instituteCount.get(resellerId) ?? 0,
      teamSize: teamSize.get(resellerId) ?? 0,
    };
  }

  // ── Mutations ───────────────────────────────────────────────

  /**
   * Create a new reseller + initial admin user + matching reseller_membership.
   * Slug is auto-generated from `name` when absent. Returns the created reseller.
   */
  async create(input: AdminCreateResellerInput, actorId: string) {
    const slug = (input.slug ?? slugify(input.name)).trim();
    if (!slug) {
      throw new BusinessException(
        ErrorCode.INVALID_SLUG,
        'Unable to derive slug from name; provide a slug explicitly',
      );
    }

    const { reseller, roleId } = await withAdmin(
      this.db,
      mkAdminCtx('service:admin-reseller'),
      async (tx) => {
        const [conflict] = await tx.select().from(resellers).where(eq(resellers.slug, slug)); // allow-base-read: slug uniqueness must include trashed (DB unique constraint covers all)
        if (conflict) {
          throw new BusinessException(
            ErrorCode.SLUG_DUPLICATE,
            `Slug "${slug}" is already taken by another reseller`,
          );
        }

        const [created] = await tx
          .insert(resellers)
          .values({
            createdBy: actorId,
            updatedBy: actorId,
            name: input.name,
            slug,
            tier: input.tier,
            status: ResellerStatus.ACTIVE,
            isActive: true,
            isSystem: false,
            branding: input.branding ?? {},
            customDomain: input.customDomain ?? null,
          })
          .returning();

        const roleIds = await provisionResellerSystemRoles(tx, created.id, actorId);
        return { reseller: created, roleId: roleIds[TIER_TO_ROLE_NAME[input.tier]] };
      },
    );

    // Provision the initial admin user + membership outside the admin tx —
    // IdentityService manages its own transactions across scopes and emits the
    // NOTIFICATION.user.created event so the welcome email/SMS fires via Novu.
    try {
      await this.identityService.createUserWithMembership({
        email: input.initialAdminEmail,
        username: input.initialAdminEmail,
        scope: 'reseller',
        resellerId: reseller.id,
        roleId,
        actorId,
      });
    } catch (err) {
      this.logger.warn(
        `Reseller ${reseller.id} created but initial admin provisioning failed: ${String(err)}`,
      );
      // Don't rollback the reseller — admin can re-invite. Event still emits below.
    }

    const resellerWithCounts = this.attachEmptyCounts(reseller);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.created, {
      ...resellerWithCounts,
      scope: 'platform',
    });

    return resellerWithCounts;
  }

  /** Update editable reseller fields (name, branding, customDomain). Tier + slug not editable here. */
  async update(resellerId: string, input: AdminUpdateResellerInput, actorId: string) {
    const record = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [existing] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin update may target trashed (TODO: validate)
      if (!existing) {
        throw new BusinessException(
          ErrorCode.RESELLER_NOT_FOUND,
          `Reseller ${resellerId} not found`,
        );
      }
      if (existing.isSystem) {
        throw new BusinessException(
          ErrorCode.SYSTEM_RESELLER_PROTECTED,
          'The system reseller "Roviq Direct" cannot be modified',
        );
      }
      if (existing.status === ResellerStatus.DELETED) {
        throw new BusinessException(ErrorCode.RESELLER_INVALID, 'Cannot update a deleted reseller');
      }

      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.branding !== undefined) patch.branding = input.branding;
      if (input.customDomain !== undefined) patch.customDomain = input.customDomain;
      patch.updatedBy = actorId;

      const [updated] = await tx
        .update(resellers)
        .set(patch)
        .where(eq(resellers.id, resellerId))
        .returning();
      return updated;
    });

    this.eventBus.emit(EVENT_PATTERNS.RESELLER.updated, { ...record, actorId, scope: 'platform' });
    return this.attachEmptyCounts(record);
  }

  /**
   * Change a reseller's tier. Cascades to every existing reseller_membership:
   * role_id is updated to the tier's system role so staff abilities change on
   * next token refresh.
   */
  async changeTier(resellerId: string, newTier: ResellerTier, actorId: string) {
    if (!Object.values(ResellerTier).includes(newTier)) {
      throw new BusinessException(ErrorCode.INVALID_TIER, `Unknown reseller tier: ${newTier}`);
    }

    const { record, oldTier } = await withAdmin(
      this.db,
      mkAdminCtx('service:admin-reseller'),
      async (tx) => {
        const [existing] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin tier change may target trashed (TODO: validate)
        if (!existing) {
          throw new BusinessException(
            ErrorCode.RESELLER_NOT_FOUND,
            `Reseller ${resellerId} not found`,
          );
        }
        if (existing.isSystem) {
          throw new BusinessException(
            ErrorCode.SYSTEM_RESELLER_PROTECTED,
            'The system reseller "Roviq Direct" cannot have its tier changed',
          );
        }
        if (existing.status !== ResellerStatus.ACTIVE) {
          throw new BusinessException(
            ErrorCode.TIER_CHANGE_REQUIRES_ACTIVE,
            'Tier can only be changed while the reseller is active — unsuspend first',
          );
        }
        if (existing.tier === newTier) return { record: existing, oldTier: existing.tier };

        // Also covers resellers created before each reseller owned its roles
        const roleIds = await provisionResellerSystemRoles(tx, resellerId, actorId);

        const [updated] = await tx
          .update(resellers)
          .set({ tier: newTier, updatedBy: actorId })
          .where(eq(resellers.id, resellerId))
          .returning();

        await tx
          .update(resellerMemberships)
          .set({ roleId: roleIds[TIER_TO_ROLE_NAME[newTier]], updatedBy: actorId })
          .where(eq(resellerMemberships.resellerId, resellerId));

        return { record: updated, oldTier: existing.tier };
      },
    );

    // No-op: tier unchanged — no DB write, no event, return as-is.
    if (oldTier === newTier) return this.attachEmptyCounts(record);

    this.eventBus.emit(EVENT_PATTERNS.RESELLER.tier_changed, {
      ...record,
      oldTier,
      newTier,
      actorId,
      scope: 'platform',
    });

    return this.attachEmptyCounts(record);
  }

  // ── Existing lifecycle mutations (preserved from ROV-97) ────

  async suspendReseller(resellerId: string, actorId: string, reason?: string): Promise<void> {
    const { record, previousStatus, staffUserIds, endedSessionIds } = await withAdmin(
      this.db,
      mkAdminCtx('service:admin-reseller'),
      async (tx) => {
        const [reseller] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: a deleted reseller must answer RESELLER_INVALID, not NOT_FOUND
        if (!reseller)
          throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
        if (reseller.isSystem)
          throw new BusinessException(
            ErrorCode.SYSTEM_RESELLER_PROTECTED,
            'Cannot suspend system reseller',
          );
        if (reseller.status === ResellerStatus.SUSPENDED) {
          throw new BusinessException(
            ErrorCode.RESELLER_ALREADY_SUSPENDED,
            'Reseller is already suspended',
          );
        }
        if (reseller.status === ResellerStatus.DELETED) {
          throw new BusinessException(
            ErrorCode.RESELLER_INVALID,
            'Cannot suspend a deleted reseller',
          );
        }

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

        return { record: updated, previousStatus: reseller.status, staffUserIds, endedSessionIds };
      },
    );

    // After the commit, so a rolled-back suspension locks nobody out.
    await Promise.all([
      blockResellerAccess(this.redis, resellerId),
      invalidateImpersonationSessions(this.redis, endedSessionIds),
    ]);

    for (const sessionId of endedSessionIds) {
      this.authEventService
        .emit({
          userId: actorId,
          type: 'impersonation_end',
          scope: 'platform',
          metadata: { session_id: sessionId, ended_reason: 'revoked' },
        })
        .catch(() => {});
    }
    for (const userId of staffUserIds) {
      this.authEventService
        .emit({
          userId,
          type: 'all_sessions_revoked',
          metadata: { reason: 'reseller_suspended', resellerId, suspensionReason: reason },
        })
        .catch(() => {});
    }

    this.eventBus.emit(EVENT_PATTERNS.RESELLER.status_changed, {
      ...record,
      previousStatus,
      newStatus: ResellerStatus.SUSPENDED,
      reason,
      scope: 'platform',
    });
  }

  async unsuspendReseller(resellerId: string, actorId: string): Promise<void> {
    const record = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [reseller] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: admin unsuspend may target trashed (TODO: validate)
      if (!reseller)
        throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
      if (reseller.isSystem) {
        throw new BusinessException(
          ErrorCode.SYSTEM_RESELLER_PROTECTED,
          'System reseller cannot be suspended or unsuspended',
        );
      }
      if (reseller.status === ResellerStatus.DELETED) {
        throw new BusinessException(
          ErrorCode.RESELLER_INVALID,
          'Cannot unsuspend a deleted reseller',
        );
      }
      if (reseller.status !== ResellerStatus.SUSPENDED) {
        throw new BusinessException(ErrorCode.RESELLER_NOT_SUSPENDED, 'Reseller is not suspended');
      }

      const [updated] = await tx
        .update(resellers)
        .set({
          status: ResellerStatus.ACTIVE,
          suspendedAt: null,
          isActive: true,
          updatedBy: actorId,
        })
        .where(eq(resellers.id, resellerId))
        .returning();
      return updated;
    });

    await clearResellerAccess(this.redis, resellerId);

    this.eventBus.emit(EVENT_PATTERNS.RESELLER.status_changed, {
      ...record,
      previousStatus: ResellerStatus.SUSPENDED,
      newStatus: ResellerStatus.ACTIVE,
      scope: 'platform',
    });
  }

  async deleteReseller(resellerId: string, actorId: string): Promise<void> {
    const { record, affectedInstituteIds } = await withAdmin(
      this.db,
      mkAdminCtx('service:admin-reseller'),
      async (tx) => {
        // 1. Verify reseller exists and is eligible for deletion
        const [reseller] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: deleteReseller checks for prior soft-delete (must see trashed)
        if (!reseller)
          throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
        if (reseller.isSystem)
          throw new BusinessException(
            ErrorCode.SYSTEM_RESELLER_PROTECTED,
            'Cannot delete system reseller',
          );
        if (reseller.status !== ResellerStatus.SUSPENDED) {
          throw new BusinessException(
            ErrorCode.RESELLER_NOT_SUSPENDED,
            'Reseller must be suspended before deletion',
          );
        }

        // 2. Enforce 30-day grace period
        if (!reseller.suspendedAt) {
          throw new BusinessException(ErrorCode.RESELLER_INVALID, 'Suspension date not set');
        }
        const daysSinceSuspension = Math.floor(
          (Date.now() - reseller.suspendedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysSinceSuspension < GRACE_PERIOD_DAYS) {
          throw new BusinessException(
            ErrorCode.GRACE_PERIOD_NOT_ELAPSED,
            `Grace period not elapsed (${GRACE_PERIOD_DAYS} days required, ${daysSinceSuspension} elapsed)`,
          );
        }

        // 3. Capture affected institutes before reassignment
        const affectedInstitutes = await tx
          .select({ id: institutesLive.id })
          .from(institutesLive)
          .where(eq(institutesLive.resellerId, resellerId));

        // 4. Reassign institutes to "Roviq Direct" system reseller
        await tx
          .update(institutes)
          .set({ resellerId: DEFAULT_RESELLER_ID, updatedBy: actorId })
          .where(eq(institutes.resellerId, resellerId));

        const deletedAt = new Date();

        // 5. Soft-delete reseller memberships
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

        // 6. Soft-delete reseller
        const [updated] = await tx
          .update(resellers)
          .set({
            status: ResellerStatus.DELETED,
            deletedAt,
            deletedBy: actorId,
            updatedBy: actorId,
          })
          .where(eq(resellers.id, resellerId))
          .returning();

        return { record: updated, affectedInstituteIds: affectedInstitutes.map((i) => i.id) };
      },
    );

    this.eventBus.emit(EVENT_PATTERNS.RESELLER.status_changed, {
      ...record,
      previousStatus: ResellerStatus.SUSPENDED,
      newStatus: ResellerStatus.DELETED,
      affectedInstituteIds,
      scope: 'platform',
    });
  }

  // ── Internal helpers ────────────────────────────────────────

  /**
   * Load `instituteCount` + `teamSize` for a set of resellers in two grouped
   * queries. Uses its own `withAdmin` call — counts are read-only so running
   * outside the caller's transaction is fine and keeps helper typing simple.
   */
  private async loadCounts(
    resellerIds: string[],
  ): Promise<{ instituteCount: Map<string, number>; teamSize: Map<string, number> }> {
    const instituteCount = new Map<string, number>();
    const teamSize = new Map<string, number>();
    if (resellerIds.length === 0) return { instituteCount, teamSize };

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

  /**
   * Returned shape for single-reseller mutations (create/update/changeTier).
   * Counts default to 0 — callers usually refetch via getById on next frontend
   * query, so avoiding a second roundtrip here keeps mutations snappy.
   */
  private attachEmptyCounts(record: typeof resellers.$inferSelect) {
    return {
      ...record,
      branding: (record.branding ?? null) as Record<string, unknown> | null,
      instituteCount: 0,
      teamSize: 0,
    };
  }
}
