import { Inject, Injectable } from '@nestjs/common';
import { NotificationDeliveryStatus } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  notificationDeliveries,
  withAdmin,
} from '@roviq/database';
import { and, count, eq, gte } from 'drizzle-orm';
import { DeliveryStatsRepository, type SkippedCount } from './delivery-stats.repository';

const ORIGIN = 'repository:delivery-stats';

@Injectable()
export class DeliveryStatsDrizzleRepository extends DeliveryStatsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async countSkippedSince(since: Date): Promise<SkippedCount[]> {
    const d = notificationDeliveries;
    const rows = await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ channel: d.channel, reason: d.skipReason, count: count() })
        .from(d)
        .where(and(eq(d.status, NotificationDeliveryStatus.SKIPPED), gte(d.createdAt, since)))
        .groupBy(d.channel, d.skipReason),
    );
    // A SKIPPED row always has a reason (chk_notification_deliveries_outcome).
    return rows.flatMap((r) =>
      r.reason === null ? [] : [{ channel: r.channel, reason: r.reason, count: r.count }],
    );
  }
}
