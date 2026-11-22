import { Inject, Injectable } from '@nestjs/common';
import type { PlatformContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  filesLive,
  institutesLive,
  membershipsLive,
  refreshTokensLive,
  resellersLive,
  withAdmin,
} from '@roviq/database';
import { and, countDistinct, eq, gte, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  type TenantActiveUsersRecord,
  TenantAnalyticsRepository,
  type TenantInstituteRecord,
  type TenantStorageRecord,
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

  async sumStorageByTenant(ctx: PlatformContext): Promise<TenantStorageRecord[]> {
    return withAdmin(this.db, ctx, async (tx) => {
      const bytes = sql<string>`sum(${filesLive.sizeBytes})`;
      const own = await tx
        .select({ tenantId: filesLive.tenantId, bytes })
        .from(filesLive)
        .where(and(eq(filesLive.status, 'READY'), isNotNull(filesLive.tenantId)))
        .groupBy(filesLive.tenantId);

      // Files about a person count for every institute the person belongs to. DISTINCT, so a
      // person with two memberships in one institute is not counted twice there.
      const members = tx
        .selectDistinct({ tenantId: membershipsLive.tenantId, userId: membershipsLive.userId })
        .from(membershipsLive)
        .as('members');
      const ofMembers = await tx
        .select({ tenantId: members.tenantId, bytes })
        .from(members)
        .innerJoin(filesLive, eq(filesLive.subjectUserId, members.userId))
        .where(
          and(
            eq(filesLive.status, 'READY'),
            isNull(filesLive.tenantId),
            isNull(filesLive.resellerId),
          ),
        )
        .groupBy(members.tenantId);

      const totals = new Map<string, number>();
      for (const row of [...own, ...ofMembers]) {
        if (!row.tenantId) continue;
        totals.set(row.tenantId, (totals.get(row.tenantId) ?? 0) + Number(row.bytes));
      }
      return [...totals].map(([tenantId, storageUsedBytes]) => ({ tenantId, storageUsedBytes }));
    });
  }
}
