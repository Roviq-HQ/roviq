import type { NotificationChannel } from '@roviq/common-types';
import type { MessagingSenderRecord, SenderSentCounts } from './types';

export abstract class MessagingSenderRepository {
  /** The institute's own ACTIVE sender, else the platform's ACTIVE sender, else null. */
  abstract resolveForAudience(
    tenantId: string | null,
    channel: NotificationChannel,
    provider: string,
  ): Promise<MessagingSenderRecord | null>;

  /** A live sender of any status by the provider's number id; an inbound event is mapped by it. */
  abstract findByProviderNumber(
    provider: string,
    providerNumberId: string,
  ): Promise<MessagingSenderRecord | null>;

  abstract isOptedOut(senderId: string, phone: string): Promise<boolean>;

  /** Messages the provider accepted from this sender since `since`; `forTenant` is the institute's part. */
  abstract countSentSince(
    senderId: string,
    since: Date,
    tenantId: string | null,
  ): Promise<SenderSentCounts>;
}
