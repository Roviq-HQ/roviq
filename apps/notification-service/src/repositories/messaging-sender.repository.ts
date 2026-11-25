import type { MessagingSenderStatus, NotificationChannel } from '@roviq/common-types';
import type { MessagingSenderRecord, SenderSentCounts, SenderStateRecord } from './types';

export abstract class MessagingSenderRepository {
  /** The institute's own ACTIVE sender, else the platform's ACTIVE sender, else null. */
  abstract resolveForAudience(
    tenantId: string | null,
    channel: NotificationChannel,
    provider: string,
  ): Promise<MessagingSenderRecord | null>;

  /** The platform's ACTIVE sender, else null; the fallback when an institute's own cannot send. */
  abstract findActivePlatform(
    channel: NotificationChannel,
    provider: string,
  ): Promise<MessagingSenderRecord | null>;

  /** A live sender of any status by the provider's number id; an inbound event is mapped by it. */
  abstract findByProviderNumber(
    provider: string,
    providerNumberId: string,
  ): Promise<MessagingSenderRecord | null>;

  /** The person's latest request to this sender's number was STOP. */
  abstract isOptedOut(senderId: string, phone: string): Promise<boolean>;

  /** Messages the provider accepted from this sender since `since`; `forTenant` is the institute's part. */
  abstract countSentSince(
    senderId: string,
    since: Date,
    tenantId: string | null,
  ): Promise<SenderSentCounts>;

  /**
   * Moves a live sender from `from` to `to` as the system; false when it is no longer in `from`.
   * The caller checks the transition against the state machine.
   */
  abstract setStatusFrom(
    senderId: string,
    from: MessagingSenderStatus,
    to: MessagingSenderStatus,
  ): Promise<boolean>;

  /** Every live sender's channel, provider and status, for the state gauges. */
  abstract listStates(): Promise<SenderStateRecord[]>;
}
