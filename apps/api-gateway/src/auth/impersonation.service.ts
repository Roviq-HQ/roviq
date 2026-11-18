import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AbilityFactory } from '@roviq/casl';
import type { AuthScope, AuthUser, InstituteContext, ResellerContext } from '@roviq/common-types';
import {
  BusinessException,
  canImpersonateInstituteRole,
  DefaultRoles,
  ErrorCode,
} from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  type I18nContent,
  impersonationSessions,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  phoneNumbersLive,
  platformMembershipsLive,
  resellerMembershipsLive,
  rolesLive,
  userProfilesLive,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import type { AuthSecurityEvent } from '@roviq/notifications';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { REDIS_CLIENT } from '@roviq/redis';
import { and, asc, desc, eq, gt, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type Redis from 'ioredis';
import { AuthEventService } from './auth-event.service';
import type { ImpersonationAuthPayload } from './dto/impersonation.dto';
import {
  type ImpersonationSessionModel,
  ImpersonationSessionStatus,
} from './dto/impersonation-session.model';
import { invalidateImpersonationSessions } from './impersonation-session-cache';
import { REDIS_KEYS } from './redis-keys';

// ── Constants ──────────────────────────────────────────────

/** One-time code TTL in seconds */
const CODE_TTL_SECONDS = 30;

/** Impersonation access token TTL in seconds (15 minutes) */
const IMPERSONATION_ACCESS_TTL_SECONDS = 900;

/** Maximum session duration in milliseconds (1 hour) */
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000;

/** Minimum reason length (enforced by DB CHECK, validated here for better errors) */
const MIN_REASON_LENGTH = 10;

// ── Types ──────────────────────────────────────────────────

interface ImpersonationMeta {
  ip?: string;
  userAgent?: string;
}

interface CodePayload {
  sessionId: string;
  targetUserId: string;
  /** The membership the start checks authorized; the token is issued for exactly this one. */
  targetMembershipId: string;
  tenantId: string;
}

/** An impersonation request waiting for the institute admin's OTP. No session row exists yet. */
interface PendingOtp {
  otp: string;
  impersonatorId: string;
  impersonatorScope: AuthScope;
  targetUserId: string;
  targetMembershipId: string;
  tenantId: string;
  reason: string;
  ip: string | null;
  userAgent: string | null;
  /** Institute admin the OTP was sent to; recorded as `otp_verified_by`. */
  verifierUserId: string;
}

interface RoleInfo {
  name: string;
  abilities: readonly { action: unknown; subject: unknown }[];
}

interface StartImpersonationResult {
  code?: string;
  requiresOtp?: boolean;
  sessionId?: string;
}

/** OTP TTL — 5 minutes */
const OTP_TTL_SECONDS = 300;

/** Maximum OTP verification attempts before key invalidation */
const MAX_OTP_ATTEMPTS = 3;

/** Derives session lifecycle status: ended (manual/revoked) → expired (past TTL) → active. */
function deriveSessionStatus(
  endedAt: Date | null,
  endedReason: string | null,
  expiresAt: Date,
  now: number,
): ImpersonationSessionStatus {
  // The expiry sweep closes the row too; it must still read as EXPIRED.
  if (endedAt && endedReason !== 'expired') return ImpersonationSessionStatus.ENDED;
  if (expiresAt.getTime() <= now) return ImpersonationSessionStatus.EXPIRED;
  return ImpersonationSessionStatus.ACTIVE;
}

function otpMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly authEventService: AuthEventService,
    private readonly abilityFactory: AbilityFactory,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Start impersonation ──────────────────────────────────

  async startImpersonation(
    actor: AuthUser,
    targetUserId: string,
    targetTenantId: string,
    reason: string,
    meta?: ImpersonationMeta,
  ): Promise<StartImpersonationResult> {
    this.assertNotImpersonated(actor);

    if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `Reason must be at least ${MIN_REASON_LENGTH} characters`,
      );
    }

    if (actor.userId === targetUserId) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_TARGET_INVALID,
        'Cannot impersonate yourself',
      );
    }

    const targetUser = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ id: usersLive.id, status: usersLive.status })
        .from(usersLive)
        .where(eq(usersLive.id, targetUserId))
        .limit(1),
    );

    if (targetUser.length === 0 || targetUser[0].status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_TARGET_INVALID,
        'Target user not found or inactive',
      );
    }

    // Every active membership the target holds here: the rank check must see
    // the most senior one, and the session is pinned to the oldest.
    const targetMemberships = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          roleName: sql<string>`${rolesLive.name}->>'en'`,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.userId, targetUserId),
            eq(membershipsLive.tenantId, targetTenantId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(membershipsLive.createdAt), asc(membershipsLive.id)),
    );
    const targetMembership = targetMemberships[0];

    if (!targetMembership) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_TARGET_INVALID,
        'Target user has no active membership in the specified institute',
      );
    }

    const [targetInstitute] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: institutesLive.id,
          resellerId: institutesLive.resellerId,
          requireImpersonationConsent: institutesLive.requireImpersonationConsent,
        })
        .from(institutesLive)
        .where(eq(institutesLive.id, targetTenantId))
        .limit(1),
    );

    if (!targetInstitute) {
      throw new BusinessException(ErrorCode.INSTITUTE_NOT_FOUND, 'Target institute not found');
    }

    if (actor.scope === 'reseller') {
      if (targetInstitute.resellerId !== actor.resellerId) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          'Institute does not belong to your reseller',
        );
      }
      await this.assertActiveResellerMembership(actor);
    }

    if (actor.scope === 'institute') {
      await this.validateIntraInstituteImpersonation(
        actor,
        targetTenantId,
        targetMemberships.map((membership) => ({
          name: membership.roleName,
          abilities: membership.roleAbilities,
        })),
      );
    }

    // Reseller: always needs the institute admin's OTP. Platform: only when the
    // institute opted in. Intra-institute: never.
    const otpRequired =
      actor.scope === 'reseller' ||
      (actor.scope === 'platform' && targetInstitute.requireImpersonationConsent);

    const request = {
      impersonatorId: actor.userId,
      impersonatorScope: actor.scope,
      targetUserId,
      targetMembershipId: targetMembership.id,
      tenantId: targetTenantId,
      reason: reason.trim(),
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    };

    if (otpRequired) {
      // The session row is written only once the OTP is verified, so an
      // abandoned request never shows up as an active session.
      const requestId = await this.dispatchImpersonationOtp(request);
      return { sessionId: requestId, requiresOtp: true };
    }

    const sessionId = await this.createSession(request, null);
    const code = await this.issueImpersonationCode({
      sessionId,
      targetUserId,
      targetMembershipId: targetMembership.id,
      tenantId: targetTenantId,
    });

    return { code };
  }

  // ── Verify OTP and issue exchange code ───────────────────

  async verifyOtp(
    actor: AuthUser,
    requestId: string,
    otp: string,
  ): Promise<StartImpersonationResult> {
    this.assertNotImpersonated(actor);

    const key = `${REDIS_KEYS.IMPERSONATION_OTP}${requestId}`;
    const attemptsKey = `${key}:attempts`;

    const stored = await this.redis.get(key);
    if (!stored) {
      throw new BusinessException(ErrorCode.IMPERSONATION_OTP_EXPIRED, 'OTP expired or not found');
    }
    const pending = JSON.parse(stored) as PendingOtp;

    // Only the user who asked may complete the request, and a stranger's
    // guesses must not burn the requester's attempts.
    if (pending.impersonatorId !== actor.userId) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_OTP_INVALID,
        'OTP verification not authorized for this request',
      );
    }

    // Reserve the attempt BEFORE comparing (INCR is atomic), so parallel
    // guesses cannot all be checked against one remaining attempt.
    const attempts = await this.redis.incr(attemptsKey);
    await this.redis.expire(attemptsKey, OTP_TTL_SECONDS);
    if (attempts > MAX_OTP_ATTEMPTS) {
      await this.redis.del(key, attemptsKey);
      throw new BusinessException(
        ErrorCode.IMPERSONATION_OTP_ATTEMPTS_EXCEEDED,
        'OTP invalid — maximum attempts exceeded',
      );
    }

    if (!otpMatches(pending.otp, otp)) {
      if (attempts >= MAX_OTP_ATTEMPTS) {
        await this.redis.del(key, attemptsKey);
        throw new BusinessException(
          ErrorCode.IMPERSONATION_OTP_ATTEMPTS_EXCEEDED,
          'OTP invalid — maximum attempts exceeded',
        );
      }
      throw new BusinessException(ErrorCode.IMPERSONATION_OTP_INVALID, 'OTP invalid');
    }

    // GETDEL: two requests carrying the right OTP cannot both open a session.
    const consumed = await this.redis.getdel(key);
    if (!consumed) {
      throw new BusinessException(ErrorCode.IMPERSONATION_OTP_EXPIRED, 'OTP expired or not found');
    }
    await this.redis.del(attemptsKey);

    // Minutes may have passed since the request was started.
    await this.assertStillAuthorized(actor, pending);

    const sessionId = await this.createSession(pending, pending.verifierUserId);
    const code = await this.issueImpersonationCode({
      sessionId,
      targetUserId: pending.targetUserId,
      targetMembershipId: pending.targetMembershipId,
      tenantId: pending.tenantId,
    });

    return { code };
  }

  // ── Exchange one-time code ───────────────────────────────

  async exchangeCode(code: string, meta: ImpersonationMeta): Promise<ImpersonationAuthPayload> {
    // Atomic read-and-delete (GETDEL, Redis 6.2+) — prevents TOCTOU race on concurrent exchanges
    const stored = await this.redis.getdel(`${REDIS_KEYS.IMPERSONATION_CODE}${code}`);
    if (!stored) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_CODE_EXPIRED,
        'Impersonation code expired or already used',
      );
    }

    const { sessionId, targetUserId, targetMembershipId, tenantId } = JSON.parse(
      stored,
    ) as CodePayload;

    // Fetch all required data in parallel within a single transaction
    const [targetUsers, membershipRows, sessions, instituteRows] = await withAdmin(
      this.db,
      mkAdminCtx('service:impersonation'),
      (tx) =>
        Promise.all([
          tx
            .select({
              id: usersLive.id,
              username: usersLive.username,
              firstName: userProfilesLive.firstName,
              lastName: userProfilesLive.lastName,
            })
            .from(usersLive)
            .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
            .where(and(eq(usersLive.id, targetUserId), eq(usersLive.status, 'ACTIVE')))
            .limit(1),
          tx
            .select({
              id: membershipsLive.id,
              tenantId: membershipsLive.tenantId,
              roleId: membershipsLive.roleId,
            })
            .from(membershipsLive)
            .where(
              and(
                // Exactly the membership that was authorized at start.
                eq(membershipsLive.id, targetMembershipId),
                eq(membershipsLive.userId, targetUserId),
                eq(membershipsLive.tenantId, tenantId),
                eq(membershipsLive.status, 'ACTIVE'),
              ),
            )
            .limit(1),
          tx
            .select({
              id: impersonationSessions.id,
              impersonatorId: impersonationSessions.impersonatorId,
              impersonatorScope: impersonationSessions.impersonatorScope,
              endedAt: impersonationSessions.endedAt,
              expiresAt: impersonationSessions.expiresAt,
            })
            .from(impersonationSessions)
            .where(eq(impersonationSessions.id, sessionId))
            .limit(1),
          tx
            .select({
              id: institutesLive.id,
              name: institutesLive.name,
              resellerId: institutesLive.resellerId,
            })
            .from(institutesLive)
            .where(eq(institutesLive.id, tenantId))
            .limit(1),
        ]),
    );

    const targetUser = targetUsers[0];
    if (!targetUser)
      throw new BusinessException(ErrorCode.ACCOUNT_INACTIVE, 'Target user no longer active');

    const membership = membershipRows[0];
    if (!membership)
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_MEMBERSHIP,
        'Target user no longer has an active membership',
      );

    const session = sessions[0];
    if (!session)
      throw new BusinessException(
        ErrorCode.IMPERSONATION_SESSION_INVALID,
        'Impersonation session not found',
      );
    // Ended or revoked between start and exchange: no token at all.
    if (session.endedAt || session.expiresAt.getTime() <= Date.now())
      throw new BusinessException(
        ErrorCode.IMPERSONATION_SESSION_INVALID,
        'Impersonation session has ended',
      );

    const institute = instituteRows[0];
    if (!institute)
      throw new BusinessException(ErrorCode.INSTITUTE_NOT_FOUND, 'Institute not found');

    // Generate impersonation access token (non-renewable, no refresh token)
    const accessToken = this.generateImpersonationToken({
      targetUserId,
      tenantId,
      resellerId: institute.resellerId,
      membershipId: membership.id,
      roleId: membership.roleId,
      impersonatorId: session.impersonatorId,
      sessionId,
    });

    // Emit impersonation_start event
    this.authEventService
      .emit({
        userId: session.impersonatorId,
        type: 'impersonation_start',
        scope: session.impersonatorScope as AuthScope,
        tenantId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          target_user_id: targetUserId,
          target_tenant_id: tenantId,
          session_id: sessionId,
        },
      })
      .catch(() => {});

    return {
      accessToken,
      user: {
        id: targetUser.id,
        username: targetUser.username,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
      },
      institute: {
        id: institute.id,
        name: institute.name,
      },
    };
  }

  // ── End impersonation ────────────────────────────────────

  /**
   * Ends a session. The impersonator and the impersonated user end it
   * themselves (`manual`); anyone else with authority over it revokes it
   * (`revoked`) — see {@link resolveEndReason}.
   */
  async endImpersonation(
    sessionId: string,
    actor: AuthUser,
    meta: ImpersonationMeta,
  ): Promise<void> {
    const [session] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: impersonationSessions.id,
          impersonatorId: impersonationSessions.impersonatorId,
          impersonatorScope: impersonationSessions.impersonatorScope,
          targetUserId: impersonationSessions.targetUserId,
          targetTenantId: impersonationSessions.targetTenantId,
          endedAt: impersonationSessions.endedAt,
        })
        .from(impersonationSessions)
        .where(eq(impersonationSessions.id, sessionId))
        .limit(1),
    );

    if (!session) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_SESSION_INVALID,
        'Impersonation session not found',
      );
    }

    if (session.endedAt) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_SESSION_INVALID,
        'Impersonation session already ended',
      );
    }

    const endedReason = await this.resolveEndReason(session, actor);

    await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .update(impersonationSessions)
        .set({
          endedAt: new Date(),
          endedReason,
        })
        .where(and(eq(impersonationSessions.id, sessionId), isNull(impersonationSessions.endedAt))),
    );

    await invalidateImpersonationSessions(this.redis, [sessionId]);

    // Emit impersonation_end event
    this.authEventService
      .emit({
        userId: actor.userId,
        type: 'impersonation_end',
        scope: actor.scope,
        tenantId: session.targetTenantId ?? undefined,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { session_id: sessionId, ended_reason: endedReason },
      })
      .catch(() => {});
  }

  // ── Expire overdue sessions ──────────────────────────────

  /**
   * Closes sessions that ran past `expires_at` and records `impersonation_end`
   * for each. The UPDATE claims rows atomically, so concurrent gateway
   * replicas never record the same session twice.
   */
  async expireOverdueSessions(): Promise<number> {
    const expired = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .update(impersonationSessions)
        .set({ endedAt: impersonationSessions.expiresAt, endedReason: 'expired' })
        .where(
          and(
            isNull(impersonationSessions.endedAt),
            lte(impersonationSessions.expiresAt, sql`now()`),
          ),
        )
        .returning({
          id: impersonationSessions.id,
          impersonatorId: impersonationSessions.impersonatorId,
          impersonatorScope: impersonationSessions.impersonatorScope,
          targetTenantId: impersonationSessions.targetTenantId,
        }),
    );

    for (const session of expired) {
      this.authEventService
        .emit({
          userId: session.impersonatorId,
          type: 'impersonation_end',
          scope: session.impersonatorScope as AuthScope,
          tenantId: session.targetTenantId ?? undefined,
          metadata: { session_id: session.id, ended_reason: 'expired' },
        })
        .catch(() => {});
    }
    return expired.length;
  }

  // ── List impersonation sessions ──────────────────────────

  /**
   * Lists impersonation sessions with resolved display names, newest first. When `resellerId`
   * is set, results are scoped to sessions started by that reseller's team — RLS on
   * impersonation_sessions does not narrow by reseller, so the scoping is enforced here.
   */
  async listSessions(opts: {
    resellerId?: string;
    sessionId?: string;
    activeOnly?: boolean;
    limit: number;
  }): Promise<ImpersonationSessionModel[]> {
    return withAdmin(this.db, mkAdminCtx('service:impersonation-list'), async (tx) => {
      const conditions: SQL[] = [];

      if (opts.resellerId) {
        const staff = await tx
          .select({ userId: resellerMembershipsLive.userId })
          .from(resellerMembershipsLive)
          .where(eq(resellerMembershipsLive.resellerId, opts.resellerId));
        const staffIds = staff.map((s) => s.userId);
        if (staffIds.length === 0) return [];
        conditions.push(inArray(impersonationSessions.impersonatorId, staffIds));
      }
      if (opts.sessionId) conditions.push(eq(impersonationSessions.id, opts.sessionId));
      if (opts.activeOnly) {
        // Active means neither ended nor past its expiry, matching `status`.
        conditions.push(isNull(impersonationSessions.endedAt));
        conditions.push(gt(impersonationSessions.expiresAt, new Date()));
      }

      const impersonator = alias(usersLive, 'impersonator');
      const target = alias(usersLive, 'target_user');
      const verifier = alias(usersLive, 'otp_verifier');

      const rows = await tx
        .select({
          id: impersonationSessions.id,
          impersonatorId: impersonationSessions.impersonatorId,
          impersonatorScope: impersonationSessions.impersonatorScope,
          impersonatorName: impersonator.username,
          targetUserId: impersonationSessions.targetUserId,
          targetUserName: target.username,
          targetTenantId: impersonationSessions.targetTenantId,
          targetTenantName: institutesLive.name,
          reason: impersonationSessions.reason,
          ipAddress: impersonationSessions.ipAddress,
          userAgent: impersonationSessions.userAgent,
          startedAt: impersonationSessions.startedAt,
          expiresAt: impersonationSessions.expiresAt,
          endedAt: impersonationSessions.endedAt,
          endedReason: impersonationSessions.endedReason,
          otpVerified: impersonationSessions.otpVerified,
          otpVerifiedByName: verifier.username,
        })
        .from(impersonationSessions)
        .leftJoin(impersonator, eq(impersonator.id, impersonationSessions.impersonatorId))
        .leftJoin(target, eq(target.id, impersonationSessions.targetUserId))
        .leftJoin(verifier, eq(verifier.id, impersonationSessions.otpVerifiedBy))
        .leftJoin(institutesLive, eq(institutesLive.id, impersonationSessions.targetTenantId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(impersonationSessions.startedAt))
        .limit(opts.limit);

      // Resolve each impersonator's role name from the membership table matching
      // their scope (platform/reseller/institute). Batched per scope so the cost
      // is at most three extra queries regardless of how many sessions returned.
      const roleByScope = await this.resolveImpersonatorRoles(tx, rows);

      const now = Date.now();
      return rows.map((row) => ({
        ...row,
        targetTenantName: row.targetTenantName ?? null,
        impersonatorRole: roleByScope(
          row.impersonatorScope,
          row.impersonatorId,
          row.targetTenantId,
        ),
        status: deriveSessionStatus(row.endedAt, row.endedReason, row.expiresAt, now),
      }));
    });
  }

  /**
   * Batch-resolves impersonator role names for a set of session rows. The role lives in a
   * different membership table per scope: platform → platform_memberships, reseller →
   * reseller_memberships, institute → memberships (scoped to the session's target tenant).
   * Returns a lookup `(scope, userId, tenantId) => role name | null`.
   */
  private async resolveImpersonatorRoles(
    tx: DrizzleDB,
    rows: { impersonatorScope: string; impersonatorId: string; targetTenantId: string | null }[],
  ): Promise<(scope: string, userId: string, tenantId: string | null) => I18nContent | null> {
    const idsFor = (scope: string) => [
      ...new Set(rows.filter((r) => r.impersonatorScope === scope).map((r) => r.impersonatorId)),
    ];
    const platformIds = idsFor('platform');
    const resellerIds = idsFor('reseller');
    const institutePairs = rows.filter(
      (r) => r.impersonatorScope === 'institute' && r.targetTenantId,
    );

    const platformRoles = new Map<string, I18nContent>();
    const resellerRoles = new Map<string, I18nContent>();
    const instituteRoles = new Map<string, I18nContent>(); // key: `${userId}:${tenantId}`

    if (platformIds.length) {
      const found = await tx
        .select({ userId: platformMembershipsLive.userId, roleName: rolesLive.name })
        .from(platformMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, platformMembershipsLive.roleId))
        .where(inArray(platformMembershipsLive.userId, platformIds));
      for (const r of found) platformRoles.set(r.userId, r.roleName);
    }

    if (resellerIds.length) {
      const found = await tx
        .select({ userId: resellerMembershipsLive.userId, roleName: rolesLive.name })
        .from(resellerMembershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, resellerMembershipsLive.roleId))
        .where(
          and(
            inArray(resellerMembershipsLive.userId, resellerIds),
            eq(resellerMembershipsLive.isActive, true),
          ),
        );
      // First active reseller membership wins — display only.
      for (const r of found)
        if (!resellerRoles.has(r.userId)) resellerRoles.set(r.userId, r.roleName);
    }

    if (institutePairs.length) {
      const userIds = [...new Set(institutePairs.map((p) => p.impersonatorId))];
      const tenantIds = [...new Set(institutePairs.map((p) => p.targetTenantId as string))];
      const found = await tx
        .select({
          userId: membershipsLive.userId,
          tenantId: membershipsLive.tenantId,
          roleName: rolesLive.name,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            inArray(membershipsLive.userId, userIds),
            inArray(membershipsLive.tenantId, tenantIds),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        );
      for (const r of found) instituteRoles.set(`${r.userId}:${r.tenantId}`, r.roleName);
    }

    return (scope, userId, tenantId) => {
      if (scope === 'platform') return platformRoles.get(userId) ?? null;
      if (scope === 'reseller') return resellerRoles.get(userId) ?? null;
      if (scope === 'institute' && tenantId)
        return instituteRoles.get(`${userId}:${tenantId}`) ?? null;
      return null;
    };
  }

  // ── Private: authorization helpers ───────────────────────

  /** An impersonation token acts for someone else; it must not open or approve sessions. */
  private assertNotImpersonated(actor: AuthUser): void {
    if (actor.isImpersonated) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Cannot start impersonation from an impersonation session',
      );
    }
  }

  /** Re-runs the scope checks of the start step for the caller completing an OTP request. */
  private async assertStillAuthorized(actor: AuthUser, pending: PendingOtp): Promise<void> {
    if (actor.scope !== pending.impersonatorScope) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'OTP verification not authorized for this request',
      );
    }
    if (actor.scope !== 'reseller') return;

    await this.assertActiveResellerMembership(actor);
    const [institute] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ resellerId: institutesLive.resellerId })
        .from(institutesLive)
        .where(eq(institutesLive.id, pending.tenantId))
        .limit(1),
    );
    if (institute?.resellerId !== actor.resellerId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Institute does not belong to your reseller',
      );
    }
  }

  /** The token can be minutes old; the reseller membership must still be active now. */
  private async assertActiveResellerMembership(actor: ResellerContext): Promise<void> {
    const [membership] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ id: resellerMembershipsLive.id })
        .from(resellerMembershipsLive)
        .where(
          and(
            eq(resellerMembershipsLive.id, actor.membershipId),
            eq(resellerMembershipsLive.userId, actor.userId),
            eq(resellerMembershipsLive.resellerId, actor.resellerId),
            eq(resellerMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );
    if (!membership) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'No active reseller membership');
    }
  }

  private async validateIntraInstituteImpersonation(
    actor: InstituteContext,
    tenantId: string,
    targetRoles: RoleInfo[],
  ): Promise<void> {
    if (actor.tenantId !== tenantId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'No active membership in this institute');
    }

    const [actorMembership] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          roleId: membershipsLive.roleId,
          roleName: sql<string>`${rolesLive.name}->>'en'`,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.id, actor.membershipId),
            eq(membershipsLive.userId, actor.userId),
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .limit(1),
    );

    if (!actorMembership) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'No active membership in this institute');
    }

    const ability = await this.abilityFactory.createForUser({
      userId: actor.userId,
      scope: 'institute',
      tenantId,
      membershipId: actorMembership.id,
      roleId: actorMembership.roleId,
    });

    if (!ability.can('impersonate', 'User')) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'You do not have permission to impersonate users',
      );
    }

    const actorRole = { name: actorMembership.roleName, abilities: actorMembership.roleAbilities };
    if (!targetRoles.every((targetRole) => canImpersonateInstituteRole(actorRole, targetRole))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'You are not allowed to impersonate a user with this role',
      );
    }
  }

  /**
   * `manual` for the two parties of the session. `revoked` for someone with
   * authority over it who holds `impersonate User`: any platform user, a
   * reseller user for sessions started by their own team, an institute user
   * for sessions into their own institute. Everyone else is refused.
   */
  private async resolveEndReason(
    session: {
      impersonatorId: string;
      impersonatorScope: string;
      targetUserId: string;
      targetTenantId: string | null;
    },
    actor: AuthUser,
  ): Promise<'manual' | 'revoked'> {
    if (actor.userId === session.impersonatorId || actor.userId === session.targetUserId) {
      return 'manual';
    }

    const denied = new BusinessException(
      ErrorCode.FORBIDDEN,
      'Not authorized to end this impersonation session',
    );
    // An impersonation token may end only its own session, handled above.
    if (actor.isImpersonated) throw denied;

    const ability = await this.abilityFactory.createForUser(actor);
    if (!ability.can('impersonate', 'User')) throw denied;

    if (actor.scope === 'platform') return 'revoked';

    if (actor.scope === 'institute') {
      if (session.targetTenantId !== actor.tenantId) throw denied;
      return 'revoked';
    }

    if (session.impersonatorScope !== 'reseller') throw denied;
    const [teammate] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({ id: resellerMembershipsLive.id })
        .from(resellerMembershipsLive)
        .where(
          and(
            eq(resellerMembershipsLive.userId, session.impersonatorId),
            eq(resellerMembershipsLive.resellerId, actor.resellerId),
            eq(resellerMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );
    if (!teammate) throw denied;
    return 'revoked';
  }

  // ── Private: session row ─────────────────────────────────

  private async createSession(
    request: Omit<PendingOtp, 'otp' | 'verifierUserId'>,
    otpVerifiedBy: string | null,
  ): Promise<string> {
    const now = new Date();
    const [session] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .insert(impersonationSessions)
        .values({
          impersonatorId: request.impersonatorId,
          impersonatorScope: request.impersonatorScope,
          targetUserId: request.targetUserId,
          targetTenantId: request.tenantId,
          reason: request.reason,
          ipAddress: request.ip,
          userAgent: request.userAgent,
          startedAt: now,
          expiresAt: new Date(now.getTime() + MAX_SESSION_DURATION_MS),
          otpVerified: otpVerifiedBy ? now : null,
          otpVerifiedBy,
        })
        .returning({ id: impersonationSessions.id }),
    );
    return session.id;
  }

  // ── Private: issue exchange code ─────────────────────────

  private async issueImpersonationCode(payload: CodePayload): Promise<string> {
    const code = randomUUID();
    await this.redis.set(
      `${REDIS_KEYS.IMPERSONATION_CODE}${code}`,
      JSON.stringify(payload),
      'EX',
      CODE_TTL_SECONDS,
    );
    return code;
  }

  // ── Private: dispatch impersonation OTP ──────────────────

  /** Sends the OTP to the institute admin and parks the request in Redis. Returns the request id. */
  private async dispatchImpersonationOtp(
    request: Omit<PendingOtp, 'otp' | 'verifierUserId'>,
  ): Promise<string> {
    // Resolve the admin and their phone BEFORE writing to Redis: without a
    // phone the OTP cannot be delivered and the caller would wait forever.
    const [adminRow] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          userId: membershipsLive.userId,
        })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.tenantId, request.tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
            sql`${rolesLive.name}->>'en' = ${DefaultRoles.InstituteAdmin}`,
          ),
        )
        // Longest-standing admin, so the recipient is the same on every request.
        .orderBy(asc(membershipsLive.createdAt), asc(membershipsLive.id))
        .limit(1),
    );

    if (!adminRow) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_CONSENT_UNAVAILABLE,
        'Cannot request impersonation consent — institute has no active institute_admin',
      );
    }

    const [phoneRow] = await withAdmin(this.db, mkAdminCtx('service:impersonation'), (tx) =>
      tx
        .select({
          countryCode: phoneNumbersLive.countryCode,
          number: phoneNumbersLive.number,
        })
        .from(phoneNumbersLive)
        .where(
          and(eq(phoneNumbersLive.userId, adminRow.userId), eq(phoneNumbersLive.isPrimary, true)),
        )
        .limit(1),
    );

    if (!phoneRow) {
      throw new BusinessException(
        ErrorCode.IMPERSONATION_CONSENT_UNAVAILABLE,
        'Cannot request impersonation consent — institute admin has no contact phone on file',
      );
    }

    const recipientPhone = `${phoneRow.countryCode}${phoneRow.number}`;
    const requestId = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');

    const pending: PendingOtp = { ...request, otp, verifierUserId: adminRow.userId };
    await this.redis.set(
      `${REDIS_KEYS.IMPERSONATION_OTP}${requestId}`,
      JSON.stringify(pending),
      'EX',
      OTP_TTL_SECONDS,
    );

    const event: AuthSecurityEvent = {
      tenantId: request.tenantId,
      userId: adminRow.userId,
      eventType: 'IMPERSONATION_OTP',
      metadata: {
        otp,
        recipientPhone,
        purpose: 'impersonation_consent',
        impersonator_id: request.impersonatorId,
        target_user_id: request.targetUserId,
        session_id: requestId,
      },
    };
    this.eventBus.emit(NOTIFICATION_SUBJECTS.AUTH_SECURITY, event);
    return requestId;
  }

  // ── Private: generate impersonation token ────────────────

  private generateImpersonationToken(opts: {
    targetUserId: string;
    tenantId: string;
    resellerId: string;
    membershipId: string;
    roleId: string;
    impersonatorId: string;
    sessionId: string;
  }): string {
    return this.jwtService.sign(
      {
        sub: opts.targetUserId,
        scope: 'institute',
        tenantId: opts.tenantId,
        // Same claim a normal institute token carries; billing reads it.
        resellerId: opts.resellerId,
        membershipId: opts.membershipId,
        roleId: opts.roleId,
        isImpersonated: true,
        impersonatorId: opts.impersonatorId,
        impersonationSessionId: opts.sessionId,
        type: 'access',
      },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: IMPERSONATION_ACCESS_TTL_SECONDS,
      },
    );
  }
}
