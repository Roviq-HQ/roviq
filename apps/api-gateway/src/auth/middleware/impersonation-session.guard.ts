import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  impersonationSessions,
  mkAdminCtx,
  withAdmin,
} from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { tombstoneKey as tombstoneKeyOf } from '../impersonation-session-cache';
import { REDIS_KEYS } from '../redis-keys';
import { readRequestTokenClaims } from './request-token-claims';

const SESSION_CACHE_TTL = 60; // 60 second cache

interface ImpersonationTokenClaims {
  isImpersonated?: boolean;
  impersonationSessionId?: string;
}

/**
 * Global guard that short-circuits requests whose bearer token carries a
 * revoked or expired impersonation session claim.
 *
 * Dual auth source (HTTP + WS):
 *
 *   1. `req.user` — the authoritative source when present. Populated by
 *      passport-jwt for HTTP requests and by the graphql-ws `onConnect`
 *      → `context()` wrapper for subscriptions (see `app.module.ts`). WS
 *      connections have NO Authorization header, so prior versions of this
 *      guard that only decoded the header silently skipped the revocation
 *      check on every subscription — a security regression.
 *
 *   2. Bearer header fallback — HTTP requests run this guard at APP_GUARD
 *      scope, which fires BEFORE the per-resolver `GqlAuthGuard` populates
 *      `req.user`. When `req.user` is absent we self-verify the JWT so the
 *      HTTP path still catches revoked impersonation tokens during that
 *      narrow window. A missing/invalid header means "not an impersonation
 *      request from this guard's POV" — downstream `GqlAuthGuard` rejects
 *      unauthenticated requests properly.
 *
 * Tombstone check:
 *
 *   `endImpersonation` writes both a cache `del` AND a `${key}:tombstone`
 *   marker. We check the tombstone BEFORE the cache read so a concurrent
 *   guard mid-way through a cache-miss DB lookup can't write a stale
 *   "not-ended" entry that outlives the `del`. Tombstone TTL > session
 *   cache TTL so it cannot expire before the ghost it guards against.
 *
 * Only impersonation-flagged tokens enter the DB/Redis check; normal
 * requests fast-path out by detecting `isImpersonated !== true`.
 */
@Injectable()
export class ImpersonationSessionGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const claims = this.extractImpersonationClaims(context);
    if (!claims?.isImpersonated || !claims.impersonationSessionId) {
      return true; // Not an impersonation request — downstream GqlAuthGuard handles auth.
    }

    const sessionId = claims.impersonationSessionId;
    const cacheKey = `${REDIS_KEYS.IMPERSONATION_SESSION}${sessionId}`;
    const tombstoneKey = tombstoneKeyOf(sessionId);

    // Tombstone check — wins any race with a concurrent cache write.
    const tombstone = await this.redis.get(tombstoneKey);
    if (tombstone) {
      throw new BusinessException(ErrorCode.IMPERSONATION_ENDED, 'Impersonation session ended');
    }

    // Check Redis cache
    let sessionData = await this.redis.get(cacheKey);

    if (!sessionData) {
      // Cache miss — query DB
      const [session] = await withAdmin(
        this.db,
        mkAdminCtx('service:impersonation-session-guard'),
        (tx) =>
          tx
            .select({
              id: impersonationSessions.id,
              endedAt: impersonationSessions.endedAt,
              endedReason: impersonationSessions.endedReason,
              expiresAt: impersonationSessions.expiresAt,
            })
            .from(impersonationSessions)
            .where(eq(impersonationSessions.id, sessionId))
            .limit(1),
      );

      if (!session) {
        throw new BusinessException(
          ErrorCode.IMPERSONATION_ENDED,
          'Impersonation session not found',
        );
      }

      sessionData = JSON.stringify({
        endedAt: session.endedAt?.toISOString() ?? null,
        endedReason: session.endedReason,
        expiresAt: session.expiresAt.toISOString(),
      });

      // Cache for 60 seconds
      await this.redis.set(cacheKey, sessionData, 'EX', SESSION_CACHE_TTL);
    }

    const parsed = JSON.parse(sessionData);

    if (parsed.endedAt || parsed.endedReason === 'revoked') {
      throw new BusinessException(ErrorCode.IMPERSONATION_ENDED, 'Impersonation session ended');
    }

    if (new Date(parsed.expiresAt) < new Date()) {
      throw new BusinessException(ErrorCode.IMPERSONATION_ENDED, 'Impersonation session expired');
    }

    return true;
  }

  private extractImpersonationClaims(context: ExecutionContext): ImpersonationTokenClaims | null {
    const claims = readRequestTokenClaims(
      context,
      this.jwtService,
      this.config.getOrThrow<string>('JWT_SECRET'),
    );
    if (!claims?.isImpersonated || !claims.impersonationSessionId) return null;
    return claims;
  }
}
