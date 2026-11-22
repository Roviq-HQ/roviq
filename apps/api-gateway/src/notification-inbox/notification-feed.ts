import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { z } from 'zod';

/** What travels through the in-process pubsub: a pointer, never the text. */
export interface NotificationFeedEvent {
  notificationId: string;
}

/** One pubsub topic per recipient, so a subscriber only ever wakes for its own user. */
export function notificationFeedTopic(userId: string): string {
  return `${EVENT_PATTERNS.NOTIFICATION.INAPP_CREATED}.${userId}`;
}

export const inAppCreatedSchema = z.object({
  notificationId: z.uuid(),
  recipientUserId: z.uuid(),
});
