import { Inject, Injectable } from '@nestjs/common';
import {
  MESSAGE_TEMPLATE_CATEGORY_VALUES,
  type MessageTemplateCategory,
  type MessagingSenderStatus,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationTypeKey,
  type PlatformContext,
} from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutesLive,
  messagingSenderSecrets,
  messagingSenders,
  messagingSendersLive,
  notificationDeliveries,
  softDelete,
  uniqueViolationConstraint,
  withAdmin,
} from '@roviq/database';
import { and, asc, count, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  MESSAGING_SENDER_CHANNEL,
  USAGE_TIMEZONE,
  WHATSAPP_CLOUD_PROVIDER,
} from '../messaging.constants';
import { AdminMessagingRepository } from './admin-messaging.repository';
import type {
  MessagingSenderRecord,
  RegisterMessagingSenderData,
  RegisterMessagingSenderResult,
  SmsUsageRecord,
  UpdateMessagingSenderData,
  WhatsAppUsageRecord,
} from './types';

/** Unique indexes that mean "this sender already exists". */
const SENDER_UNIQUE_KEYS = new Set([
  'messaging_senders_platform_channel_key',
  'messaging_senders_tenant_channel_key',
  'messaging_senders_provider_number_key',
]);

const senderColumns = {
  id: messagingSenders.id,
  scope: messagingSenders.scope,
  tenantId: messagingSenders.tenantId,
  providerNumberId: messagingSenders.providerNumberId,
  displayNumber: messagingSenders.displayNumber,
  status: messagingSenders.status,
  dailyCap: messagingSenders.dailyCap,
  instituteDailyCap: messagingSenders.instituteDailyCap,
  messagesPerSecond: messagingSenders.messagesPerSecond,
  createdAt: messagingSenders.createdAt,
  updatedAt: messagingSenders.updatedAt,
};

const liveColumns = {
  id: messagingSendersLive.id,
  scope: messagingSendersLive.scope,
  tenantId: messagingSendersLive.tenantId,
  providerNumberId: messagingSendersLive.providerNumberId,
  displayNumber: messagingSendersLive.displayNumber,
  status: messagingSendersLive.status,
  dailyCap: messagingSendersLive.dailyCap,
  instituteDailyCap: messagingSendersLive.instituteDailyCap,
  messagesPerSecond: messagingSendersLive.messagesPerSecond,
  createdAt: messagingSendersLive.createdAt,
  updatedAt: messagingSendersLive.updatedAt,
};

type SenderRow = Omit<MessagingSenderRecord, 'scope'> & { scope: string };

function toRecord(row: SenderRow): MessagingSenderRecord {
  if (row.scope !== 'platform' && row.scope !== 'institute') {
    throw new Error(`messaging_senders ${row.id} has unknown scope ${row.scope}`);
  }
  return { ...row, scope: row.scope };
}

function toCategory(value: string | null): MessageTemplateCategory | null {
  if (value === null) return null;
  const known = MESSAGE_TEMPLATE_CATEGORY_VALUES.find((c) => c === value);
  if (!known) throw new Error(`notification_deliveries has unknown template_category ${value}`);
  return known;
}

/** SENT deliveries on `channel` in calendar month `month` (YYYY-MM) of the usage timezone. */
function sentInMonth(channel: NotificationChannel, month: string) {
  const d = notificationDeliveries;
  const monthStart = sql`(${`${month}-01`}::date)::timestamp`;
  return and(
    eq(d.channel, channel),
    eq(d.status, NotificationDeliveryStatus.SENT),
    // The platform's own test messages are not usage of any institute or of the platform.
    ne(d.type, NotificationTypeKey.DELIVERY_CANARY),
    gte(d.createdAt, sql`${monthStart} AT TIME ZONE ${USAGE_TIMEZONE}`),
    lt(d.createdAt, sql`(${monthStart} + interval '1 month') AT TIME ZONE ${USAGE_TIMEZONE}`),
  );
}

/** Live row of the sender, base table, for an UPDATE target. */
function liveSender(id: string) {
  return and(eq(messagingSenders.id, id), isNull(messagingSenders.deletedAt));
}

