import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  isResellerSystemRoleName,
  RESELLER_TIER_ROLE,
  ResellerStatus,
  ResellerTier,
  resellerRoleAfterTierChange,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { AuthEventService } from '../../auth/auth-event.service';
import { IdentityService } from '../../auth/identity.service';
import { invalidateImpersonationSessions } from '../../auth/impersonation-session-cache';
import {
  blockResellerAccess,
  clearResellerAccess,
  requireResellerMemberRole,
} from '../../auth/reseller-access-cache';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { AdminCreateResellerInput } from './dto/admin-create-reseller.input';
import type { AdminListResellersFilterInput } from './dto/admin-list-resellers-filter.input';
import type { AdminUpdateResellerInput } from './dto/admin-update-reseller.input';
import { AdminResellerRepository } from './repositories/admin-reseller.repository';
import type {
  MemberRoleMove,
  ResellerCounts,
  ResellerPatch,
  ResellerRecord,
} from './repositories/types';

/** Default "Roviq Direct" system reseller UUID — hardcoded seed ID */
const DEFAULT_RESELLER_ID = '00000000-0000-7000-a000-000000000011';

/** Minimum days a reseller must be suspended before deletion */
const GRACE_PERIOD_DAYS = 30;

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type ResellerRow = ResellerRecord;

function toModel(record: ResellerRow, instituteCount: number, teamSize: number) {
  return {
    ...record,
    branding: (record.branding ?? null) as Record<string, unknown> | null,
    instituteCount,
    teamSize,
  };
}

/** Theme and stylesheet are edited by the reseller (ROV-186); the platform form does not carry them. */
function withResellerOwnedBranding(
  stored: ResellerRow['branding'],
  incoming: NonNullable<AdminUpdateResellerInput['branding']>,
): NonNullable<ResellerRow['branding']> {
  const { theme, customCss } = stored ?? {};
  return { ...(theme ? { theme } : {}), ...(customCss ? { customCss } : {}), ...incoming };
}

