import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  notificationDeliveries,
  notifications,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { NotificationWriteRepository } from './notification-write.repository';
import type { DeferralRow, DeliveryRow, InAppRow } from './types';

const ORIGIN = 'repository:notification-write';

@Injectable()
export class NotificationWriteDrizzleRepository extends NotificationWriteRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async insertInApp(row: InAppRow): Promise<{ id: string; created: boolean }> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [inserted] = await tx
        .insert(notifications)
        .values({
          scope: row.audience.scope,
          tenantId: row.audience.tenantId,
          resellerId: row.audience.resellerId,
          recipientUserId: row.recipient.userId,
          recipientMembershipId: row.recipient.membershipId,
          type: row.type,
          title: row.title,
          body: row.body,
          data: row.data,
          dedupeKey: row.dedupeKey,
          flowId: row.flowId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .onConflictDoNothing({ target: notifications.dedupeKey })
        .returning({ id: notifications.id });
      if (inserted) return { id: inserted.id, created: true };

      const [existing] = await tx
        .select({ id: notifications.id })
        .from(notifications) // allow-base-read: the dedupe key is unique across deleted rows too
        .where(eq(notifications.dedupeKey, row.dedupeKey))
        .limit(1);
      if (!existing) throw new Error(`notification with dedupe key ${row.dedupeKey} vanished`);
      return { id: existing.id, created: false };
    });
  }

  async recordDelivery(row: DeliveryRow): Promise<void> {
    const { outcome } = row;
    await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(notificationDeliveries).values({
        scope: row.audience.scope,
        tenantId: row.audience.tenantId,
        resellerId: row.audience.resellerId,
        notificationId: row.notificationId,
        recipientUserId: row.recipientUserId,
        type: row.type,
        channel: row.channel,
        attempt: row.attempt,
        flowId: row.flowId,
        status: outcome.status,
        provider: outcome.provider,
        providerMessageId: outcome.status === 'SENT' ? outcome.providerMessageId : null,
        errorCode: outcome.status === 'FAILED' ? outcome.errorCode : null,
        skipReason: outcome.status === 'SKIPPED' ? outcome.skipReason : null,
        senderId: outcome.status === 'SKIPPED' ? null : (outcome.route?.senderId ?? null),
        templateCategory:
          outcome.status === 'SKIPPED' ? null : (outcome.route?.templateCategory ?? null),
      }),
    );
  }

  async recordDeferral(row: DeferralRow): Promise<void> {
    const t = notificationDeliveries;
    await withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      if (row.flowId !== null) {
        const [held] = await tx
          .select({ id: t.id })
          .from(t)
          .where(
            and(
              eq(t.flowId, row.flowId),
              eq(t.recipientUserId, row.recipientUserId),
              eq(t.channel, row.channel),
              eq(t.status, 'DEFERRED'),
            ),
          )
          .limit(1);
        if (held) return;
      }
      await tx.insert(t).values({
        scope: row.audience.scope,
        tenantId: row.audience.tenantId,
        resellerId: row.audience.resellerId,
        notificationId: row.notificationId,
        recipientUserId: row.recipientUserId,
        type: row.type,
        channel: row.channel,
        attempt: row.attempt,
        flowId: row.flowId,
        status: 'DEFERRED',
        skipReason: row.reason,
      });
    });
  }
}
