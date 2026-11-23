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
import { arrivalOf } from './flow-arrival-of';
import { MessagingInboundRepository } from './messaging-inbound.repository';
import { sameNumberSenderIds } from './same-number-senders';
import type { InboundPerson, ReceiptInput, ReceiptResult } from './types';

const ORIGIN = 'repository:messaging-inbound';

@Injectable()
export class MessagingInboundDrizzleRepository extends MessagingInboundRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async recordReceipt(input: ReceiptInput): Promise<ReceiptResult> {
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
      if (!sent) return { kind: 'unknown_message' };

      const fresh = await this.insertEvent(
        tx,
        input.senderId,
        input.eventId,
        'receipt',
        input.person,
      );
      if (!fresh) return { kind: 'duplicate' };

      if (input.onlyIfNotDelivered) {
        const [delivered] = await tx
          .select({ id: notificationDeliveries.id })
          .from(notificationDeliveries)
          .where(and(ofMessage, eq(notificationDeliveries.status, 'DELIVERED')))
          .limit(1);
        if (delivered) return { kind: 'recorded', arrival: null };
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
        flowId: sent.flowId,
        status: input.status,
        errorCode: input.status === 'FAILED' ? (input.errorCode ?? 'WA_REJECTED') : null,
      });
      return { kind: 'recorded', arrival: arrivalOf(sent, input.status) };
    });
  }

  async recordPreference(
    senderId: string,
    eventId: string,
    person: InboundPerson,
    action: 'STOP' | 'START',
  ): Promise<{ changed: boolean; phone: string | null }> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const phone = person.phone ?? (await this.phoneOf(tx, senderId, person.providerUserId));
      const known: InboundPerson = { phone, providerUserId: person.providerUserId };
      const kind = action === 'STOP' ? 'opt_out' : 'opt_in';
      const stopped = await this.hasOptedOut(tx, senderId, known);
      // START from a person who is not stopped is an ordinary message: the event is left for
      // `recordMessage` to store.
      if (action === 'START' && !stopped) return { changed: false, phone };
      const fresh = await this.insertEvent(tx, senderId, eventId, kind, known);
      if (!fresh || stopped === (action === 'STOP')) return { changed: false, phone };
      await tx.insert(messagingOptOuts).values({
        senderId,
        channel: 'WHATSAPP',
        action,
        recipientPhone: phone,
        providerUserId: person.providerUserId,
      });
      return { changed: true, phone };
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
    kind: 'receipt' | 'opt_out' | 'opt_in' | 'message',
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

  /** The person's latest request to this number, if any, was STOP. */
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
    const [latest] = await tx
      .select({ action: messagingOptOuts.action })
      .from(messagingOptOuts)
      .where(and(inArray(messagingOptOuts.senderId, sameNumberSenderIds(tx, senderId)), who))
      .orderBy(desc(messagingOptOuts.createdAt), desc(messagingOptOuts.id))
      .limit(1);
    return latest?.action === 'STOP';
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
