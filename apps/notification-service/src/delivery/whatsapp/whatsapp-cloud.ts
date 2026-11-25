import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingTokenCipher } from '@roviq/crypto';
import { providersOf } from '../../config/channel-providers';
import type { MessagingSenderRecord } from '../../repositories/types';
import { type CloudSender, WhatsAppCloudClient } from './whatsapp-cloud.client';
import { WhatsAppTemplateClient } from './whatsapp-template.client';

/**
 * What the WhatsApp provider needs, built only when `NOTIFICATION_WHATSAPP_PROVIDER` names `cloud`
 * (env validation then guarantees every setting). Otherwise `enabled` is false and nothing
 * here may be used.
 */
@Injectable()
export class WhatsAppCloud {
  readonly enabled: boolean;
  private readonly parts: {
    client: WhatsAppCloudClient;
    templates: WhatsAppTemplateClient;
    cipher: MessagingTokenCipher;
    appSecret: string;
    verifyToken: string;
  } | null;

  constructor(config: ConfigService) {
    this.enabled = providersOf(
      'WHATSAPP',
      config.get<string>('NOTIFICATION_WHATSAPP_PROVIDER'),
    ).includes('cloud');
    this.parts = this.enabled
      ? {
          client: new WhatsAppCloudClient(config.getOrThrow<string>('WHATSAPP_API_BASE_URL')),
          templates: new WhatsAppTemplateClient(config.getOrThrow<string>('WHATSAPP_API_BASE_URL')),
          cipher: new MessagingTokenCipher(config.getOrThrow<string>('MESSAGING_ENCRYPTION_KEY')),
          appSecret: config.getOrThrow<string>('WHATSAPP_APP_SECRET'),
          verifyToken: config.getOrThrow<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
        }
      : null;
  }

  private get on() {
    if (this.parts === null) throw new Error('The WhatsApp provider is not configured');
    return this.parts;
  }

  get client(): WhatsAppCloudClient {
    return this.on.client;
  }

  /** The provider's template endpoints (ROV-333). */
  get templates(): WhatsAppTemplateClient {
    return this.on.templates;
  }

  get cipher(): MessagingTokenCipher {
    return this.on.cipher;
  }

  /** Signs the provider's webhook calls. */
  get appSecret(): string {
    return this.on.appSecret;
  }

  /** The provider repeats it once, when the webhook address is registered. */
  get verifyToken(): string {
    return this.on.verifyToken;
  }

  /** The number to send from with its token in clear; use it for one request and drop it. */
  open(sender: MessagingSenderRecord): CloudSender {
    return {
      providerNumberId: sender.providerNumberId,
      accessToken: this.on.cipher.decrypt(sender.accessTokenEncrypted),
    };
  }
}
