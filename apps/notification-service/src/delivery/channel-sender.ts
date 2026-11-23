import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import type { ContactReadRepository } from '../repositories/contact-read.repository';
import type { NotificationWriteRepository } from '../repositories/notification-write.repository';
import type {
  Audience,
  ContactRecord,
  DeliveryOutcome,
  DeliveryRoute,
  MessagingSenderRecord,
} from '../repositories/types';
import type { Locale, OutsideCopy } from '../types/notification-type';
import { ChannelAdapterError } from './adapters/channel-adapter';
import type { ChannelAdapters } from './adapters/channel-adapters';
import { evaluateChannelGate } from './channel-gate';
import type { ConsentGate } from './consent-gate';
import type { WhatsAppRoute } from './whatsapp/whatsapp-route';
import type { TemplateSend } from './whatsapp/whatsapp-template';

export interface ChannelAttempt {
  type: NotificationTypeKey;
  channel: NotificationChannel;
  audience: Audience;
  recipientUserId: string;
  notificationId: string | null;
  /** Institute setting for this channel; true for critical and secret types. */
  channelEnabled: boolean;
  /** Critical and secret types: quiet hours do not apply, and over a sender's cap they wait. */
  critical: boolean;
  /** False when the caller cannot wait: a deferral is then recorded as skipped (`sender_cap`). */
  deferrable: boolean;
  /** 1-based; stored on the delivery row. */
  attempt: number;
  /**
   * `lookup`: read the recipient's address by user id at send time. `given`: the one address
   * the event names (secret types); null means the event has none.
   */
  address: 'lookup' | { given: string | null };
  /** Push payload data: entity ids and the deep-link path. */
  data: Record<string, string>;
  compose(locale: Locale): OutsideCopy;
  /** The approved WhatsApp template for this message; null or absent when there is none. */
  template?(locale: Locale): TemplateSend | null;
}

/** Not sent and not refused: the caller tries again at `until`. No delivery row is written. */
export interface DeferredAttempt {
  status: 'DEFERRED';
  until: Date;
}

export type AttemptOutcome = DeliveryOutcome | DeferredAttempt;

/**
 * One attempt on one channel: gate, compose in the recipient's locale, send, and record exactly
 * one `notification_deliveries` row (none for a deferral). A provider failure becomes a FAILED
 * row; any other error (database, programming) propagates.
 */
export class ChannelSender {
  constructor(
    private readonly adapters: ChannelAdapters,
    private readonly consent: ConsentGate,
    private readonly contacts: ContactReadRepository,
    private readonly writes: NotificationWriteRepository,
    private readonly whatsapp: WhatsAppRoute,
  ) {}

  async attempt(a: ChannelAttempt): Promise<AttemptOutcome> {
    const outcome = await this.run(a);
    if (outcome.status === 'DEFERRED') return outcome;
    await this.writes.recordDelivery({
      audience: a.audience,
      notificationId: a.notificationId,
      recipientUserId: a.recipientUserId,
      type: a.type,
      channel: a.channel,
      attempt: a.attempt,
      outcome,
    });
    return outcome;
  }

  private async run(a: ChannelAttempt): Promise<AttemptOutcome> {
    const adapter = this.adapters.get(a.channel);
    const routed = adapter?.usesSenders === true;
    const tenantId = a.audience.tenantId;
    let contact: Promise<ContactRecord | null> | null = null;
    const loadContact = () => {
      contact ??= this.contacts.findContact(a.recipientUserId);
      return contact;
    };
    const loadLocale = async (): Promise<Locale> =>
      (await loadContact())?.preferredLocale === 'hi' ? 'hi' : 'en';
    let sender: MessagingSenderRecord | null = null;
    let template: TemplateSend | null = null;

    const gate = await evaluateChannelGate({
      channelEnabled: a.channelEnabled,
      consents: () =>
        this.consent.allows({
          recipientUserId: a.recipientUserId,
          channel: a.channel,
          type: a.type,
          tenantId,
          studentMembershipId: a.data.studentId ?? null,
        }),
      hasProvider: async () => {
        if (adapter === null) return false;
        if (!routed) return true;
        sender = await this.whatsapp.resolveSender(tenantId);
        return sender !== null;
      },
      hasTemplate: routed
        ? async () => {
            template = a.template?.(await loadLocale()) ?? null;
            return template !== null;
          }
        : undefined,
      resolveAddresses: async () => {
        if (a.address === 'lookup')
          return this.addressesOf(a.channel, a.recipientUserId, loadContact);
        return a.address.given ? [a.address.given] : [];
      },
      optedOut: routed
        ? async ([phone]) =>
            sender !== null && phone !== undefined && this.whatsapp.optedOut(sender, phone)
        : undefined,
      quietUntil: routed ? () => this.whatsapp.quietUntil(tenantId, a.critical) : undefined,
      capacity: routed
        ? async () =>
            sender === null ? 'ok' : this.whatsapp.capacity(sender, tenantId, a.critical)
        : undefined,
    });
    if (!gate.open) {
      if ('deferUntil' in gate) {
        return a.deferrable
          ? { status: 'DEFERRED', until: gate.deferUntil }
          : { status: 'SKIPPED', provider: null, skipReason: 'sender_cap' };
      }
      return { status: 'SKIPPED', provider: null, skipReason: gate.reason };
    }
    // The gate already refused a channel without an adapter; this narrows the type.
    if (adapter === null) return { status: 'SKIPPED', provider: null, skipReason: 'no_provider' };

    const route = routeOf(sender, template);
    const copy = a.compose(await loadLocale());
    try {
      const result = await adapter.send({
        channel: a.channel,
        type: a.type,
        recipientUserId: a.recipientUserId,
        to: gate.addresses,
        subject: copy.subject,
        body: copy.body,
        data: a.data,
        ...(route ? { route: route.message } : {}),
      });
      return {
        status: 'SENT',
        provider: adapter.provider,
        providerMessageId: result.providerMessageId ?? null,
        ...(route ? { route: route.stored } : {}),
      };
    } catch (err) {
      if (err instanceof ChannelAdapterError) {
        return {
          status: 'FAILED',
          provider: adapter.provider,
          errorCode: err.code,
          retryable: err.retryable,
          ...(route ? { route: route.stored } : {}),
        };
      }
      throw err;
    }
  }

  private async addressesOf(
    channel: NotificationChannel,
    userId: string,
    loadContact: () => Promise<ContactRecord | null>,
  ): Promise<readonly string[]> {
    switch (channel) {
      case 'EMAIL': {
        const email = (await loadContact())?.email;
        return email ? [email] : [];
      }
      case 'SMS':
      case 'WHATSAPP': {
        const phone = (await loadContact())?.phone;
        return phone ? [phone] : [];
      }
      case 'PUSH':
        return this.contacts.findDeviceTokens(userId);
    }
  }
}

function routeOf(
  sender: MessagingSenderRecord | null,
  template: TemplateSend | null,
): {
  message: { sender: MessagingSenderRecord; template: TemplateSend };
  stored: DeliveryRoute;
} | null {
  if (sender === null || template === null) return null;
  return {
    message: { sender, template },
    stored: { senderId: sender.id, templateCategory: template.category },
  };
}

/** Push data must be flat strings. */
export function toPushData(data: Record<string, string | number | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== null) out[key] = String(value);
  }
  return out;
}
