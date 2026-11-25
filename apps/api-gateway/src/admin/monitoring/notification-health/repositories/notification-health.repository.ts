import type { NotificationChannel, PlatformContext } from '@roviq/common-types';

export interface CanarySuccessRecord {
  channel: NotificationChannel;
  sentAt: Date;
}

export interface SendCountRecord {
  channel: NotificationChannel;
  status: 'SENT' | 'FAILED';
  count: number;
}

export abstract class NotificationHealthRepository {
  /** The latest SENT delivery canary of each channel (ROV-329); a channel never sent is absent. */
  abstract latestCanarySuccess(ctx: PlatformContext): Promise<CanarySuccessRecord[]>;

  /** SENT and FAILED rows of every scope written since `since`, per channel and status. */
  abstract countSendsSince(ctx: PlatformContext, since: Date): Promise<SendCountRecord[]>;
}
