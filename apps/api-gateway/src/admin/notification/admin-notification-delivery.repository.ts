import { Inject, Injectable } from '@nestjs/common';
import type { PlatformContext } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, notificationDeliveries, withAdmin } from '@roviq/database';
import { and, count, desc, eq, lt, type SQL } from 'drizzle-orm';
import type { NotificationDeliveryFilterInput } from './models/notification-delivery.model';

export type NotificationDeliveryRecord = typeof notificationDeliveries.$inferSelect;

export interface NotificationDeliveryPage {
  rows: NotificationDeliveryRecord[];
  totalCount: number;
  hasNextPage: boolean;
}

@Injectable()
export class AdminNotificationDeliveryRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  async list(
    ctx: PlatformContext,
    filter: NotificationDeliveryFilterInput,
    first: number,
    afterId: string | null,
  ): Promise<NotificationDeliveryPage> {
    const t = notificationDeliveries;
    const matching: SQL[] = [];
    if (filter.tenantId) matching.push(eq(t.tenantId, filter.tenantId));
    if (filter.channel) matching.push(eq(t.channel, filter.channel));
    if (filter.status) matching.push(eq(t.status, filter.status));
    if (filter.type) matching.push(eq(t.type, filter.type));
    if (filter.recipientUserId) matching.push(eq(t.recipientUserId, filter.recipientUserId));
    const page = afterId ? [...matching, lt(t.id, afterId)] : matching;

    return withAdmin(this.db, ctx, async (tx) => {
      const [rows, [total]] = await Promise.all([
        tx
          .select()
          .from(t)
          .where(and(...page))
          .orderBy(desc(t.id))
          .limit(first + 1),
        tx
          .select({ value: count() })
          .from(t)
          .where(and(...matching)),
      ]);
      return {
        rows: rows.slice(0, first),
        totalCount: total?.value ?? 0,
        hasNextPage: rows.length > first,
      };
    });
  }
}
