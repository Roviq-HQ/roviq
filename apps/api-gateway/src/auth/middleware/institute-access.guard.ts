import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, institutesLive, mkAdminCtx, withAdmin } from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import {
  INSTITUTE_ACCESS,
  INSTITUTE_ACCESS_CACHE_TTL_SECONDS,
  instituteAccessKeys,
  instituteAccessOf,
} from '../institute-access-cache';
import { readRequestTokenClaims } from './request-token-claims';

/**
 * Rejects institute-scope tokens whose institute is not ACTIVE (pending activation, inactive,
 * suspended, rejected or deleted).
 *
 * SECURITY (SF-042): login refuses such an institute, but an access token issued before a
 * suspension stays valid for its full lifetime; without this guard suspended users keep
 * working for minutes. Impersonation tokens pass: platform and reseller staff must be able
 * to look into an institute that is not active.
 */
@Injectable()
export class InstituteAccessGuard implements CanActivate {
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
    if (claims?.scope !== 'institute' || !claims.tenantId || claims.isImpersonated) return true;

    const keys = instituteAccessKeys(claims.tenantId);
    const [blocked, cached] = await Promise.all([
      this.redis.get(keys.blocked),
      this.redis.get(keys.cache),
    ]);
    if (blocked) throw notActive();

    const access = cached ?? (await this.loadAndCache(claims.tenantId, keys.cache));
    if (access !== INSTITUTE_ACCESS.ALLOWED) throw notActive();
    return true;
  }

  private async loadAndCache(instituteId: string, cacheKey: string): Promise<string> {
    const [institute] = await withAdmin(
      this.db,
      mkAdminCtx('service:institute-access-guard'),
      (tx) =>
        tx
          .select({ status: institutesLive.status })
          .from(institutesLive)
          .where(eq(institutesLive.id, instituteId))
          .limit(1),
    );
    const access = instituteAccessOf(institute?.status);
    await this.redis.set(cacheKey, access, 'EX', INSTITUTE_ACCESS_CACHE_TTL_SECONDS);
    return access;
  }
}

// UNAUTHENTICATED, like a suspended reseller: the client drops the session and its refresh fails.
function notActive(): BusinessException {
  return new BusinessException(ErrorCode.UNAUTHENTICATED, 'Institute is not active');
}
