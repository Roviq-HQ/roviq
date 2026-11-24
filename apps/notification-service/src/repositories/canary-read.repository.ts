import type { NotificationChannel } from '@roviq/common-types';

export interface CanarySuccessRecord {
  channel: NotificationChannel;
  sentAt: Date;
}

/** Reads the delivery canary's own rows (ROV-329). */
export abstract class CanaryReadRepository {
  /** The latest SENT `DELIVERY_CANARY` row of each channel; a channel never sent is absent. */
  abstract latestSentPerChannel(): Promise<CanarySuccessRecord[]>;
}
