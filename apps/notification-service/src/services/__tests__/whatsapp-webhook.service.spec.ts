import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { ChannelAdapterError } from '../../delivery/adapters/channel-adapter';
import { TemplateSendability } from '../../delivery/whatsapp/template-sendability';
import type { InboundBatch } from '../../delivery/whatsapp/webhook-payload';
import { WhatsAppCloud } from '../../delivery/whatsapp/whatsapp-cloud';
import type { WhatsAppCloudClient } from '../../delivery/whatsapp/whatsapp-cloud.client';
import { Clock } from '../../delivery/whatsapp/whatsapp-route';
import { MessagingInboundRepository } from '../../repositories/messaging-inbound.repository';
import { MessagingSenderRepository } from '../../repositories/messaging-sender.repository';
import { MessagingTemplateRepository } from '../../repositories/messaging-template.repository';
import type {
  MessagingSenderRecord,
  ReceiptResult,
  WrittenDelivery,
} from '../../repositories/types';
import type { NotificationMetrics } from '../../telemetry/notification-metrics';
import { FlowArrivals } from '../flow-arrivals.service';
import {
  AUTO_REPLY,
  START_CONFIRMATION,
  STOP_CONFIRMATION,
  WhatsAppWebhookService,
} from '../whatsapp-webhook.service';

