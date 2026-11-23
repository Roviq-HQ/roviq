import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { ChannelAdapterError } from '../../delivery/adapters/channel-adapter';
import type { InboundBatch } from '../../delivery/whatsapp/webhook-payload';
import { WhatsAppCloud } from '../../delivery/whatsapp/whatsapp-cloud';
import type { WhatsAppCloudClient } from '../../delivery/whatsapp/whatsapp-cloud.client';
import { Clock } from '../../delivery/whatsapp/whatsapp-route';
import { MessagingInboundRepository } from '../../repositories/messaging-inbound.repository';
import { MessagingSenderRepository } from '../../repositories/messaging-sender.repository';
import type { MessagingSenderRecord } from '../../repositories/types';
import { AUTO_REPLY, STOP_CONFIRMATION, WhatsAppWebhookService } from '../whatsapp-webhook.service';

const TOKEN = 'fake-access-token-1';
const NUMBER_ID = 'fake-number-id-1';
const PHONE = '+919000000001';
const PERSON = { phone: PHONE, providerUserId: 'fake-user-1' };

function cloudConfig() {
  return new ConfigService({
    NOTIFICATION_WHATSAPP_PROVIDER: 'cloud',
    WHATSAPP_API_BASE_URL: 'https://graph.example.test/v99.0',
    WHATSAPP_APP_SECRET: 'fake-app-secret',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fake-verify-token',
    MESSAGING_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
  });
}

const batch = (overrides: Partial<InboundBatch>): InboundBatch => ({
  providerNumberId: NUMBER_ID,
  receipts: [],
  messages: [],
  ...overrides,
});

