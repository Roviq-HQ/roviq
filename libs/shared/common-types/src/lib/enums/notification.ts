// ─── NotificationChannel ────────────────────────────────────────────────────

/** Channels outside the app. The in-app bell is a `notifications` row, not a channel. */
export const NOTIFICATION_CHANNEL_VALUES = ['EMAIL', 'PUSH', 'SMS', 'WHATSAPP'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number];

export const NotificationChannel = Object.fromEntries(
  NOTIFICATION_CHANNEL_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationChannel]: K };

// ─── NotificationDeliveryStatus ─────────────────────────────────────────────

export const NOTIFICATION_DELIVERY_STATUS_VALUES = [
  // The provider accepted the message
  'SENT',
  // The provider later confirmed it reached the recipient
  'DELIVERED',
  // The attempt failed; `error_code` says why
  'FAILED',
  // Never attempted; `skip_reason` says why (channel off, no consent, no provider)
  'SKIPPED',
] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

export const NotificationDeliveryStatus = Object.fromEntries(
  NOTIFICATION_DELIVERY_STATUS_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationDeliveryStatus]: K };

// ─── DevicePlatform ─────────────────────────────────────────────────────────

export const DEVICE_PLATFORM_VALUES = ['WEB', 'ANDROID', 'IOS'] as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM_VALUES)[number];

export const DevicePlatform = Object.fromEntries(DEVICE_PLATFORM_VALUES.map((v) => [v, v])) as {
  readonly [K in DevicePlatform]: K;
};
