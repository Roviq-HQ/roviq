import { Inject, Injectable } from '@nestjs/common';
import type { NotificationChannel } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  messagingInboundEvents,
  messagingOptOuts,
  messagingSenderSecrets,
  messagingSendersLive,
  mkAdminCtx,
  notificationDeliveries,
  withAdmin,
} from '@roviq/database';
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { MessagingSenderRepository } from './messaging-sender.repository';
import { sameNumberSenderIds } from './same-number-senders';
import type { MessagingSenderRecord, SenderSentCounts } from './types';

const ORIGIN = 'repository:messaging-sender';

const senderColumns = {
  id: messagingSendersLive.id,
  scope: messagingSendersLive.scope,
  tenantId: messagingSendersLive.tenantId,
  status: messagingSendersLive.status,
  providerNumberId: messagingSendersLive.providerNumberId,
  dailyCap: messagingSendersLive.dailyCap,
  instituteDailyCap: messagingSendersLive.instituteDailyCap,
  accessTokenEncrypted: messagingSenderSecrets.accessTokenEncrypted,
};

@Injectable()
export class MessagingSenderDrizzleRepository extends MessagingSenderRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async resolveForAudience(
    tenantId: string | null,
    channel: NotificationChannel,
    provider: string,
  ): Promise<MessagingSenderRecord | null> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const own =
        tenantId === null
          ? undefined
          : and(
              eq(messagingSendersLive.scope, 'institute'),
              eq(messagingSendersLive.tenantId, tenantId),
            );
      const rows = await tx
        .select(senderColumns)
        .from(messagingSendersLive)
        .innerJoin(
          messagingSenderSecrets,
          eq(messagingSenderSecrets.senderId, messagingSendersLive.id),
        )
        .where(
          and(
            eq(messagingSendersLive.channel, channel),
            eq(messagingSendersLive.provider, provider),
            eq(messagingSendersLive.status, 'ACTIVE'),
            or(eq(messagingSendersLive.scope, 'platform'), own),
          ),
        );
      return rows.find((r) => r.scope === 'institute') ?? rows[0] ?? null;
    });
  }

  async findActivePlatform(
    channel: NotificationChannel,
    provider: string,
  ): Promise<MessagingSenderRecord | null> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .select(senderColumns)
        .from(messagingSendersLive)
        .innerJoin(
          messagingSenderSecrets,
          eq(messagingSenderSecrets.senderId, messagingSendersLive.id),
        )
        .where(
          and(
            eq(messagingSendersLive.channel, channel),
            eq(messagingSendersLive.provider, provider),
            eq(messagingSendersLive.status, 'ACTIVE'),
            eq(messagingSendersLive.scope, 'platform'),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async findByProviderNumber(
    provider: string,
    providerNumberId: string,
  ): Promise<MessagingSenderRecord | null> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .select(senderColumns)
        .from(messagingSendersLive)
        .innerJoin(
          messagingSenderSecrets,
          eq(messagingSenderSecrets.senderId, messagingSendersLive.id),
        )
        .where(
          and(
            eq(messagingSendersLive.provider, provider),
            eq(messagingSendersLive.providerNumberId, providerNumberId),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async isOptedOut(senderId: string, phone: string): Promise<boolean> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      // The latest request decides: a later START lifts a STOP. A stop request can arrive with the provider's user id and no phone. It still counts
      // once any event of this number has tied that user id to the phone.
      const userIdsOfPhone = tx
        .select({ providerUserId: messagingInboundEvents.providerUserId })
        .from(messagingInboundEvents)
        .where(
          and(
            inArray(messagingInboundEvents.senderId, sameNumberSenderIds(tx, senderId)),
            eq(messagingInboundEvents.recipientPhone, phone),
            isNotNull(messagingInboundEvents.providerUserId),
          ),
        );
      const [latest] = await tx
        .select({ action: messagingOptOuts.action })
        .from(messagingOptOuts)
        .where(
          and(
            inArray(messagingOptOuts.senderId, sameNumberSenderIds(tx, senderId)),
            or(
              eq(messagingOptOuts.recipientPhone, phone),
              inArray(messagingOptOuts.providerUserId, userIdsOfPhone),
            ),
          ),
        )
        .orderBy(desc(messagingOptOuts.createdAt), desc(messagingOptOuts.id))
        .limit(1);
      return latest?.action === 'STOP';
    });
  }

  async countSentSince(
    senderId: string,
    since: Date,
    tenantId: string | null,
  ): Promise<SenderSentCounts> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          forTenant: sql<number>`count(*) FILTER (WHERE ${notificationDeliveries.tenantId} = ${tenantId})::int`,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.senderId, senderId),
            eq(notificationDeliveries.status, 'SENT'),
            gte(notificationDeliveries.createdAt, since),
          ),
        );
      return { total: row?.total ?? 0, forTenant: row?.forTenant ?? 0 };
    });
  }
}
