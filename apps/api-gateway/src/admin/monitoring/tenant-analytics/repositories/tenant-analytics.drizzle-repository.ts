import { Inject, Injectable } from '@nestjs/common';
import type { PlatformContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutesLive,
  refreshTokensLive,
  resellersLive,
  withAdmin,
} from '@roviq/database';
import { and, countDistinct, eq, gte, isNotNull, or } from 'drizzle-orm';
import {
  type TenantActiveUsersRecord,
  TenantAnalyticsRepository,
  type TenantInstituteRecord,
} from './tenant-analytics.repository';

@Injectable()
export class TenantAnalyticsDrizzleRepository extends TenantAnalyticsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async listInstitutes(
    ctx: PlatformContext,
    resellerId: string | null,
  ): Promise<TenantInstituteRecord[]> {
    return withAdmin(this.db, ctx, (tx) =>
      tx
        .select({
          instituteId: institutesLive.id,
          instituteName: institutesLive.name,
          resellerId: institutesLive.resellerId,
          resellerName: resellersLive.name,
        })
        .from(institutesLive)
        .innerJoin(resellersLive, eq(resellersLive.id, institutesLive.resellerId))
        .where(resellerId ? eq(institutesLive.resellerId, resellerId) : undefined),
    );
  }

  async countActiveUsersSince(
    ctx: PlatformContext,
    since: Date,
  ): Promise<TenantActiveUsersRecord[]> {
    const rows = await withAdmin(this.db, ctx, (tx) =>
      tx
        .select({
          tenantId: refreshTokensLive.tenantId,
          activeUsers: countDistinct(refreshTokensLive.userId),
        })
        .from(refreshTokensLive)
        .where(
          and(
            eq(refreshTokensLive.membershipScope, 'institute'),
            isNotNull(refreshTokensLive.tenantId),
            or(gte(refreshTokensLive.createdAt, since), gte(refreshTokensLive.lastUsedAt, since)),
          ),
        )
        .groupBy(refreshTokensLive.tenantId),
    );
    return rows.flatMap((r) =>
      r.tenantId ? [{ tenantId: r.tenantId, activeUsers: r.activeUsers }] : [],
    );
  }
}
