/**
 * Redis keys the notification service writes and the gateway clears. One place, so both apps
 * agree on the names; the gateway's `REDIS_KEYS` spreads these.
 */
export const NOTIFICATION_REDIS_KEYS = {
  /** A sender's sends in the last second (sorted set), and `<id>:queue`, the next waiting slot. */
  NOTIFICATION_SENDER_RATE: 'notification:sender-rate:',
  /** One sender's last message to one person: `<senderId>:<sha256 of the phone>`. PX = the gap. */
  NOTIFICATION_RECIPIENT_RATE: 'notification:recipient-rate:',
  /** The provider throttled a sender: `{ rate, at, paused }`, keyed by sender id. */
  NOTIFICATION_SENDER_THROTTLE: 'notification:sender-throttle:',
  /** A circuit breaker `{ state, failures, since, until }`: `sender:<id>` or `adapter:<channel>:<provider>`. */
  NOTIFICATION_BREAKER: 'notification:breaker:',
} as const;

/** The breaker of one WhatsApp sender, as the breaker class names it. */
export const senderBreakerName = (senderId: string) => `sender:${senderId}`;

/** What a platform admin's reactivation of a sender clears: its breaker and its throttle. */
export function senderResetKeys(senderId: string): string[] {
  return [
    `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}${senderBreakerName(senderId)}`,
    `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_THROTTLE}${senderId}`,
  ];
}
