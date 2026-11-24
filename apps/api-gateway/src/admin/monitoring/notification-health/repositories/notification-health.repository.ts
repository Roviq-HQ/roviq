import type { NotificationChannel, PlatformContext } from '@roviq/common-types';

export interface CanarySuccessRecord {
  channel: NotificationChannel;
  sentAt: Date;
}

export abstract class NotificationHealthRepository {
  /** The latest SENT delivery canary of each channel (ROV-329); a channel never sent is absent. */
  abstract latestCanarySuccess(ctx: PlatformContext): Promise<CanarySuccessRecord[]>;
}
