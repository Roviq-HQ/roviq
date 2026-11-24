import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, mkAdminCtx, users, withAdmin } from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import { and, eq, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { TOKEN_VERSION_CACHE_TTL_SECONDS, tokenVersionKeys } from '../token-version-cache';
import { readRequestTokenClaims } from './request-token-claims';

/**
 * Rejects an access token issued before its user's sessions were ended.
 *
 * SECURITY: a password change revokes the refresh tokens, but an access token already issued
 * stays valid for its whole lifetime (up to 15 minutes), so whoever held the old password keeps
 * working. Each token carries the `token_version` it was issued with; a lower one than the
 * user's current version is refused. Impersonation tokens pass: they end with their session.
 */
@Injectable()
export class TokenVersionGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const claims = readRequestTokenClaims(
      context,
      this.jwtService,
      this.config.getOrThrow<string>('JWT_SECRET'),
    );
    if (!claims?.sub || claims.isImpersonated) return true;

    const keys = tokenVersionKeys(claims.sub);
    const [floor, cached] = await Promise.all([
      this.redis.get(keys.floor),
      this.redis.get(keys.cache),
    ]);
    const current = Math.max(
      Number(floor ?? 0),
      cached === null ? await this.loadAndCache(claims.sub, keys.cache) : Number(cached),
    );
    if ((claims.tv ?? 0) < current) {
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, 'Session ended');
    }
    return true;
  }

  private async loadAndCache(userId: string, cacheKey: string): Promise<number> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:token-version-guard'), (tx) =>
      tx
        .select({ tokenVersion: users.tokenVersion })
        .from(users) // allow-base-read: password_hash and token_version are not on users_live (ROV-279)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1),
    );
    // A token for a user that no longer exists is refused by the resolvers that load the user.
    const version = row?.tokenVersion ?? 0;
    await this.redis.set(cacheKey, String(version), 'EX', TOKEN_VERSION_CACHE_TTL_SECONDS);
    return version;
  }
}
