import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel } from '@roviq/common-types';
import { type CanarySettings, canarySettingsOf } from '../config/canary-settings';
import type { NotificationEnv } from '../config/env.validation';
import { type AttemptOutcome, ChannelSender } from '../delivery/channel-sender';
import { smsDraftForCanary } from '../delivery/sms/sms-templates';
import { toTemplateSend } from '../delivery/whatsapp/whatsapp-template';
import { CanaryReadRepository } from '../repositories/canary-read.repository';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { type DeliveryCanaryParams, deliveryCanaryWhatsApp } from '../types/delivery-canary.type';
import { PLATFORM_TYPES } from '../types/registry';
import { PLATFORM_AUDIENCE } from './recipient-resolver.service';

/**
 * Sends the platform's scheduled test message (ROV-329) through the same sender as every
 * message, and keeps `notification.canary.last_success` per channel. The canary is critical
 * with a given address, like a secret type: consent and quiet hours do not apply to the
 * platform's own address, and over a sender's cap it is skipped rather than held.
 */
@Injectable()
export class DeliveryCanary implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeliveryCanary.name);
  readonly settings: CanarySettings | null;

  constructor(
    config: ConfigService<NotificationEnv, true>,
    private readonly sender: ChannelSender,
    private readonly canaries: CanaryReadRepository,
    private readonly metrics: NotificationMetrics,
  ) {
    this.settings = canarySettingsOf({
      NOTIFICATION_CANARY_CHANNELS: config.get('NOTIFICATION_CANARY_CHANNELS', { infer: true }),
      NOTIFICATION_CANARY_USER_ID: config.get('NOTIFICATION_CANARY_USER_ID', { infer: true }),
      NOTIFICATION_CANARY_EMAIL: config.get('NOTIFICATION_CANARY_EMAIL', { infer: true }),
      NOTIFICATION_CANARY_PHONE: config.get('NOTIFICATION_CANARY_PHONE', { infer: true }),
    });
  }

  /**
   * A gauge is lost on restart: it starts from the latest SENT row of each channel, or from
   * now for a channel never sent, so its alert waits one full window before it fires.
   */
  async onApplicationBootstrap(): Promise<void> {
    const settings = this.settings;
    if (settings === null) return;
    const startedAt = new Date();
    let latest = new Map<NotificationChannel, Date>();
    try {
      const rows = await this.canaries.latestSentPerChannel();
      latest = new Map(rows.map((row) => [row.channel, row.sentAt]));
    } catch (err) {
      this.logger.error('Could not read the last canary successes; counting from now', err);
    }
    for (const channel of settings.channels) {
      this.metrics.canarySucceeded(channel, latest.get(channel) ?? startedAt);
    }
  }

  /** Null when this instance has no canary for the channel: nothing is sent. */
  async send(channel: NotificationChannel, requestedAt: string): Promise<AttemptOutcome | null> {
    const settings = this.settings;
    if (settings === null || !settings.channels.includes(channel)) {
      this.logger.warn(`Canary for ${channel} requested, but it is not configured here; skipped`);
      return null;
    }
    const params: DeliveryCanaryParams = { requestedAt };
    const type = PLATFORM_TYPES.DELIVERY_CANARY;
    const outcome = await this.sender.attempt({
      type: type.key,
      channel,
      audience: PLATFORM_AUDIENCE,
      recipientUserId: settings.userId,
      notificationId: null,
      flowId: null,
      channelEnabled: true,
      critical: true,
      deferrable: false,
      attempt: 1,
      address: addressOf(settings, channel),
      data: {},
      compose: (locale) => type.outsideCopy(params, channel, locale),
      template: (locale) => toTemplateSend(deliveryCanaryWhatsApp, params, locale),
      sms: (locale) => smsDraftForCanary(params, locale),
    });
    if (outcome.status === 'SENT') {
      this.metrics.canarySucceeded(channel, new Date());
    } else {
      const why =
        outcome.status === 'FAILED'
          ? outcome.errorCode
          : outcome.status === 'SKIPPED'
            ? outcome.skipReason
            : outcome.reason;
      this.logger.warn(`Canary on ${channel} was not sent: ${outcome.status} ${why}`);
    }
    return outcome;
  }
}

function addressOf(
  settings: CanarySettings,
  channel: NotificationChannel,
): 'lookup' | { given: string | null } {
  switch (channel) {
    case 'EMAIL':
      return { given: settings.email };
    case 'SMS':
    case 'WHATSAPP':
      return { given: settings.phone };
    case 'PUSH':
      return 'lookup';
  }
}
