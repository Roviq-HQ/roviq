import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { providersOf } from '../../config/channel-providers';
import { SmsHttpClient } from './sms-http.client';
import { SmsRegistrations } from './sms-registrations';

/**
 * What the SMS provider needs, built only when `NOTIFICATION_SMS_PROVIDER` names `http` (env validation
 * then guarantees every setting). Otherwise `enabled` is false and nothing here may be used.
 */
@Injectable()
export class SmsHttp {
  readonly enabled: boolean;
  private readonly parts: {
    client: SmsHttpClient;
    registrations: SmsRegistrations;
    webhookSecret: string;
  } | null;

  constructor(config: ConfigService) {
    this.enabled = providersOf('SMS', config.get<string>('NOTIFICATION_SMS_PROVIDER')).includes(
      'http',
    );
    this.parts = this.enabled
      ? {
          client: new SmsHttpClient(
            config.getOrThrow<string>('SMS_API_BASE_URL'),
            config.getOrThrow<string>('SMS_API_KEY'),
            config.get<string>('SMS_SENDER_ID') ?? null,
          ),
          registrations: new SmsRegistrations(config.getOrThrow<string>('SMS_TEMPLATE_IDS')),
          webhookSecret: config.getOrThrow<string>('SMS_WEBHOOK_SECRET'),
        }
      : null;
  }

  private get on() {
    if (this.parts === null) throw new Error('The SMS provider is not configured');
    return this.parts;
  }

  get client(): SmsHttpClient {
    return this.on.client;
  }

  get registrations(): SmsRegistrations {
    return this.on.registrations;
  }

  /** Authenticates the provider's delivery reports. */
  get webhookSecret(): string {
    return this.on.webhookSecret;
  }
}