@Injectable()
export class AdminMessagingDrizzleRepository extends AdminMessagingRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async list(ctx: PlatformContext): Promise<MessagingSenderRecord[]> {
    const rows = await withAdmin(this.db, ctx, (tx) =>
      tx
        .select(liveColumns)
        .from(messagingSendersLive)
        .orderBy(
          sql`CASE ${messagingSendersLive.scope} WHEN 'platform' THEN 0 ELSE 1 END`,
          asc(messagingSendersLive.createdAt),
        ),
    );
    return rows.map(toRecord);
  }

  async findById(ctx: PlatformContext, id: string): Promise<MessagingSenderRecord | null> {
    const [row] = await withAdmin(this.db, ctx, (tx) =>
      tx.select(liveColumns).from(messagingSendersLive).where(eq(messagingSendersLive.id, id)),
    );
    return row ? toRecord(row) : null;
  }

  async register(
    ctx: PlatformContext,
    data: RegisterMessagingSenderData,
  ): Promise<RegisterMessagingSenderResult> {
    try {
      return await withAdmin(this.db, ctx, async (tx): Promise<RegisterMessagingSenderResult> => {
        if (data.tenantId) {
          const [institute] = await tx
            .select({ id: institutesLive.id })
            .from(institutesLive)
            .where(eq(institutesLive.id, data.tenantId));
          if (!institute) return { kind: 'institute_not_found' };
        }
        const [row] = await tx
          .insert(messagingSenders)
          .values({
            scope: data.tenantId ? 'institute' : 'platform',
            tenantId: data.tenantId,
            channel: MESSAGING_SENDER_CHANNEL,
            provider: WHATSAPP_CLOUD_PROVIDER,
            providerNumberId: data.providerNumberId,
            displayNumber: data.displayNumber,
            dailyCap: data.dailyCap,
            instituteDailyCap: data.instituteDailyCap,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning(senderColumns);
        if (!row) throw new Error('messaging_senders insert returned no row');
        await tx.insert(messagingSenderSecrets).values({
          senderId: row.id,
          accessTokenEncrypted: data.accessTokenEncrypted,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
        return { kind: 'ok', sender: toRecord(row) };
      });
    } catch (err) {
      // The unique indexes are the only race-free duplicate check.
      const constraint = uniqueViolationConstraint(err);
      if (constraint && SENDER_UNIQUE_KEYS.has(constraint)) return { kind: 'sender_exists' };
      throw err;
    }
  }

  async update(
    ctx: PlatformContext,
    id: string,
    data: UpdateMessagingSenderData,
  ): Promise<MessagingSenderRecord | null> {
    const [row] = await withAdmin(this.db, ctx, (tx) =>
      tx
        .update(messagingSenders)
        .set({
          ...(data.displayNumber !== undefined && { displayNumber: data.displayNumber }),
          ...(data.dailyCap !== undefined && { dailyCap: data.dailyCap }),
          ...(data.instituteDailyCap !== undefined && {
            instituteDailyCap: data.instituteDailyCap,
          }),
          ...(data.messagesPerSecond !== undefined && {
            messagesPerSecond: data.messagesPerSecond,
          }),
          updatedBy: ctx.userId,
          version: sql`${messagingSenders.version} + 1`,
        })
        .where(liveSender(id))
        .returning(senderColumns),
    );
    return row ? toRecord(row) : null;
  }

  async replaceToken(
    ctx: PlatformContext,
    id: string,
    accessTokenEncrypted: Buffer,
  ): Promise<MessagingSenderRecord | null> {
    return withAdmin(this.db, ctx, async (tx) => {
      // Locks the sender so a concurrent delete cannot leave a token behind it.
      const [row] = await tx
        .update(messagingSenders)
        .set({ updatedBy: ctx.userId, version: sql`${messagingSenders.version} + 1` })
        .where(liveSender(id))
        .returning(senderColumns);
      if (!row) return null;
      await tx
        .insert(messagingSenderSecrets)
        .values({
          senderId: id,
          accessTokenEncrypted,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: messagingSenderSecrets.senderId,
          set: { accessTokenEncrypted, updatedBy: ctx.userId, updatedAt: new Date() },
        });
      return toRecord(row);
    });
  }

  async setStatus(
    ctx: PlatformContext,
    id: string,
    from: MessagingSenderStatus,
    to: MessagingSenderStatus,
  ): Promise<MessagingSenderRecord | null> {
    const [row] = await withAdmin(this.db, ctx, (tx) =>
      tx
        .update(messagingSenders)
        .set({ status: to, updatedBy: ctx.userId, version: sql`${messagingSenders.version} + 1` })
        // The transition was checked against `from`; a change made meanwhile wins.
        .where(and(liveSender(id), eq(messagingSenders.status, from)))
        .returning(senderColumns),
    );
    return row ? toRecord(row) : null;
  }

  async delete(ctx: PlatformContext, id: string): Promise<boolean> {
    return withAdmin(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(messagingSenders)
        .set({ updatedBy: ctx.userId })
        .where(liveSender(id))
        .returning({ id: messagingSenders.id });
      if (!row) return false;
      // A token must not outlive its sender.
      await tx.delete(messagingSenderSecrets).where(eq(messagingSenderSecrets.senderId, id));
      await softDelete(tx, messagingSenders, id);
      return true;
    });
  }

  async whatsAppUsage(ctx: PlatformContext, month: string): Promise<WhatsAppUsageRecord[]> {
    const d = notificationDeliveries;
    const rows = await withAdmin(this.db, ctx, (tx) =>
      tx
        .select({
          tenantId: d.tenantId,
          templateCategory: d.templateCategory,
          sentCount: count(),
        })
        .from(d)
        .where(sentInMonth(MESSAGING_SENDER_CHANNEL, month))
        .groupBy(d.tenantId, d.templateCategory)
        .orderBy(sql`${d.tenantId} NULLS FIRST`, sql`${d.templateCategory} NULLS LAST`),
    );
    return rows.map((row) => ({
      tenantId: row.tenantId,
      templateCategory: toCategory(row.templateCategory),
      sentCount: row.sentCount,
    }));
  }

  async smsUsage(ctx: PlatformContext, month: string): Promise<SmsUsageRecord[]> {
    const d = notificationDeliveries;
    return withAdmin(this.db, ctx, (tx) =>
      tx
        .select({ tenantId: d.tenantId, type: d.type, sentCount: count() })
        .from(d)
        .where(sentInMonth(NotificationChannel.SMS, month))
        .groupBy(d.tenantId, d.type)
        .orderBy(sql`${d.tenantId} NULLS FIRST`, asc(d.type)),
    );
  }
}