@Injectable()
export class AdminResellerService {
  constructor(
    private readonly repo: AdminResellerRepository,
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

    const { records, totalCount } = await this.repo.list({
      status: filter.status,
      tier: filter.tier,
      isSystem: filter.isSystem,
      search: filter.search,
      after: after ? parseListCursor(after) : undefined,
      limit: limit + 1,
    });

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
    const record = await this.repo.findById(resellerId);
    if (!record) {
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, `Reseller ${resellerId} not found`);
    }
    return this.withCounts(record);
  }

  /** Staff of one reseller with their role and last sign-in, newest member first. */
  async listTeam(resellerId: string) {
    const team = await this.repo.listTeam(resellerId);
    if (!team) {
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, `Reseller ${resellerId} not found`);
    }
    return team;
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

    const { reseller, roleIds } = await this.repo.create({
      name: input.name,
      slug,
      tier: input.tier,
      branding: input.branding ?? {},
      customDomain: input.customDomain ?? null,
      actorId,
    });
    const roleId = roleIds[RESELLER_TIER_ROLE[input.tier]];

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
    const { version, ...fields } = input;
    const result = await this.repo.update(resellerId, version, actorId, (existing) => {
      if (existing.isSystem) {
        throw new BusinessException(
          ErrorCode.SYSTEM_RESELLER_PROTECTED,
          'The system reseller "Roviq Direct" cannot be modified',
        );
      }
      if (existing.status === ResellerStatus.DELETED) {
        throw new BusinessException(ErrorCode.RESELLER_INVALID, 'Cannot update a deleted reseller');
      }

      const patch: ResellerPatch = {};
      // A nullable GraphQL field may arrive as null; name and contact are NOT NULL columns.
      if (fields.name) patch.name = fields.name;
      if (fields.branding) {
        patch.branding = withResellerOwnedBranding(existing.branding, fields.branding);
      }
      if (fields.customDomain !== undefined) patch.customDomain = fields.customDomain;
      if (fields.registrationNumber !== undefined)
        patch.registrationNumber = fields.registrationNumber;
      if (fields.registrationState !== undefined)
        patch.registrationState = fields.registrationState;
      if (fields.contact) patch.contact = fields.contact;
      if (fields.address !== undefined) patch.address = fields.address;
      return patch;
    });
    if (result.kind === 'not_found') {
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, `Reseller ${resellerId} not found`);
    }
    if (result.kind === 'conflict') {
      throw new BusinessException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Reseller was modified by someone else. Refresh and try again.',
      );
    }
    const record = result.record;

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

    const result = await this.repo.changeTier(resellerId, newTier, actorId, {
      decide: (existing) => {
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
        return existing.tier === newTier ? 'skip' : 'apply';
      },
      planMoves: (existing, members, roleIds) => {
        const moved: MemberRoleMove[] = [];
        for (const member of members) {
          // A role outside the ladder is treated as the old tier's top role and follows the tier.
          const current = isResellerSystemRoleName(member.roleName)
            ? member.roleName
            : RESELLER_TIER_ROLE[existing.tier];
          const roleId = roleIds[resellerRoleAfterTierChange(current, existing.tier, newTier)];
          if (roleId !== member.roleId) moved.push({ id: member.id, roleId });
        }
        return moved;
      },
    });
    if (result.kind === 'not_found') {
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, `Reseller ${resellerId} not found`);
    }
    const { record, oldTier, moved } = result;

    const model = await this.withCounts(record);
    // Tier unchanged: nothing was written, so nothing to announce.
    if (oldTier === newTier) return model;

    // Tokens issued under the old role stop working now, not when they expire.
    await Promise.all(
      moved.map((member) => requireResellerMemberRole(this.redis, member.id, member.roleId)),
    );

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
    const result = await this.repo.suspend(resellerId, actorId, (reseller) => {
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
    });
    if (result.kind === 'not_found')
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
    const { record, previousStatus, staffUserIds, endedSessionIds } = result;

    // After the commit, so a rolled-back suspension locks nobody out.
    await Promise.all([
      blockResellerAccess(this.redis, resellerId),
      invalidateImpersonationSessions(this.redis, endedSessionIds),
    ]);

    for (const sessionId of endedSessionIds) {
      this.authEventService
        .emit({
          userId: actorId,
          type: 'IMPERSONATION_END',
          scope: 'platform',
          metadata: { session_id: sessionId, ended_reason: 'revoked' },
        })
        .catch(() => {});
    }
    for (const userId of staffUserIds) {
      this.authEventService
        .emit({
          userId,
          type: 'ALL_SESSIONS_REVOKED',
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
    const result = await this.repo.unsuspend(resellerId, actorId, (reseller) => {
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
    });
    if (result.kind === 'not_found')
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
    const record = result.record;

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
    const result = await this.repo.delete(resellerId, actorId, DEFAULT_RESELLER_ID, (reseller) => {
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

      // Enforce 30-day grace period
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
    });
    if (result.kind === 'not_found')
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
    const { record, affectedInstituteIds } = result;

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

  /** `instituteCount` + `teamSize` for a page of resellers in two grouped queries (no N+1). */
  private async loadCounts(resellerIds: string[]): Promise<ResellerCounts> {
    if (resellerIds.length === 0) return { instituteCount: new Map(), teamSize: new Map() };
    return this.repo.counts(resellerIds);
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
    const resolved = await this.identityService.findOrCreateUserByEmail(email, actorId);
    if (resolved.kind === 'unavailable') {
      throw new BusinessException(
        ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE,
        // The reason stays on the server: it describes an account that is not the caller's.
        'Initial admin email cannot be used',
      );
    }
    return {
      userId: resolved.userId,
      tempPassword: resolved.kind === 'created' ? resolved.tempPassword : null,
    };
  }

  private async assertSlugFree(slug: string): Promise<void> {
    if (await this.repo.slugTaken(slug)) {
      throw new BusinessException(
        ErrorCode.SLUG_DUPLICATE,
        `Slug "${slug}" is already taken by another reseller`,
      );
    }
  }
}
