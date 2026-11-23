import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import type { ContactReadRepository } from '../repositories/contact-read.repository';
import type { NotificationWriteRepository } from '../repositories/notification-write.repository';
import type { Audience, ContactRecord, DeliveryOutcome } from '../repositories/types';
import type { Locale, OutsideCopy } from '../types/notification-type';
import { ChannelAdapterError } from './adapters/channel-adapter';
import type { ChannelAdapters } from './adapters/channel-adapters';
import { evaluateChannelGate } from './channel-gate';
import type { ConsentGate } from './consent-gate';

export interface ChannelAttempt {
  type: NotificationTypeKey;
  channel: NotificationChannel;
  audience: Audience;
  recipientUserId: string;
  notificationId: string | null;
  /** Institute setting for this channel; true for critical and secret types. */
  channelEnabled: boolean;
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
}

/**
 * One attempt on one channel: gate, compose in the recipient's locale, send, and record exactly
 * one `notification_deliveries` row. A provider failure becomes a FAILED row; any other error
 * (database, programming) propagates.
 */
export class ChannelSender {
  constructor(
    private readonly adapters: ChannelAdapters,
    private readonly consent: ConsentGate,
    private readonly contacts: ContactReadRepository,
    private readonly writes: NotificationWriteRepository,
  ) {}

  async attempt(a: ChannelAttempt): Promise<DeliveryOutcome> {
    const outcome = await this.run(a);
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

  private async run(a: ChannelAttempt): Promise<DeliveryOutcome> {
    const adapter = this.adapters.get(a.channel);
    let contact: Promise<ContactRecord | null> | null = null;
    const loadContact = () => {
      contact ??= this.contacts.findContact(a.recipientUserId);
      return contact;
    };

    const gate = await evaluateChannelGate({
      channelEnabled: a.channelEnabled,
      consents: () =>
        this.consent.allows({
          recipientUserId: a.recipientUserId,
          channel: a.channel,
          type: a.type,
          tenantId: a.audience.tenantId,
          studentMembershipId: a.data.studentId ?? null,
        }),
      hasProvider: adapter !== null,
      resolveAddresses: async () => {
        if (a.address === 'lookup')
          return this.addressesOf(a.channel, a.recipientUserId, loadContact);
        return a.address.given ? [a.address.given] : [];
      },
    });
    if (!gate.open) return { status: 'SKIPPED', provider: null, skipReason: gate.reason };
    // The gate already refused a channel without an adapter; this narrows the type.
    if (adapter === null) return { status: 'SKIPPED', provider: null, skipReason: 'no_provider' };

    const locale: Locale = (await loadContact())?.preferredLocale === 'hi' ? 'hi' : 'en';
    const copy = a.compose(locale);
    try {
      const result = await adapter.send({
        channel: a.channel,
        type: a.type,
        recipientUserId: a.recipientUserId,
        to: gate.addresses,
        subject: copy.subject,
        body: copy.body,
        data: a.data,
      });
      return {
        status: 'SENT',
        provider: adapter.provider,
        providerMessageId: result.providerMessageId ?? null,
      };
    } catch (err) {
      if (err instanceof ChannelAdapterError) {
        return { status: 'FAILED', provider: adapter.provider, errorCode: err.code };
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

/** Push data must be flat strings. */
export function toPushData(data: Record<string, string | number | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== null) out[key] = String(value);
  }
  return out;
}
