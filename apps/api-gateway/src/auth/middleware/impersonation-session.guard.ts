import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { AuthUser } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, impersonationSessions, withAdmin } from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';

const SESSION_CACHE_TTL = 60; // 60 second cache

@Injectable()
export class ImpersonationSessionGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const user = ctx.getContext().req.user as AuthUser | undefined;

    if (!user?.isImpersonated || !user.impersonationSessionId) {
      return true; // Not an impersonation request
    }

    const sessionId = user.impersonationSessionId;
    const cacheKey = `impersonation-session:${sessionId}`;

    // Check Redis cache
    let sessionData = await this.redis.get(cacheKey);

    if (!sessionData) {
      // Cache miss — query DB
      const [session] = await withAdmin(this.db, (tx) =>
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
        throw new UnauthorizedException({
          code: 'IMPERSONATION_ENDED',
          message: 'Impersonation session not found',
        });
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
      throw new UnauthorizedException({
        code: 'IMPERSONATION_ENDED',
        message: 'Impersonation session ended',
      });
    }

    if (new Date(parsed.expiresAt) < new Date()) {
      throw new UnauthorizedException({
        code: 'IMPERSONATION_ENDED',
        message: 'Impersonation session expired',
      });
    }

    return true;
  }
}
