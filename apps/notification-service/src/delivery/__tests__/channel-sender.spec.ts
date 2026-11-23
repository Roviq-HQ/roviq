import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ContactReadRepository } from '../../repositories/contact-read.repository';
import { NotificationWriteRepository } from '../../repositories/notification-write.repository';
import type { MessagingSenderRecord } from '../../repositories/types';
import { type ChannelAdapter, ChannelAdapterError } from '../adapters/channel-adapter';
import { ChannelAdapters } from '../adapters/channel-adapters';
import { LogChannelAdapter } from '../adapters/log.adapter';
import { type ChannelAttempt, ChannelSender } from '../channel-sender';
import type { ConsentGate } from '../consent-gate';
import { WhatsAppRoute } from '../whatsapp/whatsapp-route';
import type { TemplateSend } from '../whatsapp/whatsapp-template';

const INSTITUTE = {
  scope: 'institute',
  tenantId: '019a0000-0000-7000-8000-000000000001',
  resellerId: null,
} as const;

const SENDER: MessagingSenderRecord = {
  id: 'sender-1',
  scope: 'institute',
  tenantId: INSTITUTE.tenantId,
  status: 'ACTIVE',
  providerNumberId: 'number-1',
  dailyCap: 1000,
  instituteDailyCap: null,
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
  let sender: ChannelSender;

  beforeEach(() => {
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
    });
    route = createMock<WhatsAppRoute>({
      resolveSender: vi.fn().mockResolvedValue(SENDER),
      optedOut: vi.fn().mockResolvedValue(false),
      quietUntil: vi.fn().mockResolvedValue(null),
      capacity: vi.fn().mockResolvedValue('ok'),
    });
    sender = new ChannelSender(
      new ChannelAdapters([email]),
      createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
      contacts,
      writes,
      route,
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

  it('should record channel_disabled without calling the adapter', async () => {
    const outcome = await sender.attempt(attempt({ channelEnabled: false }));

    expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'channel_disabled' });
    expect(send).not.toHaveBeenCalled();
    expect(contacts.findContact).not.toHaveBeenCalled();
  });

  it('should record no_consent when the consent gate refuses', async () => {
    const consent = createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(false) });
    sender = new ChannelSender(new ChannelAdapters([email]), consent, contacts, writes, route);

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

    it('should defer through quiet hours and write no delivery row', async () => {
      const until = new Date('2026-11-24T01:30:00.000Z');
      route.quietUntil.mockResolvedValue(until);

      const outcome = await sender.attempt(whatsappAttempt());

      expect(outcome).toEqual({ status: 'DEFERRED', until });
      expect(route.quietUntil).toHaveBeenCalledWith(INSTITUTE.tenantId, false);
      expect(route.capacity).not.toHaveBeenCalled();
      expect(whatsappSend).not.toHaveBeenCalled();
      expect(writes.recordDelivery).not.toHaveBeenCalled();
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

    it('should defer a critical message over the cap and write no delivery row', async () => {
      const until = new Date('2026-11-23T11:00:00.000Z');
      route.capacity.mockResolvedValue({ deferUntil: until });

      const outcome = await sender.attempt(whatsappAttempt({ critical: true }));

      expect(outcome).toEqual({ status: 'DEFERRED', until });
      expect(route.quietUntil).toHaveBeenCalledWith(INSTITUTE.tenantId, true);
      expect(route.capacity).toHaveBeenCalledWith(SENDER, INSTITUTE.tenantId, true);
      expect(writes.recordDelivery).not.toHaveBeenCalled();
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
});
