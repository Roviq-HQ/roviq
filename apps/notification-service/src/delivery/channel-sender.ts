import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import { senderBreakerName } from '@roviq/redis';
import type { ContactReadRepository } from '../repositories/contact-read.repository';
import type { NotificationWriteRepository } from '../repositories/notification-write.repository';
import type {
  Audience,
  ContactRecord,
  DeliveryOutcome,
  DeliveryRoute,
  MessagingSenderRecord,
} from '../repositories/types';
import type { NotificationMetrics } from '../telemetry/notification-metrics';
import type { Locale, OutsideCopy } from '../types/notification-type';
import type { AdapterErrorCode } from './adapters/adapter-errors';
import {
  type ChannelAdapter,
  ChannelAdapterError,
  type ChannelMessage,
} from './adapters/channel-adapter';
import type { ChannelAdapters } from './adapters/channel-adapters';
import { type DeferReason, evaluateChannelGate } from './channel-gate';
import type { ConsentGate } from './consent-gate';
import { adapterBreakerName, type ProviderBreaker } from './rate/provider-breaker';
import type { SenderRateLimiter } from './rate/sender-rate-limiter';
import { type SmsDraft, type SmsSend, SmsVariableError } from './sms/sms-template';
import type { WhatsAppRoute } from './whatsapp/whatsapp-route';
import type { TemplateSend } from './whatsapp/whatsapp-template';

export interface ChannelAttempt {
  type: NotificationTypeKey;
  channel: NotificationChannel;
  audience: Audience;
  recipientUserId: string;
  notificationId: string | null;
  /** The flow workflow that sent it; null for a secret type. Stored on the delivery row. */
  flowId: string | null;
  /** Institute setting for this channel; true for critical and secret types. */
  channelEnabled: boolean;
  /** Critical and secret types: quiet hours do not apply, and over a sender's cap they wait. */
  critical: boolean;
  /** A digest: when not critical it leaves the reserved share of a sender's rate to others. */
  digest: boolean;
  /**
   * False when the caller cannot wait: a deferral is then recorded as skipped (`sender_cap`
   * from the gate, else the reason it was held).
   */
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
  /** The registered SMS template for this message; null or absent when there is none. */
  sms?(locale: Locale): SmsDraft | null;
}

/** Not sent and not refused: the caller tries again at `until`. */
export interface DeferredAttempt {
  status: 'DEFERRED';
  until: Date;
  reason: DeferReason;
}

export type AttemptOutcome = DeliveryOutcome | DeferredAttempt;

/**
 * One attempt on one channel: gate, compose in the recipient's locale, send, and record exactly
 * one `notification_deliveries` row (a deferral writes one DEFERRED row per flow, recipient and
 * channel, however often it is retried). A provider failure becomes a FAILED
 * row; any other error (database, programming) propagates.
 */
export class ChannelSender {
  constructor(
    private readonly adapters: ChannelAdapters,
    private readonly consent: ConsentGate,
    private readonly contacts: ContactReadRepository,
    private readonly writes: NotificationWriteRepository,
    private readonly whatsapp: WhatsAppRoute,
    private readonly metrics: NotificationMetrics,
    private readonly rate: SenderRateLimiter,
    private readonly breaker: ProviderBreaker,
  ) {}

  async attempt(a: ChannelAttempt): Promise<AttemptOutcome> {
    const outcome = await this.run(a);
    if (outcome.status === 'DEFERRED') {
      await this.writes.recordDeferral({
        audience: a.audience,
        notificationId: a.notificationId,
        recipientUserId: a.recipientUserId,
        type: a.type,
        channel: a.channel,
        attempt: a.attempt,
        flowId: a.flowId,
        reason: outcome.reason,
      });
      this.metrics.deferred(a.channel, outcome.reason);
      return outcome;
    }
    await this.writes.recordDelivery({
      audience: a.audience,
      notificationId: a.notificationId,
      recipientUserId: a.recipientUserId,
      type: a.type,
      channel: a.channel,
      attempt: a.attempt,
      outcome,
      flowId: a.flowId,
    });
    this.metrics.delivery({
      channel: a.channel,
      status: outcome.status,
      provider: outcome.provider,
      reason:
        outcome.status === 'FAILED'
          ? outcome.errorCode
          : outcome.status === 'SKIPPED'
            ? outcome.skipReason
            : null,
    });
    return outcome;
  }