const TOKEN = 'fake-access-token-1';
const NUMBER_ID = 'fake-number-id-1';
const PHONE = '+919000000001';
const PERSON = { phone: PHONE, providerUserId: 'fake-user-1' };
const DELIVERED_ROW: WrittenDelivery = {
  channel: 'WHATSAPP',
  status: 'DELIVERED',
  provider: 'whatsapp_cloud',
  errorCode: null,
};

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
  let arrivals: ReturnType<typeof createMock<FlowArrivals>>;
  let metrics: ReturnType<typeof createMock<NotificationMetrics>>;
  let service: WhatsAppWebhookService;
  let templates: ReturnType<typeof createMock<MessagingTemplateRepository>>;
  let sendability: TemplateSendability;

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
      messagesPerSecond: 10,
      accessTokenEncrypted: cloud.cipher.encrypt(TOKEN),
    };
    senders = createMock<MessagingSenderRepository>({
      findByProviderNumber: vi.fn().mockResolvedValue(sender),
    });
    inbound = createMock<MessagingInboundRepository>({
      recordReceipt: vi.fn().mockResolvedValue({ kind: 'recorded', arrival: null, written: [] }),
      recordPreference: vi.fn().mockResolvedValue({ changed: true, phone: PHONE }),
      recordMessage: vi.fn().mockResolvedValue({ reply: true }),
    });
    clock = new Clock();
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-11-23T10:00:00.000Z'));
    arrivals = createMock<FlowArrivals>({ arrived: vi.fn().mockResolvedValue(undefined) });
    metrics = createMock<NotificationMetrics>();
    templates = createMock<MessagingTemplateRepository>({
      applyEvent: vi.fn().mockResolvedValue(true),
    });
    sendability = new TemplateSendability(templates);
    service = new WhatsAppWebhookService(
      senders,
      inbound,
      cloud,
      clock,
      arrivals,
      metrics,
      templates,
      sendability,
    );
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
        messages: [{ messageId: 'wamid.in-1', ...PERSON, intent: 'stop' }],
      }),
    ]);

    expect(senders.findByProviderNumber).toHaveBeenCalledWith('whatsapp_cloud', NUMBER_ID);
    expect(inbound.recordReceipt).not.toHaveBeenCalled();
    expect(inbound.recordPreference).not.toHaveBeenCalled();
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
        person: PERSON,
      });
    });

    it('should record a read report as READ', async () => {
      await service.handle([receipt('read')]);

      expect(inbound.recordReceipt).toHaveBeenCalledWith({
        senderId: 'sender-1',
        eventId: 'wamid.1:read',
        providerMessageId: 'wamid.1',
        status: 'READ',
        errorCode: null,
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
        person: PERSON,
      });
    });

    it('should tell the flow when a delivered report proves its message arrived', async () => {
      inbound.recordReceipt.mockResolvedValue({
        kind: 'recorded',
        arrival: {
          flowId: 'notification-flow:key-1',
          recipientUserId: 'user-1',
          channel: 'WHATSAPP',
        },
        written: [DELIVERED_ROW],
      });

      await service.handle([receipt('delivered')]);

      expect(arrivals.arrived).toHaveBeenCalledWith(
        'notification-flow:key-1',
        'user-1',
        'WHATSAPP',
      );
      expect(metrics.reported).toHaveBeenCalledWith([DELIVERED_ROW]);
    });

    it.each<[string, ReceiptResult]>([
      ['a report of a message with no flow', { kind: 'recorded', arrival: null, written: [] }],
      ['a repeated report', { kind: 'duplicate' }],
      ['a report of an unknown message', { kind: 'unknown_message' }],
    ])('should signal no flow for %s', async (_name, result) => {
      inbound.recordReceipt.mockResolvedValue(result);

      await service.handle([receipt('delivered')]);

      expect(arrivals.arrived).not.toHaveBeenCalled();
    });

    it('should let a repository error propagate', async () => {
      inbound.recordReceipt.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handle([receipt('delivered')])).rejects.toThrow('connection terminated');
    });
  });

  describe('stop requests', () => {
    const stop = batch({ messages: [{ messageId: 'wamid.in-1', ...PERSON, intent: 'stop' }] });

    it('should record the stop and confirm it to the phone the repository returned', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: true, phone: '+919000000002' });

      await service.handle([stop]);

      expect(inbound.recordPreference).toHaveBeenCalledWith(
        'sender-1',
        'wamid.in-1',
        PERSON,
        'STOP',
      );
      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(
        { providerNumberId: NUMBER_ID, accessToken: TOKEN },
        '+919000000002',
        STOP_CONFIRMATION,
      );
    });

    it('should neither confirm nor auto-reply to a stop that changed nothing', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: false, phone: PHONE });

      await service.handle([stop]);

      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    });

    it('should not confirm when no phone is known', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: true, phone: null });

      await service.handle([stop]);

      expect(sendText).not.toHaveBeenCalled();
    });

    it.each([
      'PAUSED',
      'BLOCKED',
    ] as const)('should not confirm through a %s sender', async (status) => {
      senders.findByProviderNumber.mockResolvedValue({ ...sender, status });

      await service.handle([stop]);

      expect(inbound.recordPreference).toHaveBeenCalledTimes(1);
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
      inbound.recordPreference.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handle([stop])).rejects.toThrow('connection terminated');
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  it('should say in both languages that security alerts stop too and how to start again', () => {
    const [english, hindi] = STOP_CONFIRMATION.split('\n\n');
    expect(english).toContain('START');
    expect(english).toContain('security');
    expect(hindi).toContain('START');
    expect(hindi).toContain('सुरक्षा');
  });

  describe('start requests', () => {
    const start = batch({ messages: [{ messageId: 'wamid.in-5', ...PERSON, intent: 'start' }] });

    it('should record the start and confirm it, and nothing else', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: true, phone: '+919000000002' });

      await service.handle([start]);

      expect(inbound.recordPreference).toHaveBeenCalledWith(
        'sender-1',
        'wamid.in-5',
        PERSON,
        'START',
      );
      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText.mock.calls).toEqual([
        [{ providerNumberId: NUMBER_ID, accessToken: TOKEN }, '+919000000002', START_CONFIRMATION],
      ]);
    });

    it('should handle a start from a person who never stopped as an ordinary message', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: false, phone: PHONE });

      await service.handle([start]);

      expect(inbound.recordMessage).toHaveBeenCalledWith(
        'sender-1',
        'wamid.in-5',
        PERSON,
        '2026-11-23',
      );
      expect(sendText.mock.calls).toEqual([
        [{ providerNumberId: NUMBER_ID, accessToken: TOKEN }, PHONE, AUTO_REPLY],
      ]);
    });

    it('should send nothing for an unchanged start when the repository says not to reply', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: false, phone: PHONE });
      inbound.recordMessage.mockResolvedValue({ reply: false });

      await service.handle([start]);

      expect(inbound.recordMessage).toHaveBeenCalledTimes(1);
      expect(sendText).not.toHaveBeenCalled();
    });

    it('should not confirm a start when no phone is known', async () => {
      inbound.recordPreference.mockResolvedValue({ changed: true, phone: null });

      await service.handle([start]);

      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    });

    it.each([
      'PAUSED',
      'BLOCKED',
    ] as const)('should not confirm a start through a %s sender', async (status) => {
      senders.findByProviderNumber.mockResolvedValue({ ...sender, status });

      await service.handle([start]);

      expect(inbound.recordPreference).toHaveBeenCalledTimes(1);
      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    });

    it('should swallow a provider failure of the confirmation', async () => {
      sendText.mockRejectedValue(new ChannelAdapterError('WA_UNREACHABLE', 'request failed'));

      await expect(service.handle([start])).resolves.toBeUndefined();
    });

    it('should let a repository error propagate', async () => {
      inbound.recordPreference.mockRejectedValue(new Error('connection terminated'));

      await expect(service.handle([start])).rejects.toThrow('connection terminated');
      expect(inbound.recordMessage).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  describe('other messages', () => {
    const other = batch({ messages: [{ messageId: 'wamid.in-2', ...PERSON, intent: 'other' }] });

    it('should record the message for the day in India and send the auto reply', async () => {
      await service.handle([other]);

      expect(inbound.recordMessage).toHaveBeenCalledWith(
        'sender-1',
        'wamid.in-2',
        PERSON,
        '2026-11-23',
      );
      expect(inbound.recordPreference).not.toHaveBeenCalled();
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
            {
              messageId: 'wamid.in-3',
              phone: null,
              providerUserId: 'fake-user-1',
              intent: 'other',
            },
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
      batch({ messages: [{ messageId: 'wamid.in-4', ...PERSON, intent: 'other' }] }),
    ]);

    expect(senders.findByProviderNumber.mock.calls).toEqual([
      ['whatsapp_cloud', 'fake-number-id-unknown'],
      ['whatsapp_cloud', NUMBER_ID],
    ]);
    expect(inbound.recordMessage).toHaveBeenCalledTimes(1);
  });
});
