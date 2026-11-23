import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ContactReadRepository } from '../../repositories/contact-read.repository';
import { NotificationWriteRepository } from '../../repositories/notification-write.repository';
import { type ChannelAdapter, ChannelAdapterError } from '../adapters/channel-adapter';
import { ChannelAdapters } from '../adapters/channel-adapters';
import { type ChannelAttempt, ChannelSender } from '../channel-sender';
import type { ConsentGate } from '../consent-gate';

const INSTITUTE = {
  scope: 'institute',
  tenantId: '019a0000-0000-7000-8000-000000000001',
  resellerId: null,
} as const;

function attempt(overrides: Partial<ChannelAttempt> = {}): ChannelAttempt {
  return {
    type: 'FEE_REMINDER',
    channel: 'EMAIL',
    audience: INSTITUTE,
    recipientUserId: 'user-guardian-1',
    notificationId: 'notification-1',
    channelEnabled: true,
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
  let sender: ChannelSender;

  beforeEach(() => {
    send = vi.fn<ChannelAdapter['send']>().mockResolvedValue({ providerMessageId: 'smtp-1' });
    email = { channel: 'EMAIL', provider: 'smtp', send };
    contacts = createMock<ContactReadRepository>({
      findContact: vi.fn().mockResolvedValue({
        email: 'guardian@example.in',
        phone: '+919876543210',
        preferredLocale: 'hi',
      }),
      findDeviceTokens: vi.fn().mockResolvedValue([]),
    });
    writes = createMock<NotificationWriteRepository>({
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    });
    sender = new ChannelSender(
      new ChannelAdapters([email]),
      createMock<ConsentGate>({ allows: vi.fn().mockResolvedValue(true) }),
      contacts,
      writes,
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
    sender = new ChannelSender(new ChannelAdapters([email]), consent, contacts, writes);

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

    expect(outcome).toEqual({ status: 'FAILED', provider: 'smtp', errorCode: 'ECONNECTION' });
    expect(writes.recordDelivery).toHaveBeenCalledWith({
      audience: INSTITUTE,
      notificationId: 'notification-1',
      recipientUserId: 'user-guardian-1',
      type: 'FEE_REMINDER',
      channel: 'EMAIL',
      attempt: 2,
      outcome: { status: 'FAILED', provider: 'smtp', errorCode: 'ECONNECTION' },
    });
  });

  it('should let a non-provider error propagate without a row', async () => {
    send.mockRejectedValue(new TypeError('bug'));

    await expect(sender.attempt(attempt())).rejects.toThrow('bug');
    expect(writes.recordDelivery).not.toHaveBeenCalled();
  });
});
