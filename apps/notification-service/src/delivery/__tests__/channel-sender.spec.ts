import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ContactReadRepository } from '../../repositories/contact-read.repository';
import { NotificationWriteRepository } from '../../repositories/notification-write.repository';
import type { MessagingSenderRecord } from '../../repositories/types';
import type { NotificationMetrics } from '../../telemetry/notification-metrics';
import { type ChannelAdapter, ChannelAdapterError } from '../adapters/channel-adapter';
import { ChannelAdapters } from '../adapters/channel-adapters';
import { LogChannelAdapter } from '../adapters/log.adapter';
import { type ChannelAttempt, ChannelSender } from '../channel-sender';
import type { ConsentGate } from '../consent-gate';
import type { ProviderBreaker } from '../rate/provider-breaker';
import type { SenderRateLimiter } from '../rate/sender-rate-limiter';
import type { SmsDraft } from '../sms/sms-template';
import { WhatsAppRoute } from '../whatsapp/whatsapp-route';
import type { TemplateSend } from '../whatsapp/whatsapp-template';

const INSTITUTE = {
  scope: 'institute',
  tenantId: '019a0000-0000-7000-8000-000000000001',
  resellerId: null,
} as const;

const PLATFORM_SENDER: MessagingSenderRecord = {
  id: 'sender-platform',
  scope: 'platform',
  tenantId: null,
  status: 'ACTIVE',
  providerNumberId: 'number-platform',
  dailyCap: 1000,
  instituteDailyCap: 100,
  messagesPerSecond: 10,
  accessTokenEncrypted: Buffer.from('fake-encrypted-platform-token'),
};

const SENDER: MessagingSenderRecord = {
  id: 'sender-1',
  scope: 'institute',
  tenantId: INSTITUTE.tenantId,
  status: 'ACTIVE',
  providerNumberId: 'number-1',
  dailyCap: 1000,
  instituteDailyCap: null,
  messagesPerSecond: 10,
  accessTokenEncrypted: Buffer.from('fake-encrypted-token'),
};

function templateIn(locale: 'en' | 'hi'): TemplateSend {
  return {
    name: 'fee_reminder_v1',
    languageCode: locale,
    category: 'UTILITY',
    bodyVariables: ['Aarav', '₹5,000'],
    buttonPath: 'institute/fees',
  };
}

function attempt(overrides: Partial<ChannelAttempt> = {}): ChannelAttempt {
  return {
    type: 'FEE_REMINDER',
    channel: 'EMAIL',
    audience: INSTITUTE,
    recipientUserId: 'user-guardian-1',
    notificationId: 'notification-1',
    flowId: 'notification-flow:key-1',
    channelEnabled: true,
    critical: false,
    digest: false,
    deferrable: true,
    attempt: 1,
    address: 'lookup',
    data: { path: '/institute/dashboard' },
    compose: (locale) => ({ subject: `subject-${locale}`, body: `body-${locale}` }),
    ...overrides,
  };
}

