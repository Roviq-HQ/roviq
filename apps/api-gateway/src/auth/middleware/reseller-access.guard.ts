import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessException, ErrorCode, ResellerStatus } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, mkAdminCtx, resellersLive, withAdmin } from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import {
  RESELLER_ACCESS,
  RESELLER_ACCESS_CACHE_TTL_SECONDS,
  resellerAccessKeys,
  resellerMemberAccessKey,
} from '../reseller-access-cache';
import { readRequestTokenClaims } from './request-token-claims';

/**
 * Rejects reseller-scope tokens whose reseller is suspended or deleted, and tokens of a
 * team member who was deactivated or moved to another role after the token was issued.
 *
 * SECURITY: revoking refresh tokens is not enough — an access token already issued stays
 * valid for its full lifetime, so without this guard suspended staff keep working for
 * minutes (ROV-97). Institute-scope tokens also carry a `resellerId` and must pass:
 * suspending a reseller does not lock its institutes out.
 */
@Injectable()
export class ResellerAccessGuard implements CanActivate {
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
    if (claims?.scope !== 'reseller' || !claims.resellerId) return true;

    const keys = resellerAccessKeys(claims.resellerId);
    const [blocked, cached, requiredRole] = await Promise.all([
      this.redis.get(keys.blocked),
      this.redis.get(keys.cache),
      claims.membershipId ? this.redis.get(resellerMemberAccessKey(claims.membershipId)) : null,
    ]);
    if (blocked) throw suspended();
    if (requiredRole && requiredRole !== claims.roleId) {
      throw new BusinessException(ErrorCode.UNAUTHENTICATED, 'Reseller membership has changed');
    }

    const access = cached ?? (await this.loadAndCache(claims.resellerId, keys.cache));
    if (access !== RESELLER_ACCESS.ALLOWED) throw suspended();
    return true;
  }

  private async loadAndCache(resellerId: string, cacheKey: string): Promise<string> {
    const [reseller] = await withAdmin(this.db, mkAdminCtx('service:reseller-access-guard'), (tx) =>
      tx
        .select({ status: resellersLive.status, isActive: resellersLive.isActive })
        .from(resellersLive)
        .where(eq(resellersLive.id, resellerId))
        .limit(1),
    );
    const access =
      reseller?.isActive && reseller.status === ResellerStatus.ACTIVE
        ? RESELLER_ACCESS.ALLOWED
        : RESELLER_ACCESS.BLOCKED;
    await this.redis.set(cacheKey, access, 'EX', RESELLER_ACCESS_CACHE_TTL_SECONDS);
    return access;
  }
}

function suspended(): BusinessException {
  return new BusinessException(ErrorCode.UNAUTHENTICATED, 'Reseller account is not active');
}
