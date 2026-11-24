import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_CHANNEL_VALUES,
  type NotificationChannel,
  type PlatformContext,
} from '@roviq/common-types';
import { OpenObserveClient, OpenObserveUnavailableError } from '../openobserve.client';
import type { NotificationHealthModel } from './models/notification-health.model';
import { NotificationHealthRepository } from './repositories/notification-health.repository';

/** OpenObserve series of the notification service's `notification.delivery` counter. */
export const NOTIFICATION_DELIVERY_SERIES = 'notification_delivery';

const SENDS_QUERY = `sum by (channel, status) (increase(${NOTIFICATION_DELIVERY_SERIES}{status=~"SENT|FAILED"}[24h]))`;

type Counts = Map<NotificationChannel, { sent: number; failed: number }>;

@Injectable()
export class NotificationHealthService {
  private readonly logger = new Logger(NotificationHealthService.name);

  constructor(
    private readonly repo: NotificationHealthRepository,
    private readonly openObserve: OpenObserveClient,
  ) {}

  async get(ctx: PlatformContext): Promise<NotificationHealthModel> {
    const [canary, counts] = await Promise.all([
      this.repo.latestCanarySuccess(ctx),
      this.fetchCounts(),
    ]);
    const lastSuccess = new Map(canary.map((row) => [row.channel, row.sentAt]));
    return {
      channels: NOTIFICATION_CHANNEL_VALUES.map((channel) => {
        const count = counts?.get(channel);
        return {
          channel,
          sent24h: counts ? (count?.sent ?? 0) : null,
          failed24h: counts ? (count?.failed ?? 0) : null,
        };
      }),
      metricsAvailable: counts !== null,
      canary: NOTIFICATION_CHANNEL_VALUES.map((channel) => ({
        channel,
        lastSuccessAt: lastSuccess.get(channel) ?? null,
      })),
      checkedAt: new Date(),
    };
  }

  private async fetchCounts(): Promise<Counts | null> {
    try {
      const samples = await this.openObserve.query(SENDS_QUERY);
      const counts: Counts = new Map();
      for (const sample of samples) {
        const channel = NOTIFICATION_CHANNEL_VALUES.find((c) => c === sample.metric.channel);
        if (!channel) continue;
        const entry = counts.get(channel) ?? { sent: 0, failed: 0 };
        const value = Math.round(sample.value);
        if (sample.metric.status === 'SENT') entry.sent += value;
        if (sample.metric.status === 'FAILED') entry.failed += value;
        counts.set(channel, entry);
      }
      return counts;
    } catch (err) {
      if (!(err instanceof OpenObserveUnavailableError)) throw err;
      this.logger.warn(`Notification delivery metrics omitted: ${err.message}`);
      return null;
    }
  }
}
