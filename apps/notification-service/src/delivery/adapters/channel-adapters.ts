import type { NotificationChannel } from '@roviq/common-types';
import { providersOf } from '../../config/channel-providers';
import type { SmsHttp } from '../sms/sms-http';
import type { WhatsAppCloud } from '../whatsapp/whatsapp-cloud';
import type { ChannelAdapter } from './channel-adapter';
import { type DeviceTokenRetirer, FcmPushAdapter } from './fcm.adapter';
import { LogChannelAdapter } from './log.adapter';
import { SmsHttpAdapter } from './sms-http.adapter';
import { SmtpEmailAdapter } from './smtp.adapter';
import { WhatsAppCloudAdapter } from './whatsapp-cloud.adapter';

/**
 * The providers of each channel, first choice first; a channel without one is skipped as
 * `no_provider`. A send moves down the list only when a provider cannot send now.
 */
export class ChannelAdapters {
  private readonly byChannel = new Map<NotificationChannel, ChannelAdapter[]>();

  constructor(adapters: readonly ChannelAdapter[]) {
    for (const adapter of adapters) {
      const list = this.byChannel.get(adapter.channel) ?? [];
      list.push(adapter);
      this.byChannel.set(adapter.channel, list);
    }
  }

  list(channel: NotificationChannel): readonly ChannelAdapter[] {
    return this.byChannel.get(channel) ?? [];
  }

  has(channel: NotificationChannel): boolean {
    return this.list(channel).length > 0;
  }

  /** Whether a send may try this provider now; the seam for a circuit breaker (ROV-330). */
  available(_adapter: ChannelAdapter): boolean {
    return true;
  }
}

/** Each `NOTIFICATION_<CHANNEL>_PROVIDER` is one name or a comma-separated ordered list. */
export interface ProviderSettings {
  NOTIFICATION_EMAIL_PROVIDER?: string;
  NOTIFICATION_PUSH_PROVIDER?: string;
  NOTIFICATION_SMS_PROVIDER?: string;
  NOTIFICATION_WHATSAPP_PROVIDER?: string;
  SMTP_URL?: string;
  EMAIL_FROM?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
}

/** Env validation guarantees the settings each named provider needs are present. */
export function buildChannelAdapters(
  settings: ProviderSettings,
  tokens: DeviceTokenRetirer,
  whatsapp: WhatsAppCloud,
  sms: SmsHttp,
): ChannelAdapters {
  const adapters: ChannelAdapter[] = [];

  for (const name of providersOf('EMAIL', settings.NOTIFICATION_EMAIL_PROVIDER)) {
    if (name === 'smtp' && settings.SMTP_URL && settings.EMAIL_FROM) {
      adapters.push(new SmtpEmailAdapter(settings.SMTP_URL, settings.EMAIL_FROM));
    } else if (name === 'log') {
      adapters.push(new LogChannelAdapter('EMAIL'));
    }
  }
  for (const name of providersOf('PUSH', settings.NOTIFICATION_PUSH_PROVIDER)) {
    if (name === 'fcm' && settings.FCM_SERVICE_ACCOUNT_JSON) {
      adapters.push(new FcmPushAdapter(settings.FCM_SERVICE_ACCOUNT_JSON, tokens));
    } else if (name === 'log') {
      adapters.push(new LogChannelAdapter('PUSH'));
    }
  }
  for (const name of providersOf('SMS', settings.NOTIFICATION_SMS_PROVIDER)) {
    adapters.push(name === 'http' ? new SmsHttpAdapter(sms) : new LogChannelAdapter('SMS'));
  }
  for (const name of providersOf('WHATSAPP', settings.NOTIFICATION_WHATSAPP_PROVIDER)) {
    adapters.push(
      name === 'cloud' ? new WhatsAppCloudAdapter(whatsapp) : new LogChannelAdapter('WHATSAPP'),
    );
  }

  return new ChannelAdapters(adapters);
}
