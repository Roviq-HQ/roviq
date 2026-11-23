import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { SmsHttp } from '../../sms/sms-http';
import type { SmsHttpClient } from '../../sms/sms-http.client';
import type { SmsDraft, SmsSend } from '../../sms/sms-template';
import { ChannelAdapterError, type ChannelMessage } from '../channel-adapter';
import { SmsHttpAdapter } from '../sms-http.adapter';

const DRAFT: SmsDraft = { registrationKey: 'AUTH_OTP:en', variables: ['739155'], unicode: false };
const SEND: SmsSend = { ...DRAFT, templateId: 'reg-1001' };

function httpConfig() {
  return new ConfigService({
    NOTIFICATION_SMS_PROVIDER: 'http',
    SMS_API_BASE_URL: 'https://sms.example.test/api/v5',
    SMS_API_KEY: 'fake-auth-key',
    SMS_TEMPLATE_IDS: JSON.stringify({ 'AUTH_OTP:en': 'reg-1001' }),
    SMS_WEBHOOK_SECRET: 'w'.repeat(32),
  });
}

describe('SmsHttpAdapter', () => {
  let send: MockInstance<SmsHttpClient['send']>;
  let adapter: SmsHttpAdapter;

  const message = (overrides: Partial<ChannelMessage> = {}): ChannelMessage => ({
    channel: 'SMS',
    type: 'IMPERSONATION_OTP',
    recipientUserId: 'user-1',
    to: ['+919000000001'],
    subject: 'subject',
    body: 'body',
    data: {},
    sms: SEND,
    ...overrides,
  });

  beforeEach(() => {
    const sms = new SmsHttp(httpConfig());
    send = vi.spyOn(sms.client, 'send').mockResolvedValue('req-abc-1');
    adapter = new SmsHttpAdapter(sms);
  });

  it('should name its channel and provider and not send through senders', () => {
    expect(adapter.channel).toBe('SMS');
    expect(adapter.provider).toBe('sms_http');
    expect('usesSenders' in adapter).toBe(false);
  });

  it('should add the registration id to a draft whose key is registered', () => {
    expect(adapter.resolveSmsTemplate(DRAFT)).toEqual(SEND);
  });

  it('should answer null for a draft whose key is not registered', () => {
    expect(adapter.resolveSmsTemplate({ ...DRAFT, registrationKey: 'AUTH_OTP:hi' })).toBeNull();
  });

  it('should send the template to the first address and return the request id', async () => {
    await expect(adapter.send(message())).resolves.toEqual({ providerMessageId: 'req-abc-1' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('+919000000001', SEND);
  });

  it('should pass a provider failure through unchanged', async () => {
    const failure = new ChannelAdapterError('SMS_INVALID_NUMBER', 'http 200', false);
    send.mockRejectedValue(failure);

    await expect(adapter.send(message())).rejects.toBe(failure);
  });

  it.each([
    ['without a template', { sms: undefined }],
    ['without an address', { to: [] }],
  ])('should throw a plain error for a message %s', async (_case, overrides) => {
    const error = await adapter.send(message(overrides)).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChannelAdapterError);
    expect(send).not.toHaveBeenCalled();
  });

  it('should refuse to be used while the provider is off', () => {
    const off = new SmsHttpAdapter(
      new SmsHttp(new ConfigService({ NOTIFICATION_SMS_PROVIDER: 'log' })),
    );

    expect(() => off.resolveSmsTemplate(DRAFT)).toThrow('The SMS provider is not configured');
  });
});
