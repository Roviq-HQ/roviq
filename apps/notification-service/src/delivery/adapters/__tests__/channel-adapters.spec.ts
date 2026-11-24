import { createMock } from '@roviq/testing';
import { describe, expect, it } from 'vitest';
import type { SmsHttp } from '../../sms/sms-http';
import type { WhatsAppCloud } from '../../whatsapp/whatsapp-cloud';
import { buildChannelAdapters, type ProviderSettings } from '../channel-adapters';
import type { DeviceTokenRetirer } from '../fcm.adapter';

function build(settings: ProviderSettings) {
  return buildChannelAdapters(
    settings,
    createMock<DeviceTokenRetirer>(),
    createMock<WhatsAppCloud>(),
    createMock<SmsHttp>(),
  );
}

describe('buildChannelAdapters', () => {
  it('should keep a single provider per channel as before', () => {
    const adapters = build({ NOTIFICATION_SMS_PROVIDER: 'http' });

    expect(adapters.list('SMS').map((a) => a.provider)).toEqual(['sms_http']);
    expect(adapters.has('SMS')).toBe(true);
    expect(adapters.has('EMAIL')).toBe(false);
    expect(adapters.list('EMAIL')).toEqual([]);
  });

  it('should hold the providers of a list in the order named', () => {
    const adapters = build({
      NOTIFICATION_SMS_PROVIDER: 'log,http',
      NOTIFICATION_EMAIL_PROVIDER: 'smtp, log',
      SMTP_URL: 'smtp://127.0.0.1:2525',
      EMAIL_FROM: 'Roviq <a@b.in>',
      NOTIFICATION_WHATSAPP_PROVIDER: 'cloud,log',
    });

    expect(adapters.list('SMS').map((a) => a.provider)).toEqual(['log', 'sms_http']);
    expect(adapters.list('EMAIL').map((a) => a.provider)).toEqual(['smtp', 'log']);
    expect(adapters.list('WHATSAPP').map((a) => a.provider)).toEqual(['whatsapp_cloud', 'log']);
    expect(adapters.list('WHATSAPP').map((a) => a.channel)).toEqual(['WHATSAPP', 'WHATSAPP']);
  });

  it('should treat every provider as available until a breaker exists', () => {
    const adapters = build({ NOTIFICATION_PUSH_PROVIDER: 'log' });

    expect(adapters.list('PUSH').map((a) => adapters.available(a))).toEqual([true]);
  });
});
