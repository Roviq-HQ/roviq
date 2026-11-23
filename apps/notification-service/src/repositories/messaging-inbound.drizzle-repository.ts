import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  messagingInboundEvents,
  messagingOptOuts,
  mkAdminCtx,
  notificationDeliveries,
  withAdmin,
} from '@roviq/database';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { MessagingInboundRepository } from './messaging-inbound.repository';
import { sameNumberSenderIds } from './same-number-senders';
import type { InboundPerson, ReceiptInput } from './types';

const ORIGIN = 'repository:messaging-inbound';

@Injectable()
export class MessagingInboundDrizzleRepository extends MessagingInboundRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async recordReceipt(input: ReceiptInput): Promise<'recorded' | 'duplicate' | 'unknown_message'> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      // The sender is part of the key: a report arriving on one number cannot touch a
      // message another institute's number sent.
      const ofMessage = and(
        eq(notificationDeliveries.senderId, input.senderId),
        eq(notificationDeliveries.providerMessageId, input.providerMessageId),
      );
      const [sent] = await tx
        .select()
        .from(notificationDeliveries)
        .where(and(ofMessage, eq(notificationDeliveries.status, 'SENT')))
        .limit(1);
      if (!sent) return 'unknown_message';

      const fresh = await this.insertEvent(
        tx,
        input.senderId,
        input.eventId,
        'receipt',
        input.person,
      );
      if (!fresh) return 'duplicate';

      if (input.onlyIfNotDelivered) {
        const [delivered] = await tx
          .select({ id: notificationDeliveries.id })
          .from(notificationDeliveries)
          .where(and(ofMessage, eq(notificationDeliveries.status, 'DELIVERED')))
          .limit(1);
        if (delivered) return 'recorded';
      }
      await tx.insert(notificationDeliveries).values({
        scope: sent.scope,
        tenantId: sent.tenantId,
        resellerId: sent.resellerId,
        notificationId: sent.notificationId,
        recipientUserId: sent.recipientUserId,
        type: sent.type,
        channel: sent.channel,
        provider: sent.provider,
        attempt: sent.attempt,
        senderId: sent.senderId,
        templateCategory: sent.templateCategory,
        providerMessageId: sent.providerMessageId,
        status: input.status,
        errorCode: input.status === 'FAILED' ? (input.errorCode ?? 'WA_REJECTED') : null,
      });
      return 'recorded';
    });
  }

  async recordOptOut(
    senderId: string,
    eventId: string,
    person: InboundPerson,
  ): Promise<{ created: boolean; phone: string | null }> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const phone = person.phone ?? (await this.phoneOf(tx, senderId, person.providerUserId));
      const known: InboundPerson = { phone, providerUserId: person.providerUserId };
      const fresh = await this.insertEvent(tx, senderId, eventId, 'opt_out', known);
      if (!fresh || (await this.hasOptedOut(tx, senderId, known))) return { created: false, phone };
      await tx.insert(messagingOptOuts).values({
        senderId,
        channel: 'WHATSAPP',
        recipientPhone: phone,
        providerUserId: person.providerUserId,
      });
      return { created: true, phone };
    });
  }

  async recordMessage(
    senderId: string,
    eventId: string,
    person: InboundPerson,
    day: string,
  ): Promise<{ reply: boolean }> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      if (await this.hasOptedOut(tx, senderId, person)) {
        await this.insertEvent(tx, senderId, eventId, 'message', person);
        return { reply: false };
      }
      // Refused when the event is a repeat or the person already got today's reply.
      const first = await this.insertEvent(tx, senderId, eventId, 'message', person, day);
      if (!first) await this.insertEvent(tx, senderId, eventId, 'message', person);
      return { reply: first };
    });
  }

  /** False when a unique index refused the row: the event id, or the day's one reply. */
  private async insertEvent(
    tx: DrizzleDB,
    senderId: string,
    providerEventId: string,
    kind: 'receipt' | 'opt_out' | 'message',
    person: InboundPerson,
    autoReplyDay: string | null = null,
  ): Promise<boolean> {
    if (person.phone === null && person.providerUserId === null && autoReplyDay !== null) {
      return false;
    }
    const inserted = await tx
      .insert(messagingInboundEvents)
      .values({
        senderId,
        providerEventId,
        kind,
        recipientPhone: person.phone,
        providerUserId: person.providerUserId,
        autoReplyDay,
      })
      .onConflictDoNothing()
      .returning({ id: messagingInboundEvents.id });
    return inserted.length > 0;
  }

  private async hasOptedOut(
    tx: DrizzleDB,
    senderId: string,
    person: InboundPerson,
  ): Promise<boolean> {
    const who = or(
      person.phone === null ? undefined : eq(messagingOptOuts.recipientPhone, person.phone),
      person.providerUserId === null
        ? undefined
        : eq(messagingOptOuts.providerUserId, person.providerUserId),
    );
    if (who === undefined) return false;
    const [row] = await tx
      .select({ id: messagingOptOuts.id })
      .from(messagingOptOuts)
      .where(and(inArray(messagingOptOuts.senderId, sameNumberSenderIds(tx, senderId)), who))
      .limit(1);
    return row !== undefined;
  }

  /** The number an earlier event of this sender tied to the provider's user id. */
  private async phoneOf(
    tx: DrizzleDB,
    senderId: string,
    providerUserId: string | null,
  ): Promise<string | null> {
    if (providerUserId === null) return null;
    const [row] = await tx
      .select({ phone: messagingInboundEvents.recipientPhone })
      .from(messagingInboundEvents)
      .where(
        and(
          inArray(messagingInboundEvents.senderId, sameNumberSenderIds(tx, senderId)),
          eq(messagingInboundEvents.providerUserId, providerUserId),
          isNotNull(messagingInboundEvents.recipientPhone),
        ),
      )
      .orderBy(desc(messagingInboundEvents.createdAt))
      .limit(1);
    return row?.phone ?? null;
  }
}
