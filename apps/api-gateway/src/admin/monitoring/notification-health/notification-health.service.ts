import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_CHANNEL_VALUES,
  type NotificationChannel,
  type PlatformContext,
} from '@roviq/common-types';
import type { NotificationHealthModel } from './models/notification-health.model';
import { NotificationHealthRepository } from './repositories/notification-health.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationHealthService {
  constructor(private readonly repo: NotificationHealthRepository) {}

  /** Counts come from the delivery rows: a metric counter loses the first send after a restart. */
  async get(ctx: PlatformContext): Promise<NotificationHealthModel> {
    const checkedAt = new Date();
    const [canary, sends] = await Promise.all([
      this.repo.latestCanarySuccess(ctx),
      this.repo.countSendsSince(ctx, new Date(checkedAt.getTime() - DAY_MS)),
    ]);
    const counts = new Map<NotificationChannel, { sent: number; failed: number }>();
    for (const row of sends) {
      const entry = counts.get(row.channel) ?? { sent: 0, failed: 0 };
      if (row.status === 'SENT') entry.sent += row.count;
      else entry.failed += row.count;
      counts.set(row.channel, entry);
    }
    const lastSuccess = new Map(canary.map((row) => [row.channel, row.sentAt]));
    return {
      channels: NOTIFICATION_CHANNEL_VALUES.map((channel) => ({
        channel,
        sent24h: counts.get(channel)?.sent ?? 0,
        failed24h: counts.get(channel)?.failed ?? 0,
      })),
      canary: NOTIFICATION_CHANNEL_VALUES.map((channel) => ({
        channel,
        lastSuccessAt: lastSuccess.get(channel) ?? null,
      })),
      checkedAt,
    };
  }
}
