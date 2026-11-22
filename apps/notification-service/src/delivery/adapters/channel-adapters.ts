import type { NotificationChannel } from '@roviq/common-types';
import type { ChannelAdapter } from './channel-adapter';
import { type DeviceTokenRetirer, FcmPushAdapter } from './fcm.adapter';
import { LogChannelAdapter } from './log.adapter';
import { SmtpEmailAdapter } from './smtp.adapter';

/** The adapter chosen for each channel; a channel without one is skipped as `no_provider`. */
export class ChannelAdapters {
  private readonly byChannel: ReadonlyMap<NotificationChannel, ChannelAdapter>;

  constructor(adapters: readonly ChannelAdapter[]) {
    this.byChannel = new Map(adapters.map((a) => [a.channel, a]));
  }

  get(channel: NotificationChannel): ChannelAdapter | null {
    return this.byChannel.get(channel) ?? null;
  }
}

export interface ProviderSettings {
  NOTIFICATION_EMAIL_PROVIDER?: 'smtp' | 'log';
  NOTIFICATION_PUSH_PROVIDER?: 'fcm' | 'log';
  NOTIFICATION_SMS_PROVIDER?: 'log';
  NOTIFICATION_WHATSAPP_PROVIDER?: 'log';
  SMTP_URL?: string;
  EMAIL_FROM?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
}

/** Env validation guarantees the settings each chosen provider needs are present. */
export function buildChannelAdapters(
  settings: ProviderSettings,
  tokens: DeviceTokenRetirer,
): ChannelAdapters {
  const adapters: ChannelAdapter[] = [];

  if (settings.NOTIFICATION_EMAIL_PROVIDER === 'smtp' && settings.SMTP_URL && settings.EMAIL_FROM) {
    adapters.push(new SmtpEmailAdapter(settings.SMTP_URL, settings.EMAIL_FROM));
  } else if (settings.NOTIFICATION_EMAIL_PROVIDER === 'log') {
    adapters.push(new LogChannelAdapter('EMAIL'));
  }

  if (settings.NOTIFICATION_PUSH_PROVIDER === 'fcm' && settings.FCM_SERVICE_ACCOUNT_JSON) {
    adapters.push(new FcmPushAdapter(settings.FCM_SERVICE_ACCOUNT_JSON, tokens));
  } else if (settings.NOTIFICATION_PUSH_PROVIDER === 'log') {
    adapters.push(new LogChannelAdapter('PUSH'));
  }

  if (settings.NOTIFICATION_SMS_PROVIDER === 'log') adapters.push(new LogChannelAdapter('SMS'));
  if (settings.NOTIFICATION_WHATSAPP_PROVIDER === 'log') {
    adapters.push(new LogChannelAdapter('WHATSAPP'));
  }

  return new ChannelAdapters(adapters);
}
