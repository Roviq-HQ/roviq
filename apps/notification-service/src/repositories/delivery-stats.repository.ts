import type { NotificationChannel } from '@roviq/common-types';

export interface SkippedCount {
  channel: NotificationChannel;
  reason: string;
  count: number;
}

/** Counts of delivery rows for the gauges; read as the platform role, with no caller. */
export abstract class DeliveryStatsRepository {
  /** SKIPPED rows written since `since`, per channel and skip reason. */
  abstract countSkippedSince(since: Date): Promise<SkippedCount[]>;
}