describe('ChannelSender', () => {
  let send: Mock<ChannelAdapter['send']>;
  let email: ChannelAdapter;
  let contacts: ReturnType<typeof createMock<ContactReadRepository>>;
  let writes: ReturnType<typeof createMock<NotificationWriteRepository>>;
  let route: ReturnType<typeof createMock<WhatsAppRoute>>;
  let metrics: ReturnType<typeof createMock<NotificationMetrics>>;
  let rate: ReturnType<typeof createMock<SenderRateLimiter>>;
  let breaker: ReturnType<typeof createMock<ProviderBreaker>>;
  let sender: ChannelSender;

  beforeEach(() => {
    metrics = createMock<NotificationMetrics>();
    rate = createMock<SenderRateLimiter>({
      take: vi.fn().mockResolvedValue({ ok: true }),
      throttle: vi.fn().mockResolvedValue(new Date('2026-11-24T10:00:02.000Z')),
    });
    breaker = createMock<ProviderBreaker>({
      allow: vi.fn().mockResolvedValue({ ok: true }),
      succeeded: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(false),
      trip: vi.fn().mockResolvedValue(true),
    });
    send = vi.fn<ChannelAdapter['send']>().mockResolvedValue({ providerMessageId: 'smtp-1' });
    email = { channel: 'EMAIL', provider: 'smtp', send };
    contacts = createMock<ContactReadRepository>({
      findContact: vi.fn().mockResolvedValue({
        email: 'guardian@example.in',
        phone: '+919000000001',
        preferredLocale: 'hi',
      }),
      findDeviceTokens: vi.fn().mockResolvedValue([]),
    });
    writes = createMock<NotificationWriteRepository>({
      recordDelivery: vi.fn().mockResolvedValue(undefined),
      recordDeferral: vi.fn().mockResolvedValue(undefined),
    });
    route = createMock<WhatsAppRoute>({
      resolveSender: vi.fn().mockResolvedValue(SENDER),
      optedOut: vi.fn().mockResolvedValue(false),
      quietUntil: vi.fn().mockResolvedValue(null),
      capacity: vi.fn().mockResolvedValue('ok'),
      fallbackFor: vi.fn().mockResolvedValue(null),
      block: vi.fn().mockResolvedValue(true),
    });
    sender = new ChannelSender(
      new ChannelAdapters([email]),
      createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
      contacts,
      writes,
      route,
      metrics,
      rate,
      breaker,
    );
  });

  it('should send in the recipient locale and record one SENT row', async () => {
    const outcome = await sender.attempt(attempt());

    expect(send).toHaveBeenCalledWith({
      channel: 'EMAIL',
      type: 'FEE_REMINDER',
      recipientUserId: 'user-guardian-1',
      to: ['guardian@example.in'],
      subject: 'subject-hi',
      body: 'body-hi',
      data: { path: '/institute/dashboard' },
    });
    expect(outcome).toEqual({ status: 'SENT', provider: 'smtp', providerMessageId: 'smtp-1' });
    expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
    expect(writes.recordDelivery).toHaveBeenCalledWith({
      audience: INSTITUTE,
      notificationId: 'notification-1',
      recipientUserId: 'user-guardian-1',
      type: 'FEE_REMINDER',
      channel: 'EMAIL',
      attempt: 1,
      outcome: { status: 'SENT', provider: 'smtp', providerMessageId: 'smtp-1' },
      flowId: 'notification-flow:key-1',
    });
  });

  it('should count the SENT row and time the provider call', async () => {
    await sender.attempt(attempt());

    expect(metrics.delivery).toHaveBeenCalledTimes(1);
    expect(metrics.delivery).toHaveBeenCalledWith({
      channel: 'EMAIL',
      status: 'SENT',
      provider: 'smtp',
      reason: null,
    });
    expect(metrics.providerCall).toHaveBeenCalledTimes(1);
    expect(metrics.providerCall).toHaveBeenCalledWith('EMAIL', 'smtp', expect.any(Number));
    expect(metrics.deferred).not.toHaveBeenCalled();
  });

  it('should count a FAILED row with its error code and still time the call', async () => {
    send.mockRejectedValue(new ChannelAdapterError('EAUTH_535', 'auth failed'));

    await sender.attempt(attempt());

    expect(metrics.delivery).toHaveBeenCalledWith({
      channel: 'EMAIL',
      status: 'FAILED',
      provider: 'smtp',
      reason: 'EAUTH_535',
    });
    expect(metrics.providerCall).toHaveBeenCalledTimes(1);
  });

  it('should count a SKIPPED row with its reason and make no provider call', async () => {
    await sender.attempt(attempt({ channelEnabled: false }));

    expect(metrics.delivery).toHaveBeenCalledWith({
      channel: 'EMAIL',
      status: 'SKIPPED',
      provider: null,
      reason: 'channel_disabled',
    });
    expect(metrics.providerCall).not.toHaveBeenCalled();
  });

  it('should record channel_disabled without calling the adapter', async () => {
    const outcome = await sender.attempt(attempt({ channelEnabled: false }));

    expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'channel_disabled' });
    expect(send).not.toHaveBeenCalled();
    expect(contacts.findContact).not.toHaveBeenCalled();
  });

  it('should record no_consent when the consent gate refuses', async () => {
    const consent = createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(false) });
    sender = new ChannelSender(
      new ChannelAdapters([email]),
      consent,
      contacts,
      writes,
      route,
      metrics,
      rate,
      breaker,
    );

    const outcome = await sender.attempt(attempt());

    expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_consent' });
    expect(consent.allows).toHaveBeenCalledWith({
      recipientUserId: 'user-guardian-1',
      channel: 'EMAIL',
      type: 'FEE_REMINDER',
      tenantId: INSTITUTE.tenantId,
      studentMembershipId: null,
    });
  });

  it('should record no_provider for a channel without an adapter', async () => {
    const outcome = await sender.attempt(attempt({ channel: 'WHATSAPP' }));

    expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_provider' });
  });

  it('should record no_address when a secret event names no address', async () => {
    const outcome = await sender.attempt(attempt({ address: { given: null } }));

    expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_address' });
    expect(send).not.toHaveBeenCalled();
  });

  it('should send only to the address a secret event names', async () => {
    await sender.attempt(attempt({ address: { given: 'new-address@example.in' } }));

    expect(send.mock.calls.map(([m]) => m.to)).toEqual([['new-address@example.in']]);
  });

  it('should record a provider failure as FAILED with its code', async () => {
    send.mockRejectedValue(new ChannelAdapterError('ECONNECTION', 'connect refused'));

    const outcome = await sender.attempt(attempt({ attempt: 2 }));

    expect(outcome).toEqual({
      status: 'FAILED',
      provider: 'smtp',
      errorCode: 'ECONNECTION',
      retryable: true,
    });
    expect(writes.recordDelivery).toHaveBeenCalledWith({
      audience: INSTITUTE,
      notificationId: 'notification-1',
      recipientUserId: 'user-guardian-1',
      type: 'FEE_REMINDER',
      channel: 'EMAIL',
      attempt: 2,
      outcome: { status: 'FAILED', provider: 'smtp', errorCode: 'ECONNECTION', retryable: true },
      flowId: 'notification-flow:key-1',
    });
  });

  it('should let a non-provider error propagate without a row', async () => {
    send.mockRejectedValue(new TypeError('bug'));

    await expect(sender.attempt(attempt())).rejects.toThrow('bug');
    expect(writes.recordDelivery).not.toHaveBeenCalled();
  });

  it('should not consult the WhatsApp rules for an adapter without senders', async () => {
    await sender.attempt(attempt({ template: templateIn }));

    expect(route.resolveSender).not.toHaveBeenCalled();
    expect(route.optedOut).not.toHaveBeenCalled();
    expect(route.quietUntil).not.toHaveBeenCalled();
    expect(route.capacity).not.toHaveBeenCalled();
  });

  it('should not consult the WhatsApp rules for the log adapter on WhatsApp', async () => {
    sender = new ChannelSender(
      new ChannelAdapters([new LogChannelAdapter('WHATSAPP')]),
      createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
      contacts,
      writes,
      route,
      metrics,
      rate,
      breaker,
    );

    const outcome = await sender.attempt(attempt({ channel: 'WHATSAPP', template: templateIn }));

    expect(outcome.status).toBe('SENT');
    expect(route.resolveSender).not.toHaveBeenCalled();
    expect(route.optedOut).not.toHaveBeenCalled();
    expect(route.quietUntil).not.toHaveBeenCalled();
    expect(route.capacity).not.toHaveBeenCalled();
  });

  describe('an adapter that sends through senders', () => {
    let whatsappSend: Mock<ChannelAdapter['send']>;
    let template: Mock<NonNullable<ChannelAttempt['template']>>;

    const whatsappAttempt = (overrides: Partial<ChannelAttempt> = {}) =>
      attempt({ channel: 'WHATSAPP', template, ...overrides });

    beforeEach(() => {
      whatsappSend = vi.fn<ChannelAdapter['send']>().mockResolvedValue({
        providerMessageId: 'wamid.fake-1',
      });
      template = vi.fn<NonNullable<ChannelAttempt['template']>>(templateIn);
      sender = new ChannelSender(
        new ChannelAdapters([
          {
            channel: 'WHATSAPP',
            provider: 'whatsapp_cloud',
            usesSenders: true,
            send: whatsappSend,
          },
        ]),
        createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
        contacts,
        writes,
        route,
        metrics,
        rate,
        breaker,
      );
    });

    it('should skip as no_provider without an active sender and look nothing else up', async () => {
      route.resolveSender.mockResolvedValue(null);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_provider' });
      expect(route.resolveSender).toHaveBeenCalledWith(INSTITUTE.tenantId);
      expect(template).not.toHaveBeenCalled();
      expect(contacts.findContact).not.toHaveBeenCalled();
      expect(whatsappSend).not.toHaveBeenCalled();
    });

    it('should skip as no_template when the type has no approved template', async () => {
      template.mockReturnValue(null);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_template' });
      expect(whatsappSend).not.toHaveBeenCalled();
    });

    it('should skip as no_template when the attempt carries no template callback', async () => {
      const outcome = await sender.attempt(whatsappAttempt({ template: undefined }));

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_template' });
    });

    it('should skip as opted_out for the first phone without calling the adapter', async () => {
      route.optedOut.mockResolvedValue(true);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'opted_out' });
      expect(route.optedOut).toHaveBeenCalledWith(SENDER, '+919000000001');
      expect(whatsappSend).not.toHaveBeenCalled();
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
    });

    it('should defer through quiet hours and record one deferral, not a delivery', async () => {
      const until = new Date('2026-11-24T01:30:00.000Z');
      route.quietUntil.mockResolvedValue(until);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'DEFERRED', until, reason: 'quiet_hours' });
      expect(route.quietUntil).toHaveBeenCalledWith(INSTITUTE.tenantId, false);
      expect(route.capacity).not.toHaveBeenCalled();
      expect(whatsappSend).not.toHaveBeenCalled();
      expect(writes.recordDelivery).not.toHaveBeenCalled();
      expect(writes.recordDeferral).toHaveBeenCalledTimes(1);
      expect(writes.recordDeferral).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'WHATSAPP',
        attempt: 1,
        flowId: 'notification-flow:key-1',
        reason: 'quiet_hours',
      });
      expect(metrics.deferred).toHaveBeenCalledWith('WHATSAPP', 'quiet_hours');
      expect(metrics.delivery).not.toHaveBeenCalled();
    });

    it.each([
      ['quiet hours', 'quietUntil'],
      ['a full sender', 'capacity'],
    ] as const)('should record sender_cap instead of deferring through %s on the last try', async (_case, check) => {
      const until = new Date('2026-11-24T01:30:00.000Z');
      if (check === 'quietUntil') route.quietUntil.mockResolvedValue(until);
      else route.capacity.mockResolvedValue({ deferUntil: until });

      const outcome = await sender.attempt(whatsappAttempt({ deferrable: false }));

      const expected = { status: 'SKIPPED', provider: null, skipReason: 'sender_cap' };
      expect(outcome).toEqual(expected);
      expect(whatsappSend).not.toHaveBeenCalled();
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
      expect(writes.recordDeferral).not.toHaveBeenCalled();
      expect(writes.recordDelivery).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'WHATSAPP',
        attempt: 1,
        outcome: expected,
        flowId: 'notification-flow:key-1',
      });
    });

    it('should skip as sender_cap when the sender is over its cap', async () => {
      route.capacity.mockResolvedValue('over');

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'sender_cap' });
      expect(route.capacity).toHaveBeenCalledWith(SENDER, INSTITUTE.tenantId, false);
      expect(whatsappSend).not.toHaveBeenCalled();
    });

    it('should defer a critical message over the cap and record a sender_cap deferral', async () => {
      const until = new Date('2026-11-23T11:00:00.000Z');
      route.capacity.mockResolvedValue({ deferUntil: until });

      const outcome = await sender.attempt(whatsappAttempt({ critical: true }));

      expect(outcome).toEqual({ status: 'DEFERRED', until, reason: 'sender_cap' });
      expect(route.quietUntil).toHaveBeenCalledWith(INSTITUTE.tenantId, true);
      expect(route.capacity).toHaveBeenCalledWith(SENDER, INSTITUTE.tenantId, true);
      expect(writes.recordDelivery).not.toHaveBeenCalled();
      expect(writes.recordDeferral).toHaveBeenCalledTimes(1);
      expect(writes.recordDeferral).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'WHATSAPP',
        attempt: 1,
        flowId: 'notification-flow:key-1',
        reason: 'sender_cap',
      });
    });

    it('should send once through the sender and template and record the route', async () => {
      const outcome = await sender.attempt(whatsappAttempt());

      expect(whatsappSend).toHaveBeenCalledTimes(1);
      expect(whatsappSend).toHaveBeenCalledWith({
        channel: 'WHATSAPP',
        type: 'FEE_REMINDER',
        recipientUserId: 'user-guardian-1',
        to: ['+919000000001'],
        subject: 'subject-hi',
        body: 'body-hi',
        data: { path: '/institute/dashboard' },
        route: { sender: SENDER, template: templateIn('hi') },
      });
      const expected = {
        status: 'SENT',
        provider: 'whatsapp_cloud',
        providerMessageId: 'wamid.fake-1',
        route: { senderId: 'sender-1', templateCategory: 'UTILITY' },
      };
      expect(outcome).toEqual(expected);
      expect(writes.recordDelivery).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'WHATSAPP',
        attempt: 1,
        outcome: expected,
        flowId: 'notification-flow:key-1',
      });
    });

    it('should record a refusal that would repeat as FAILED, not retryable, with the route', async () => {
      whatsappSend.mockRejectedValue(
        new ChannelAdapterError('WA_TEMPLATE_REJECTED', 'provider code 132001', false),
      );

      const outcome = await sender.attempt(whatsappAttempt());

      const expected = {
        status: 'FAILED',
        provider: 'whatsapp_cloud',
        errorCode: 'WA_TEMPLATE_REJECTED',
        retryable: false,
        route: { senderId: 'sender-1', templateCategory: 'UTILITY' },
      };
      expect(outcome).toEqual(expected);
      expect(writes.recordDelivery).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'WHATSAPP',
        attempt: 1,
        outcome: expected,
        flowId: 'notification-flow:key-1',
      });
    });

    it.each([
      ['hi', 'hi'],
      ['en', 'en'],
      ['ta', 'en'],
      [null, 'en'],
    ] as const)('should ask for the template in the locale of preference %s as %s', async (preferred, locale) => {
      contacts.findContact.mockResolvedValue({
        email: 'guardian@example.in',
        phone: '+919000000001',
        preferredLocale: preferred,
      });

      await sender.attempt(whatsappAttempt());

      expect(template.mock.calls).toEqual([[locale]]);
    });
  });

  describe('failover between the providers of one channel', () => {
    const DRAFT: SmsDraft = {
      registrationKey: 'FEE_REMINDER:hi',
      variables: ['Aarav'],
      unicode: false,
    };
    let firstSend: Mock<ChannelAdapter['send']>;
    let secondSend: Mock<ChannelAdapter['send']>;
    let first: ChannelAdapter;
    let second: ChannelAdapter;

    const smsAttempt = (overrides: Partial<ChannelAttempt> = {}) =>
      attempt({ channel: 'SMS', ...overrides });
    const senderOf = (adapters: ChannelAdapters) =>
      new ChannelSender(
        adapters,
        createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
        contacts,
        writes,
        route,
        metrics,
        rate,
        breaker,
      );

    beforeEach(() => {
      firstSend = vi
        .fn<ChannelAdapter['send']>()
        .mockResolvedValue({ providerMessageId: 'first-1' });
      secondSend = vi
        .fn<ChannelAdapter['send']>()
        .mockResolvedValue({ providerMessageId: 'second-1' });
      first = { channel: 'SMS', provider: 'first', send: firstSend };
      second = { channel: 'SMS', provider: 'second', send: secondSend };
      sender = senderOf(new ChannelAdapters([first, second]));
    });

    it('should send the same attempt through the second provider when the first is unreachable', async () => {
      firstSend.mockRejectedValue(new ChannelAdapterError('SMS_UNREACHABLE', 'request failed'));

      const outcome = await sender.attempt(smsAttempt());

      const expected = { status: 'SENT', provider: 'second', providerMessageId: 'second-1' };
      expect(outcome).toEqual(expected);
      expect(firstSend).toHaveBeenCalledTimes(1);
      expect(secondSend).toHaveBeenCalledTimes(1);
      expect(secondSend.mock.calls[0]?.[0]).toEqual(firstSend.mock.calls[0]?.[0]);
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
      expect(writes.recordDelivery).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'SMS',
        attempt: 1,
        outcome: expected,
        flowId: 'notification-flow:key-1',
      });
    });

    it('should not fail over a refusal of the message and record one FAILED row naming the first', async () => {
      firstSend.mockRejectedValue(new ChannelAdapterError('SMS_INVALID_NUMBER', 'http 200', false));

      const outcome = await sender.attempt(smsAttempt());

      const expected = {
        status: 'FAILED',
        provider: 'first',
        errorCode: 'SMS_INVALID_NUMBER',
        retryable: false,
      };
      expect(outcome).toEqual(expected);
      expect(secondSend).not.toHaveBeenCalled();
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
      expect(writes.recordDelivery.mock.calls[0]?.[0].outcome).toEqual(expected);
    });

    it('should record one retryable FAILED row naming the last provider when none can send', async () => {
      firstSend.mockRejectedValue(new ChannelAdapterError('SMS_UNREACHABLE', 'request failed'));
      secondSend.mockRejectedValue(new ChannelAdapterError('SMS_RATE_LIMITED', 'http 429'));

      const outcome = await sender.attempt(smsAttempt());

      const expected = {
        status: 'FAILED',
        provider: 'second',
        errorCode: 'SMS_RATE_LIMITED',
        retryable: true,
      };
      expect(outcome).toEqual(expected);
      expect(firstSend).toHaveBeenCalledTimes(1);
      expect(secondSend).toHaveBeenCalledTimes(1);
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
      expect(writes.recordDelivery.mock.calls[0]?.[0].outcome).toEqual(expected);
    });

    it('should pass over a provider that has no registered template for one that has', async () => {
      first = { ...first, resolveSmsTemplate: () => null };
      second = {
        ...second,
        resolveSmsTemplate: (draft) => ({ ...draft, templateId: 'reg-second-1' }),
      };
      sender = senderOf(new ChannelAdapters([first, second]));

      const outcome = await sender.attempt(smsAttempt({ sms: () => DRAFT }));

      expect(outcome).toEqual({
        status: 'SENT',
        provider: 'second',
        providerMessageId: 'second-1',
      });
      expect(firstSend).not.toHaveBeenCalled();
      expect(secondSend.mock.calls[0]?.[0].sms).toEqual({ ...DRAFT, templateId: 'reg-second-1' });
    });

    it('should send each provider its own registered template', async () => {
      first = {
        ...first,
        resolveSmsTemplate: (draft) => ({ ...draft, templateId: 'reg-first-1' }),
      };
      second = {
        ...second,
        resolveSmsTemplate: (draft) => ({ ...draft, templateId: 'reg-second-1' }),
      };
      firstSend.mockRejectedValue(new ChannelAdapterError('SMS_SENDER_BLOCKED', 'http 401', false));
      sender = senderOf(new ChannelAdapters([first, second]));

      await sender.attempt(smsAttempt({ sms: () => DRAFT }));

      expect(firstSend.mock.calls[0]?.[0].sms?.templateId).toBe('reg-first-1');
      expect(secondSend.mock.calls[0]?.[0].sms?.templateId).toBe('reg-second-1');
    });

    it('should skip as no_template when no provider has a registered template', async () => {
      first = { ...first, resolveSmsTemplate: () => null };
      second = { ...second, resolveSmsTemplate: () => null };
      sender = senderOf(new ChannelAdapters([first, second]));

      const outcome = await sender.attempt(smsAttempt({ sms: () => DRAFT }));

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_template' });
      expect(firstSend).not.toHaveBeenCalled();
      expect(secondSend).not.toHaveBeenCalled();
    });

    it('should leave out a provider whose breaker is open', async () => {
      breaker.allow.mockImplementation(async (name: string) =>
        name === 'adapter:SMS:first'
          ? { ok: false, retryAt: new Date('2026-11-24T10:01:00.000Z') }
          : { ok: true },
      );
      sender = senderOf(new ChannelAdapters([first, second]));

      const outcome = await sender.attempt(smsAttempt());

      expect(outcome).toEqual({
        status: 'SENT',
        provider: 'second',
        providerMessageId: 'second-1',
      });
      expect(firstSend).not.toHaveBeenCalled();
    });

    it('should defer as provider_paused until the earliest breaker ends when every provider is open', async () => {
      breaker.allow.mockImplementation(async (name: string) => ({
        ok: false,
        retryAt: new Date(
          name === 'adapter:SMS:first' ? '2026-11-24T10:01:00.000Z' : '2026-11-24T10:00:30.000Z',
        ),
      }));
      sender = senderOf(new ChannelAdapters([first, second]));

      const outcome = await sender.attempt(smsAttempt());

      expect(outcome).toEqual({
        status: 'DEFERRED',
        until: new Date('2026-11-24T10:00:30.000Z'),
        reason: 'provider_paused',
      });
      expect(firstSend).not.toHaveBeenCalled();
      expect(secondSend).not.toHaveBeenCalled();
      expect(writes.recordDelivery).not.toHaveBeenCalled();
      expect(writes.recordDeferral).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'SMS',
        attempt: 1,
        flowId: 'notification-flow:key-1',
        reason: 'provider_paused',
      });
    });

    it('should skip as provider_paused when every provider is open and the caller cannot wait', async () => {
      breaker.allow.mockResolvedValue({ ok: false, retryAt: new Date('2026-11-24T10:01:00.000Z') });

      const outcome = await sender.attempt(smsAttempt({ deferrable: false }));

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'provider_paused' });
      expect(writes.recordDeferral).not.toHaveBeenCalled();
    });

    it('should count an unreachable answer against the breaker and report it when it opens', async () => {
      firstSend.mockRejectedValue(new ChannelAdapterError('SMS_UNREACHABLE', 'http 503'));
      breaker.failed.mockResolvedValue(true);

      await sender.attempt(smsAttempt());

      expect(breaker.failed).toHaveBeenCalledWith('adapter:SMS:first');
      expect(breaker.succeeded).toHaveBeenCalledWith('adapter:SMS:second');
      expect(metrics.breakerOpened).toHaveBeenCalledWith('SMS', 'first', 'SMS_UNREACHABLE');
    });

    it('should open the breaker at once when the provider blocks the SMS sender', async () => {
      firstSend.mockRejectedValue(
        new ChannelAdapterError('SMS_SENDER_BLOCKED', 'suspended', false),
      );

      await sender.attempt(smsAttempt());

      expect(breaker.trip).toHaveBeenCalledWith('adapter:SMS:first');
      expect(breaker.failed).not.toHaveBeenCalled();
      expect(metrics.breakerOpened).toHaveBeenCalledWith('SMS', 'first', 'SMS_SENDER_BLOCKED');
    });

    it('should count a refused message as an answer, not against the breaker', async () => {
      firstSend.mockRejectedValue(new ChannelAdapterError('SMS_INVALID_NUMBER', 'bad', false));

      await sender.attempt(smsAttempt());

      expect(breaker.succeeded).toHaveBeenCalledWith('adapter:SMS:first');
      expect(breaker.failed).not.toHaveBeenCalled();
      expect(breaker.trip).not.toHaveBeenCalled();
    });
  });

  describe("an institute's own WhatsApp sender that cannot send", () => {
    let whatsappSend: Mock<ChannelAdapter['send']>;

    const whatsappAttempt = () => attempt({ channel: 'WHATSAPP', template: templateIn });
    const OWN_ROUTE = { senderId: 'sender-1', templateCategory: 'UTILITY' };
    const PLATFORM_ROUTE = { senderId: 'sender-platform', templateCategory: 'UTILITY' };

    beforeEach(() => {
      whatsappSend = vi.fn<ChannelAdapter['send']>();
      route.fallbackFor.mockResolvedValue(PLATFORM_SENDER);
      sender = new ChannelSender(
        new ChannelAdapters([
          {
            channel: 'WHATSAPP',
            provider: 'whatsapp_cloud',
            usesSenders: true,
            send: whatsappSend,
          },
        ]),
        createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
        contacts,
        writes,
        route,
        metrics,
        rate,
        breaker,
      );
    });

    it("should send the same attempt through the platform's sender and record that sender", async () => {
      whatsappSend
        .mockRejectedValueOnce(
          new ChannelAdapterError('WA_SENDER_BLOCKED', 'provider code 368', false),
        )
        .mockResolvedValueOnce({ providerMessageId: 'wamid.platform-1' });

      const outcome = await sender.attempt(whatsappAttempt());

      const expected = {
        status: 'SENT',
        provider: 'whatsapp_cloud',
        providerMessageId: 'wamid.platform-1',
        route: PLATFORM_ROUTE,
      };
      expect(outcome).toEqual(expected);
      expect(whatsappSend.mock.calls.map(([m]) => m.route?.sender.id)).toEqual([
        'sender-1',
        'sender-platform',
      ]);
      expect(route.fallbackFor).toHaveBeenCalledWith(SENDER);
      expect(route.optedOut).toHaveBeenLastCalledWith(PLATFORM_SENDER, '+919000000001');
      expect(route.capacity).toHaveBeenLastCalledWith(PLATFORM_SENDER, INSTITUTE.tenantId, false);
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
      expect(writes.recordDelivery.mock.calls[0]?.[0].outcome).toEqual(expected);
    });

    it("should not use the platform's sender when the person opted out of it", async () => {
      whatsappSend.mockRejectedValue(new ChannelAdapterError('WA_UNREACHABLE', 'http 503'));
      route.optedOut.mockImplementation(async (s) => s.id === PLATFORM_SENDER.id);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({
        status: 'FAILED',
        provider: 'whatsapp_cloud',
        errorCode: 'WA_UNREACHABLE',
        retryable: true,
        route: OWN_ROUTE,
      });
      expect(whatsappSend).toHaveBeenCalledTimes(1);
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
    });

    it("should not use the platform's sender when it is over its cap", async () => {
      whatsappSend.mockRejectedValue(new ChannelAdapterError('WA_UNREACHABLE', 'http 503'));
      route.capacity.mockImplementation(async (s) => (s.id === PLATFORM_SENDER.id ? 'over' : 'ok'));

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({
        status: 'FAILED',
        provider: 'whatsapp_cloud',
        errorCode: 'WA_UNREACHABLE',
        retryable: true,
        route: OWN_ROUTE,
      });
      expect(whatsappSend).toHaveBeenCalledTimes(1);
    });

    it('should not fail over a refusal of the message', async () => {
      whatsappSend.mockRejectedValue(
        new ChannelAdapterError('WA_NOT_ON_WHATSAPP', 'provider code 131026', false),
      );

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({
        status: 'FAILED',
        provider: 'whatsapp_cloud',
        errorCode: 'WA_NOT_ON_WHATSAPP',
        retryable: false,
        route: OWN_ROUTE,
      });
      expect(route.fallbackFor).not.toHaveBeenCalled();
      expect(whatsappSend).toHaveBeenCalledTimes(1);
    });

    it('should record the platform failure when the platform sender cannot send either', async () => {
      whatsappSend
        .mockRejectedValueOnce(
          new ChannelAdapterError('WA_SENDER_BLOCKED', 'provider code 368', false),
        )
        .mockRejectedValueOnce(new ChannelAdapterError('WA_UNREACHABLE', 'http 502'));

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({
        status: 'FAILED',
        provider: 'whatsapp_cloud',
        errorCode: 'WA_UNREACHABLE',
        retryable: true,
        route: PLATFORM_ROUTE,
      });
      expect(writes.recordDelivery).toHaveBeenCalledTimes(1);
    });

    it('should defer as rate_limited without calling the provider when the sender has no token', async () => {
      const retryAt = new Date('2026-11-24T10:00:00.400Z');
      rate.take.mockResolvedValue({ ok: false, retryAt });

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'DEFERRED', until: retryAt, reason: 'rate_limited' });
      expect(whatsappSend).not.toHaveBeenCalled();
      expect(route.fallbackFor).not.toHaveBeenCalled();
      expect(writes.recordDelivery).not.toHaveBeenCalled();
      expect(writes.recordDeferral).toHaveBeenCalledWith({
        audience: INSTITUTE,
        notificationId: 'notification-1',
        recipientUserId: 'user-guardian-1',
        type: 'FEE_REMINDER',
        channel: 'WHATSAPP',
        attempt: 1,
        flowId: 'notification-flow:key-1',
        reason: 'rate_limited',
      });
    });

    it('should skip as rate_limited when the sender has no token and the caller cannot wait', async () => {
      rate.take.mockResolvedValue({ ok: false, retryAt: new Date('2026-11-24T10:00:01.000Z') });

      const outcome = await sender.attempt(attempt({ ...whatsappAttempt(), deferrable: false }));

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'rate_limited' });
    });

    it.each([
      [false, false, false],
      [true, false, true],
      [true, true, false],
    ])('should take a token with digest %s and critical %s reserving %s', async (digest, critical, reserve) => {
      whatsappSend.mockResolvedValue({ providerMessageId: 'wamid.1' });

      await sender.attempt(attempt({ ...whatsappAttempt(), digest, critical }));

      expect(rate.take).toHaveBeenCalledWith({
        senderId: 'sender-1',
        messagesPerSecond: 10,
        phone: '+919000000001',
        reserve,
      });
    });

    it("should defer until the provider's Retry-After and throttle the sender, without a FAILED row", async () => {
      const until = new Date('2026-11-24T10:00:02.000Z');
      whatsappSend.mockRejectedValue(
        new ChannelAdapterError('WA_RATE_LIMITED', 'http 429', true, 2000),
      );
      rate.throttle.mockResolvedValue(until);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'DEFERRED', until, reason: 'rate_limited' });
      expect(rate.throttle).toHaveBeenCalledWith('sender-1', 10, 2000);
      expect(whatsappSend).toHaveBeenCalledTimes(1);
      expect(route.fallbackFor).not.toHaveBeenCalled();
      expect(writes.recordDelivery).not.toHaveBeenCalled();
      expect(breaker.failed).not.toHaveBeenCalled();
    });

    it("should keep today's FAILED row and failover on a throttle when the caller cannot wait", async () => {
      whatsappSend
        .mockRejectedValueOnce(new ChannelAdapterError('WA_RATE_LIMITED', 'http 429'))
        .mockResolvedValueOnce({ providerMessageId: 'wamid.platform-1' });

      const outcome = await sender.attempt(attempt({ ...whatsappAttempt(), deferrable: false }));

      expect(rate.throttle).toHaveBeenCalledWith('sender-1', 10, null);
      expect(outcome).toEqual({
        status: 'SENT',
        provider: 'whatsapp_cloud',
        providerMessageId: 'wamid.platform-1',
        route: PLATFORM_ROUTE,
      });
    });

    it("should send through the platform's sender while the institute's breaker is open", async () => {
      breaker.allow.mockImplementation(async (name: string) =>
        name === 'sender:sender-1'
          ? { ok: false, retryAt: new Date('2026-11-24T10:01:00.000Z') }
          : { ok: true },
      );
      whatsappSend.mockResolvedValue({ providerMessageId: 'wamid.platform-1' });

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({
        status: 'SENT',
        provider: 'whatsapp_cloud',
        providerMessageId: 'wamid.platform-1',
        route: PLATFORM_ROUTE,
      });
      expect(whatsappSend.mock.calls.map(([m]) => m.route?.sender.id)).toEqual(['sender-platform']);
    });

    it('should defer as provider_paused when both breakers are open', async () => {
      const retryAt = new Date('2026-11-24T10:01:00.000Z');
      breaker.allow.mockResolvedValue({ ok: false, retryAt });

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'DEFERRED', until: retryAt, reason: 'provider_paused' });
      expect(whatsappSend).not.toHaveBeenCalled();
    });

    it('should open the breaker, block the sender and fail over when the provider blocks it', async () => {
      whatsappSend
        .mockRejectedValueOnce(
          new ChannelAdapterError('WA_SENDER_BLOCKED', 'provider code 368', false),
        )
        .mockResolvedValueOnce({ providerMessageId: 'wamid.platform-1' });

      await sender.attempt(whatsappAttempt());

      expect(breaker.trip).toHaveBeenCalledWith('sender:sender-1');
      expect(route.block).toHaveBeenCalledWith(SENDER);
      expect(metrics.breakerOpened).toHaveBeenCalledWith(
        'WHATSAPP',
        'whatsapp_cloud',
        'WA_SENDER_BLOCKED',
      );
      expect(breaker.succeeded).toHaveBeenCalledWith('sender:sender-platform');
    });
  });
});