describe('WhatsAppWebhookService', () => {
  let senders: ReturnType<typeof createMock<MessagingSenderRepository>>;
  let inbound: ReturnType<typeof createMock<MessagingInboundRepository>>;
  let cloud: WhatsAppCloud;
  let sendText: MockInstance<WhatsAppCloudClient['sendText']>;
  let clock: Clock;
  let sender: MessagingSenderRecord;
  let service: WhatsAppWebhookService;

  beforeEach(() => {
    cloud = new WhatsAppCloud(cloudConfig());
    sendText = vi.spyOn(cloud.client, 'sendText').mockResolvedValue('wamid.reply-1');
    sender = {
      id: 'sender-1',
      scope: 'institute',
      tenantId: '019a0000-0000-7000-8000-000000000001',
      status: 'ACTIVE',
      providerNumberId: NUMBER_ID,
      dailyCap: 1000,
      instituteDailyCap: null,
      accessTokenEncrypted: cloud.cipher.encrypt(TOKEN),
    };
    senders = createMock<MessagingSenderRepository>({
      findByProviderNumber: vi.fn().mockResolvedValue(sender),
    });
    inbound = createMock<MessagingInboundRepository>({
      recordReceipt: vi.fn().mockResolvedValue('recorded'),
      recordOptOut: vi.fn().mockResolvedValue({ created: true, phone: PHONE }),
      recordMessage: vi.fn().mockResolvedValue({ reply: true }),
    });
    clock = new Clock();
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-11-23T10:00:00.000Z'));
    service = new WhatsAppWebhookService(senders, inbound, cloud, clock);
  });

  it('should record nothing and send nothing for a number that is no sender here', async () => {
    senders.findByProviderNumber.mockResolvedValue(null);

    await service.handle([
      batch({
        receipts: [
          {
            messageId: 'wamid.1',
            status: 'delivered',
            recipientPhone: PHONE,
            providerUserId: null,
            providerErrorCode: null,
          },
        ],
        messages: [{ messageId: 'wamid.in-1', ...PERSON, stop: true }],
      }),
    ]);

    expect(senders.findByProviderNumber).toHaveBeenCalledWith('whatsapp_cloud', NUMBER_ID);
    expect(inbound.recordReceipt).not.toHaveBeenCalled();
    expect(inbound.recordOptOut).not.toHaveBeenCalled();
    expect(inbound.recordMessage).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  describe('delivery reports', () => {
    const receipt = (
      status: 'sent' | 'delivered' | 'read' | 'failed',
      code: number | null = null,
    ) =>
      batch({
        receipts: [
          {
            messageId: 'wamid.1',
            status,
            recipientPhone: PHONE,
            providerUserId: 'fake-user-1',
            providerErrorCode: code,
          },
        ],
      });

    it('should ignore a sent report', async () => {
      await service.handle([receipt('sent')]);

      expect(inbound.recordReceipt).not.toHaveBeenCalled();
    });

    it('should record a delivered report', async () => {
      await service.handle([receipt('delivered')]);

      expect(inbound.recordReceipt).toHaveBeenCalledWith({
        senderId: 'sender-1',
        eventId: 'wamid.1:delivered',
        providerMessageId: 'wamid.1',
        status: 'DELIVERED',
        errorCode: null,
        onlyIfNotDelivered: false,
        person: PERSON,
      });
    });

    it('should record a read report as delivered only if not delivered before', async () => {
      await service.handle([receipt('read')]);

      expect(inbound.recordReceipt).toHaveBeenCalledWith({
        senderId: 'sender-1',
        eventId: 'wamid.1:read',
        providerMessageId: 'wamid.1',
        status: 'DELIVERED',
        errorCode: null,
        onlyIfNotDelivered: true,
        person: PERSON,
      });
    });

    it.each([
      [131026, 'WA_NOT_ON_WHATSAPP'],
      [null, 'WA_REJECTED'],
    ])('should record a failed report with code %s as %s', async (code, errorCode) => {
      await service.handle([receipt('failed', code)]);

      expect(inbound.recordReceipt).toHaveBeenCalledWith({
        senderId: 'sender-1',
        eventId: 'wamid.1:failed',
        providerMessageId: 'wamid.1',
        status: 'FAILED',
        errorCode,
        onlyIfNotDelivered: false,
        person: PERSON,
      });
    });

    it('should let a repository error propagate', async () => {
      inbound.recordReceipt.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handle([receipt('delivered')])).rejects.toThrow('connection terminated');
    });
  });

  describe('stop requests', () => {
    const stop = batch({ messages: [{ messageId: 'wamid.in-1', ...PERSON, stop: true }] });

    it('should record the opt-out and confirm it to the phone the repository returned', async () => {
      inbound.recordOptOut.mockResolvedValue({ created: true, phone: '+919000000002' });

      await service.handle([stop]);

      expect(inbound.recordOptOut).toHaveBeenCalledWith('sender-1', 'wamid.in-1', PERSON);
      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(
        { providerNumberId: NUMBER_ID, accessToken: TOKEN },
        '+919000000002',
        STOP_CONFIRMATION,
      );
    });

    it('should not confirm an opt-out that already existed', async () => {
      inbound.recordOptOut.mockResolvedValue({ created: false, phone: PHONE });

      await service.handle([stop]);

      expect(sendText).not.toHaveBeenCalled();
    });

    it('should not confirm when no phone is known', async () => {
      inbound.recordOptOut.mockResolvedValue({ created: true, phone: null });

      await service.handle([stop]);

      expect(sendText).not.toHaveBeenCalled();
    });

    it.each([
      'PAUSED',
      'BLOCKED',
    ] as const)('should not confirm through a %s sender', async (status) => {
      senders.findByProviderNumber.mockResolvedValue({ ...sender, status });

      await service.handle([stop]);

      expect(inbound.recordOptOut).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalled();
    });

    it('should swallow a provider failure of the confirmation', async () => {
      sendText.mockRejectedValue(new ChannelAdapterError('WA_RATE_LIMITED', 'http 429'));

      await expect(service.handle([stop])).resolves.toBeUndefined();
    });

    it('should let any other error of the confirmation propagate', async () => {
      sendText.mockRejectedValue(new TypeError('bug'));

      await expect(service.handle([stop])).rejects.toThrow('bug');
    });

    it('should let a repository error propagate', async () => {
      inbound.recordOptOut.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handle([stop])).rejects.toThrow('connection terminated');
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  describe('other messages', () => {
    const other = batch({ messages: [{ messageId: 'wamid.in-2', ...PERSON, stop: false }] });

    it('should record the message for the day in India and send the auto reply', async () => {
      await service.handle([other]);

      expect(inbound.recordMessage).toHaveBeenCalledWith(
        'sender-1',
        'wamid.in-2',
        PERSON,
        '2026-11-23',
      );
      expect(inbound.recordOptOut).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledWith(
        { providerNumberId: NUMBER_ID, accessToken: TOKEN },
        PHONE,
        AUTO_REPLY,
      );
    });

    it('should count the day in India when the UTC date is still the day before', async () => {
      vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-11-23T20:00:00.000Z'));

      await service.handle([other]);

      expect(inbound.recordMessage).toHaveBeenCalledWith(
        'sender-1',
        'wamid.in-2',
        PERSON,
        '2026-11-24',
      );
    });

    it('should not reply when the repository says not to', async () => {
      inbound.recordMessage.mockResolvedValue({ reply: false });

      await service.handle([other]);

      expect(sendText).not.toHaveBeenCalled();
    });

    it('should not reply to a person without a phone', async () => {
      await service.handle([
        batch({
          messages: [
            { messageId: 'wamid.in-3', phone: null, providerUserId: 'fake-user-1', stop: false },
          ],
        }),
      ]);

      expect(inbound.recordMessage).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalled();
    });

    it('should swallow a provider failure of the auto reply', async () => {
      sendText.mockRejectedValue(new ChannelAdapterError('WA_UNREACHABLE', 'request failed'));

      await expect(service.handle([other])).resolves.toBeUndefined();
    });

    it('should let a repository error propagate', async () => {
      inbound.recordMessage.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handle([other])).rejects.toThrow('connection terminated');
    });
  });

  it('should look each batch up by its own number', async () => {
    senders.findByProviderNumber.mockResolvedValueOnce(null).mockResolvedValueOnce(sender);

    await service.handle([
      batch({ providerNumberId: 'fake-number-id-unknown', messages: [] }),
      batch({ messages: [{ messageId: 'wamid.in-4', ...PERSON, stop: false }] }),
    ]);

    expect(senders.findByProviderNumber.mock.calls).toEqual([
      ['whatsapp_cloud', 'fake-number-id-unknown'],
      ['whatsapp_cloud', NUMBER_ID],
    ]);
    expect(inbound.recordMessage).toHaveBeenCalledTimes(1);
  });
});