  private async run(a: ChannelAttempt): Promise<AttemptOutcome> {
    const adapters = this.adapters.list(a.channel);
    const needsTemplate = adapters.some((ad) => isRouted(ad) || ad.resolveSmsTemplate);
    const anyRouted = adapters.some(isRouted);
    const tenantId = a.audience.tenantId;
    let contact: Promise<ContactRecord | null> | null = null;
    const loadContact = () => {
      contact ??= this.contacts.findContact(a.recipientUserId);
      return contact;
    };
    const loadLocale = async (): Promise<Locale> =>
      (await loadContact())?.preferredLocale === 'hi' ? 'hi' : 'en';
    // Filled by the gate's checks, which run in order: provider, template, then the sender rules.
    const found: Found = { sender: null, template: null, withProvider: [], candidates: [] };
    // The sender rules apply to the first choice; a later routed choice is checked when reached.
    const firstSender = () => {
      const [first] = found.candidates;
      return first !== undefined && isRouted(first.adapter) ? found.sender : null;
    };

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
        if (anyRouted) found.sender = await this.whatsapp.resolveSender(tenantId);
        found.withProvider = adapters.filter((ad) => !isRouted(ad) || found.sender !== null);
        return found.withProvider.length > 0;
      },
      hasTemplate: needsTemplate
        ? async () => {
            const locale = await loadLocale();
            found.template = anyRouted ? (a.template?.(locale) ?? null) : null;
            const draft = adapters.some((ad) => ad.resolveSmsTemplate)
              ? smsDraftOf(a, locale)
              : null;
            found.candidates = found.withProvider.flatMap((ad) =>
              candidateOf(ad, found.template, draft),
            );
            return found.candidates.length > 0;
          }
        : undefined,
      resolveAddresses: async () => {
        if (a.address === 'lookup')
          return this.addressesOf(a.channel, a.recipientUserId, loadContact);
        return a.address.given ? [a.address.given] : [];
      },
      optedOut: anyRouted
        ? async ([phone]) => {
            const sender = firstSender();
            return sender !== null && phone !== undefined && this.whatsapp.optedOut(sender, phone);
          }
        : undefined,
      quietUntil: anyRouted
        ? async () =>
            firstSender() === null ? null : this.whatsapp.quietUntil(tenantId, a.critical)
        : undefined,
      capacity: anyRouted
        ? async () => {
            const sender = firstSender();
            return sender === null ? 'ok' : this.whatsapp.capacity(sender, tenantId, a.critical);
          }
        : undefined,
    });
    if (!gate.open) {
      if ('deferUntil' in gate) {
        return a.deferrable
          ? { status: 'DEFERRED', until: gate.deferUntil, reason: gate.deferReason }
          : { status: 'SKIPPED', provider: null, skipReason: 'sender_cap' };
      }
      return { status: 'SKIPPED', provider: null, skipReason: gate.reason };
    }
    if (!needsTemplate) {
      found.candidates = found.withProvider.map((adapter) => ({ adapter, sms: null }));
    }

    const copy = a.compose(await loadLocale());
    const message: ChannelMessage = {
      channel: a.channel,
      type: a.type,
      recipientUserId: a.recipientUserId,
      to: gate.addresses,
      subject: copy.subject,
      body: copy.body,
      data: a.data,
    };
    const [phone] = gate.addresses;
    const routed =
      found.sender !== null && found.template !== null && phone !== undefined
        ? { sender: found.sender, template: found.template, phone }
        : null;
    return this.sendThrough(a, found.candidates, message, routed);
  }

  /**
   * Tries each provider in order; moves on only when the one before cannot send now. A held
   * provider (paused breaker) is passed over; when nothing was sent, a hold defers the attempt.
   */
  private async sendThrough(
    a: ChannelAttempt,
    candidates: readonly Candidate[],
    message: ChannelMessage,
    routed: Routed | null,
  ): Promise<AttemptOutcome> {
    let failed: FailedOutcome | null = null;
    let held: Hold | null = null;
    for (const [index, { adapter, sms }] of candidates.entries()) {
      if (sms === 'unsendable') return variableTooLong(adapter);
      const tried = isRouted(adapter)
        ? await this.sendRouted(adapter, message, a, routed, index === 0)
        : await this.sendGuarded(adapter, message, sms);
      if (tried === null) continue;
      if ('hold' in tried) {
        // A full sender is not a reason to try another provider.
        if (tried.hold.reason === 'rate_limited') return this.heldOutcome(a, tried.hold);
        held = earlier(held, tried.hold);
        continue;
      }
      if (tried.outcome.status === 'SENT' || !tried.unavailable) return tried.outcome;
      failed = tried.outcome;
    }
    // A deferral spends no attempt, so it is preferred over a failure.
    if (held !== null) return this.heldOutcome(a, held);
    // The gate already refused a channel without a provider.
    return failed ?? { status: 'SKIPPED', provider: null, skipReason: 'no_provider' };
  }

  private heldOutcome(a: ChannelAttempt, hold: Hold): AttemptOutcome {
    return a.deferrable
      ? { status: 'DEFERRED', until: hold.until, reason: hold.reason }
      : { status: 'SKIPPED', provider: null, skipReason: hold.reason };
  }

  /** Null when the sender may not be used for this message. */
  private async sendRouted(
    adapter: ChannelAdapter,
    message: ChannelMessage,
    a: ChannelAttempt,
    routed: Routed | null,
    gated: boolean,
  ): Promise<Tried | null> {
    if (routed === null) return null;
    const { sender, template, phone } = routed;
    if (!gated && !(await this.senderUsable(sender, phone, a, true))) return null;
    const tried = await this.sendViaSender(adapter, message, a, sender, template, phone);
    const fallBack = 'hold' in tried ? tried.hold.reason === 'provider_paused' : tried.unavailable;
    if (!fallBack) return tried;
    // One official provider: the platform's number is the failover for an institute's own.
    const platform = await this.whatsapp.fallbackFor(sender);
    if (platform === null || !(await this.senderUsable(platform, phone, a, false))) return tried;
    return this.sendViaSender(adapter, message, a, platform, template, phone);
  }

  /** A sender reached by failover passes the same per-sender rules the gate applies. */
  private async senderUsable(
    sender: MessagingSenderRecord,
    phone: string,
    a: ChannelAttempt,
    quietHours: boolean,
  ): Promise<boolean> {
    const tenantId = a.audience.tenantId;
    if (await this.whatsapp.optedOut(sender, phone)) return false;
    if (quietHours && (await this.whatsapp.quietUntil(tenantId, a.critical)) !== null) return false;
    return (await this.whatsapp.capacity(sender, tenantId, a.critical)) === 'ok';
  }

  /** One send through one sender: its rate, then its breaker, then the provider. */
  private async sendViaSender(
    adapter: ChannelAdapter,
    message: ChannelMessage,
    a: ChannelAttempt,
    sender: MessagingSenderRecord,
    template: TemplateSend,
    phone: string,
  ): Promise<Tried> {
    const token = await this.rate.take({
      senderId: sender.id,
      messagesPerSecond: sender.messagesPerSecond,
      phone,
      reserve: a.digest && !a.critical,
    });
    if (!token.ok) return { hold: { reason: 'rate_limited', until: token.retryAt } };
    const name = senderBreakerName(sender.id);
    const allowed = await this.breaker.allow(name);
    if (!allowed.ok) return { hold: { reason: 'provider_paused', until: allowed.retryAt } };

    const tried = await this.sendOnce(adapter, message, null, { sender, template });
    if (tried.outcome.status === 'FAILED' && tried.outcome.errorCode === 'WA_RATE_LIMITED') {
      const until = await this.rate.throttle(
        sender.id,
        sender.messagesPerSecond,
        tried.retryAfterMs,
      );
      // The provider answered, so it is reachable.
      await this.breaker.succeeded(name);
      // A caller that cannot wait keeps the FAILED row and the failover to the platform's sender.
      return a.deferrable ? { hold: { reason: 'rate_limited', until } } : tried;
    }
    await this.recordHealth(name, adapter, tried);
    if (tried.outcome.status === 'FAILED' && tried.outcome.errorCode === 'WA_SENDER_BLOCKED') {
      await this.whatsapp.block(sender);
    }
    return tried;
  }

  /** A provider of a channel without senders, behind its breaker. */
  private async sendGuarded(
    adapter: ChannelAdapter,
    message: ChannelMessage,
    sms: SmsSend | null,
  ): Promise<Tried> {
    const name = adapterBreakerName(adapter.channel, adapter.provider);
    const allowed = await this.breaker.allow(name);
    if (!allowed.ok) return { hold: { reason: 'provider_paused', until: allowed.retryAt } };
    const tried = await this.sendOnce(adapter, message, sms, null);
    await this.recordHealth(name, adapter, tried);
    return tried;
  }

  /** Only "cannot send now" counts against a breaker; a blocked sender opens it at once. */
  private async recordHealth(name: string, adapter: ChannelAdapter, tried: Sent): Promise<void> {
    const { outcome } = tried;
    if (outcome.status === 'SENT' || !tried.unavailable) {
      await this.breaker.succeeded(name);
      return;
    }
    const opened = BLOCKED_CODES.has(outcome.errorCode)
      ? await this.breaker.trip(name)
      : await this.breaker.failed(name);
    if (opened) this.metrics.breakerOpened(adapter.channel, adapter.provider, outcome.errorCode);
  }

  private async sendOnce(
    adapter: ChannelAdapter,
    message: ChannelMessage,
    sms: SmsSend | null,
    via: { sender: MessagingSenderRecord; template: TemplateSend } | null,
  ): Promise<Sent> {
    const route = via === null ? null : routeOf(via.sender, via.template);
    const started = performance.now();
    try {
      const result = await adapter.send({
        ...message,
        ...(route ? { route: route.message } : {}),
        ...(sms ? { sms } : {}),
      });
      return {
        outcome: {
          status: 'SENT',
          provider: adapter.provider,
          providerMessageId: result.providerMessageId ?? null,
          ...(route ? { route: route.stored } : {}),
        },
        unavailable: false,
        retryAfterMs: null,
      };
    } catch (err) {
      if (err instanceof ChannelAdapterError) {
        return {
          outcome: {
            status: 'FAILED',
            provider: adapter.provider,
            errorCode: err.code,
            retryable: err.retryable,
            ...(route ? { route: route.stored } : {}),
          },
          unavailable: err.kind === 'provider_unavailable',
          retryAfterMs: err.retryAfterMs,
        };
      }
      throw err;
    } finally {
      this.metrics.providerCall(message.channel, adapter.provider, performance.now() - started);
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

type SentOutcome = Extract<DeliveryOutcome, { status: 'SENT' }>;
type FailedOutcome = Extract<DeliveryOutcome, { status: 'FAILED' }>;

/** A provider call and its answer. */
interface Sent {
  outcome: SentOutcome | FailedOutcome;
  /** True when the provider could not send now, so the next one may take the attempt. */
  unavailable: boolean;
  /** The provider's `Retry-After` on a failure; null when it gave none. */
  retryAfterMs: number | null;
}

/** Not sent and not failed: the sender is full or the provider is paused until `until`. */
interface Hold {
  reason: Extract<DeferReason, 'rate_limited' | 'provider_paused'>;
  until: Date;
}

type Tried = Sent | { hold: Hold };

const earlier = (known: Hold | null, next: Hold): Hold =>
  known === null || next.until < known.until ? next : known;

/** The provider says the sender or account may not send: its breaker opens at once. */
const BLOCKED_CODES: ReadonlySet<string> = new Set<AdapterErrorCode>([
  'WA_SENDER_BLOCKED',
  'SMS_SENDER_BLOCKED',
]);

interface Routed {
  sender: MessagingSenderRecord;
  template: TemplateSend;
  phone: string;
}

interface Found {
  sender: MessagingSenderRecord | null;
  template: TemplateSend | null;
  withProvider: ChannelAdapter[];
  candidates: Candidate[];
}

interface Candidate {
  adapter: ChannelAdapter;
  /** The registered SMS template; `unsendable` when the draft cannot be sent as registered. */
  sms: SmsSend | null | 'unsendable';
}

const isRouted = (adapter: ChannelAdapter) => adapter.usesSenders === true;

function smsDraftOf(a: ChannelAttempt, locale: Locale): SmsDraft | null | 'unsendable' {
  try {
    return a.sms?.(locale) ?? null;
  } catch (err) {
    if (!(err instanceof SmsVariableError)) throw err;
    // Not a missing template: the message exists but cannot be sent as registered.
    return 'unsendable';
  }
}

/** The provider as a candidate for this message, or none: an SMS one needs a registered template. */
function candidateOf(
  adapter: ChannelAdapter,
  template: TemplateSend | null,
  draft: SmsDraft | null | 'unsendable',
): Candidate[] {
  if (isRouted(adapter)) return template === null ? [] : [{ adapter, sms: null }];
  if (!adapter.resolveSmsTemplate) return [{ adapter, sms: null }];
  if (draft === 'unsendable') return [{ adapter, sms: 'unsendable' }];
  const sms = draft === null ? null : adapter.resolveSmsTemplate(draft);
  return sms === null ? [] : [{ adapter, sms }];
}

function variableTooLong(adapter: ChannelAdapter): FailedOutcome {
  const errorCode: AdapterErrorCode = 'SMS_VARIABLE_TOO_LONG';
  return { status: 'FAILED', provider: adapter.provider, errorCode, retryable: false };
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
