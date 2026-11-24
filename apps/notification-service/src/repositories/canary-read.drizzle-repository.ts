import { Inject, Injectable } from '@nestjs/common';
import { NotificationTypeKey } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  notificationDeliveries,
  withAdmin,
} from '@roviq/database';
import { and, eq, max } from 'drizzle-orm';
import { CanaryReadRepository, type CanarySuccessRecord } from './canary-read.repository';

const ORIGIN = 'repository:canary-read';

@Injectable()
export class CanaryReadDrizzleRepository extends CanaryReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async latestSentPerChannel(): Promise<CanarySuccessRecord[]> {
    const d = notificationDeliveries;
    const rows = await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ channel: d.channel, sentAt: max(d.createdAt) })
        .from(d)
        .where(
          and(
            eq(d.scope, 'platform'),
            eq(d.type, NotificationTypeKey.DELIVERY_CANARY),
            eq(d.status, 'SENT'),
          ),
        )
        .groupBy(d.channel),
    );
    return rows.flatMap((row) =>
      row.sentAt ? [{ channel: row.channel, sentAt: row.sentAt }] : [],
    );
  }
}
