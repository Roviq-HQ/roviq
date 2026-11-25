import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationDeliveryStatus,
  NotificationTypeKey,
  type PlatformContext,
} from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, notificationDeliveries, withAdmin } from '@roviq/database';
import { and, count, eq, gte, inArray, max } from 'drizzle-orm';
import {
  type CanarySuccessRecord,
  NotificationHealthRepository,
  type SendCountRecord,
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

  async countSendsSince(ctx: PlatformContext, since: Date): Promise<SendCountRecord[]> {
    const d = notificationDeliveries;
    const rows = await withAdmin(this.db, ctx, (tx) =>
      tx
        .select({ channel: d.channel, status: d.status, count: count() })
        .from(d)
        .where(and(inArray(d.status, COUNTED), gte(d.createdAt, since)))
        .groupBy(d.channel, d.status),
    );
    return rows.flatMap(({ channel, status, count }) =>
      status === 'SENT' || status === 'FAILED' ? [{ channel, status, count }] : [],
    );
  }
}

const COUNTED = [NotificationDeliveryStatus.SENT, NotificationDeliveryStatus.FAILED];
