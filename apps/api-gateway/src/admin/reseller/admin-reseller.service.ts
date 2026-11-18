import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, ResellerStatus, ResellerTier } from '@roviq/common-types';
import {
  authEvents,
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
  rolesLive,
  userProfilesLive,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { REDIS_CLIENT } from '@roviq/redis';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
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
    const { createdAt, id } = parseListCursor(after);
    conditions.push(
      sql`(${resellers.createdAt}, ${resellers.id}) < (${createdAt}::timestamptz, ${id}::uuid)`,
    );
  }
  return conditions;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The cursor must carry both sort keys: seeded resellers have ids out of created_at order.
function parseListCursor(after: string): { createdAt: string; id: string } {
  let cursor: Record<string, unknown>;
  try {
    cursor = decodeCursor(after);
  } catch {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  const { createdAt, id } = cursor;
  if (
    typeof createdAt !== 'string' ||
    Number.isNaN(Date.parse(createdAt)) ||
    typeof id !== 'string' ||
    !UUID_RE.test(id)
  ) {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  return { createdAt, id };
}

/** Activity events that count as the user being active — same set as the admin user list. */
const ACTIVITY_EVENT_TYPES = ['login_success', 'token_refresh', 'institute_switch'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type ResellerRow = typeof resellers.$inferSelect;

function toModel(record: ResellerRow, instituteCount: number, teamSize: number) {
  return {
    ...record,
    branding: (record.branding ?? null) as Record<string, unknown> | null,
    instituteCount,
    teamSize,
  };
}

@Injectable()
export class AdminResellerService {
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
      node: toModel(record, instituteCount.get(record.id) ?? 0, teamSize.get(record.id) ?? 0),
      cursor: encodeCursor({ createdAt: record.createdAt.toISOString(), id: record.id }),
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
    return this.withCounts(record);
  }

  /** Staff of one reseller with their role and last sign-in, newest member first. */
  async listTeam(resellerId: string) {
    return withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [exists] = await tx
        .select({ id: resellers.id })
        .from(resellers) // allow-base-read: a deleted reseller's team page must answer, not 404
        .where(eq(resellers.id, resellerId));
      if (!exists) {
        throw new BusinessException(
          ErrorCode.RESELLER_NOT_FOUND,
          `Reseller ${resellerId} not found`,
        );
      }
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
    await this.assertSlugFree(slug);

    // Resolve the admin before the reseller exists, so a failure leaves nothing half-made
    // and a retry with the same email links the user created by the failed attempt.
    const email = input.initialAdminEmail.trim().toLowerCase();
    const admin = await this.resolveInitialAdmin(email, actorId);

    const { reseller, roleId } = await withAdmin(
      this.db,
      mkAdminCtx('service:admin-reseller'),
      async (tx) => {
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

    await this.identityService.createMembership({
      userId: admin.userId,
      scope: 'reseller',
      resellerId: reseller.id,
      roleId,
      actorId,
    });

    // An existing user keeps their password, so only a new one gets the welcome.
    if (admin.tempPassword) {
      this.identityService.sendWelcomeNotification({
        userId: admin.userId,
        username: email,
        email,
        tempPassword: admin.tempPassword,
        scope: 'reseller',
        resellerId: reseller.id,
      });
    }

    const model = await this.withCounts(reseller);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.created, { ...model, scope: 'platform' });
    return model;
  }

  /** Update profile fields under optimistic concurrency. Tier and slug are not editable here. */
  async update(resellerId: string, input: AdminUpdateResellerInput, actorId: string) {
    const record = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), async (tx) => {
      const [existing] = await tx.select().from(resellers).where(eq(resellers.id, resellerId)); // allow-base-read: a deleted reseller must answer RESELLER_INVALID, not NOT_FOUND
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

      const { version, ...fields } = input;
      const patch: Partial<typeof resellers.$inferInsert> = {};
      if (fields.name !== undefined) patch.name = fields.name;
      if (fields.branding !== undefined) patch.branding = fields.branding;
      if (fields.customDomain !== undefined) patch.customDomain = fields.customDomain;
      if (fields.registrationNumber !== undefined)
        patch.registrationNumber = fields.registrationNumber;
      if (fields.registrationState !== undefined)
        patch.registrationState = fields.registrationState;
      if (fields.contact !== undefined) patch.contact = fields.contact;
      if (fields.address !== undefined) patch.address = fields.address;

      const [updated] = await tx
        .update(resellers)
        .set({ ...patch, updatedBy: actorId, version: sql`${resellers.version} + 1` })
        .where(and(eq(resellers.id, resellerId), eq(resellers.version, version)))
        .returning();
      if (!updated) {
        throw new BusinessException(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Reseller was modified by someone else. Refresh and try again.',
        );
      }
      return updated;
    });

    const model = await this.withCounts(record);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.updated, { ...model, actorId, scope: 'platform' });
    return model;
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
          .set({ tier: newTier, updatedBy: actorId, version: sql`${resellers.version} + 1` })
          .where(eq(resellers.id, resellerId))
          .returning();

        await tx
          .update(resellerMemberships)
          .set({ roleId: roleIds[TIER_TO_ROLE_NAME[newTier]], updatedBy: actorId })
          .where(eq(resellerMemberships.resellerId, resellerId));

        return { record: updated, oldTier: existing.tier };
      },
    );

    const model = await this.withCounts(record);
    // Tier unchanged: nothing was written, so nothing to announce.
    if (oldTier === newTier) return model;

    this.eventBus.emit(EVENT_PATTERNS.RESELLER.tier_changed, {
      ...model,
      oldTier,
      newTier,
      actorId,
      scope: 'platform',
    });
    return model;
  }

  // ── Existing lifecycle mutations (preserved from ROV-97) ────

  async suspendReseller(resellerId: string, actorId: string, reason?: string) {
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

    const model = await this.withCounts(record);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.status_changed, {
      ...model,
      previousStatus,
      newStatus: ResellerStatus.SUSPENDED,
      reason,
      scope: 'platform',
    });
    return model;
  }

  async unsuspendReseller(resellerId: string, actorId: string) {
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
          version: sql`${resellers.version} + 1`,
        })
        .where(eq(resellers.id, resellerId))
        .returning();
      return updated;
    });

    await clearResellerAccess(this.redis, resellerId);

    const model = await this.withCounts(record);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.status_changed, {
      ...model,
      previousStatus: ResellerStatus.SUSPENDED,
      newStatus: ResellerStatus.ACTIVE,
      scope: 'platform',
    });
    return model;
  }

  async deleteReseller(resellerId: string, actorId: string) {
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
            version: sql`${resellers.version} + 1`,
          })
          .where(eq(resellers.id, resellerId))
          .returning();

        return { record: updated, affectedInstituteIds: affectedInstitutes.map((i) => i.id) };
      },
    );

    const model = await this.withCounts(record);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.status_changed, {
      ...model,
      previousStatus: ResellerStatus.SUSPENDED,
      newStatus: ResellerStatus.DELETED,
      affectedInstituteIds,
      scope: 'platform',
    });
    return model;
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

  private async withCounts(record: ResellerRow) {
    const { instituteCount, teamSize } = await this.loadCounts([record.id]);
    return toModel(record, instituteCount.get(record.id) ?? 0, teamSize.get(record.id) ?? 0);
  }

  /**
   * Links only an account whose email matches; a Roviq ID that merely equals the address
   * could belong to someone else, so it blocks the email instead of being linked.
   */
  private async resolveInitialAdmin(
    email: string,
    actorId: string,
  ): Promise<{ userId: string; tempPassword: string | null }> {
    const matches = await this.identityService.findUsersByEmail(email);
    if (matches.length > 1) {
      throw new BusinessException(
        ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE,
        'More than one account uses this email',
      );
    }
    const [existing] = matches;
    if (existing?.isDeleted) {
      throw new BusinessException(
        ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE,
        'This email belongs to a deleted account and cannot be reused',
      );
    }
    if (existing) return { userId: existing.userId, tempPassword: null };
    if (await this.identityService.isUsernameTaken(email)) {
      throw new BusinessException(
        ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE,
        'This email is already used as the Roviq ID of another account',
      );
    }
    return this.identityService.createUser({ email, username: email, actorId });
  }

  private async assertSlugFree(slug: string): Promise<void> {
    const [conflict] = await withAdmin(this.db, mkAdminCtx('service:admin-reseller'), (tx) =>
      tx
        .select({ id: resellers.id })
        .from(resellers) // allow-base-read: slug stays globally unique after deletion
        .where(eq(resellers.slug, slug)),
    );
    if (conflict) {
      throw new BusinessException(
        ErrorCode.SLUG_DUPLICATE,
        `Slug "${slug}" is already taken by another reseller`,
      );
    }
  }
}
