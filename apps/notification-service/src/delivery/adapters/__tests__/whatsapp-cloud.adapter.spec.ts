import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { MessagingSenderRecord } from '../../../repositories/types';
import { WhatsAppCloud } from '../../whatsapp/whatsapp-cloud';
import type { WhatsAppCloudClient } from '../../whatsapp/whatsapp-cloud.client';
import type { TemplateSend } from '../../whatsapp/whatsapp-template';
import { ChannelAdapterError, type ChannelMessage } from '../channel-adapter';
import { WhatsAppCloudAdapter } from '../whatsapp-cloud.adapter';

const TOKEN = 'fake-access-token-1';

const TEMPLATE: TemplateSend = {
  name: 'fee_reminder_v1',
  languageCode: 'en',
  category: 'UTILITY',
  bodyVariables: ['Aarav Sharma'],
  buttonPath: 'institute/fees',
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

describe('WhatsAppCloudAdapter', () => {
  let cloud: WhatsAppCloud;
  let sendTemplate: MockInstance<WhatsAppCloudClient['sendTemplate']>;
  let adapter: WhatsAppCloudAdapter;
  let sender: MessagingSenderRecord;

  const message = (overrides: Partial<ChannelMessage> = {}): ChannelMessage => ({
    channel: 'WHATSAPP',
    type: 'FEE_REMINDER',
    recipientUserId: 'user-guardian-1',
    to: ['+919000000001'],
    subject: 'subject',
    body: 'body',
    data: {},
    route: { sender, template: TEMPLATE },
    ...overrides,
  });

  beforeEach(() => {
    cloud = new WhatsAppCloud(cloudConfig());
    sendTemplate = vi.spyOn(cloud.client, 'sendTemplate').mockResolvedValue('wamid.fake-1');
    adapter = new WhatsAppCloudAdapter(cloud);
    sender = {
      id: 'sender-1',
      scope: 'institute',
      tenantId: '019a0000-0000-7000-8000-000000000001',
      status: 'ACTIVE',
      providerNumberId: 'fake-number-id-1',
      dailyCap: 1000,
      instituteDailyCap: null,
      accessTokenEncrypted: cloud.cipher.encrypt(TOKEN),
    };
  });

  it('should name its channel and provider and send through senders', () => {
    expect(adapter.channel).toBe('WHATSAPP');
    expect(adapter.provider).toBe('whatsapp_cloud');
    expect(adapter.usesSenders).toBe(true);
  });

  it('should send the template from the opened sender to the first address', async () => {
    const result = await adapter.send(message({ to: ['+919000000001', '+919000000002'] }));

    expect(result).toEqual({ providerMessageId: 'wamid.fake-1' });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sendTemplate).toHaveBeenCalledWith(
      { providerNumberId: 'fake-number-id-1', accessToken: TOKEN },
      '+919000000001',
      TEMPLATE,
    );
  });

  it('should return no id when the provider gave none', async () => {
    sendTemplate.mockResolvedValue(null);

    await expect(adapter.send(message())).resolves.toEqual({});
  });

  it('should pass a provider failure through unchanged', async () => {
    const failure = new ChannelAdapterError('WA_NOT_ON_WHATSAPP', 'provider code 131026', false);
    sendTemplate.mockRejectedValue(failure);

    await expect(adapter.send(message())).rejects.toBe(failure);
  });

  it.each([
    ['without a route', { route: undefined }],
    ['without an address', { to: [] }],
  ])('should throw a plain error for a message %s', async (_case, overrides) => {
    const error = await adapter.send(message(overrides)).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChannelAdapterError);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
