import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationDeliveryStatus,
  NotificationTypeKey,
  type PlatformContext,
} from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, notificationDeliveries, withAdmin } from '@roviq/database';
import { and, eq, max } from 'drizzle-orm';
import {
  type CanarySuccessRecord,
  NotificationHealthRepository,
} from './notification-health.repository';

@Injectable()
export class NotificationHealthDrizzleRepository extends NotificationHealthRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async latestCanarySuccess(ctx: PlatformContext): Promise<CanarySuccessRecord[]> {
    const d = notificationDeliveries;
    const rows = await withAdmin(this.db, ctx, (tx) =>
      tx
        .select({ channel: d.channel, sentAt: max(d.createdAt) })
        .from(d)
        .where(
          and(
            eq(d.scope, 'platform'),
            eq(d.type, NotificationTypeKey.DELIVERY_CANARY),
            eq(d.status, NotificationDeliveryStatus.SENT),
          ),
        )
        .groupBy(d.channel),
    );
    return rows.flatMap((row) =>
      row.sentAt ? [{ channel: row.channel, sentAt: row.sentAt }] : [],
    );
  }
}
