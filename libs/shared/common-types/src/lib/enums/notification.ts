// ─── NotificationChannel ────────────────────────────────────────────────────

/** Channels outside the app. The in-app bell is a `notifications` row, not a channel. */
export const NOTIFICATION_CHANNEL_VALUES = ['EMAIL', 'PUSH', 'SMS', 'WHATSAPP'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number];

export const NotificationChannel = Object.fromEntries(
  NOTIFICATION_CHANNEL_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationChannel]: K };

// ─── NotificationTypeKey ────────────────────────────────────────────────────

/** Stored in `notifications.type` and `notification_deliveries.type`. */
export const NOTIFICATION_TYPE_VALUES = [
  // A student was marked absent or late; goes to the linked guardians
  'ATTENDANCE_ABSENT',
  // A fee is past its due date; goes to the linked guardians
  'FEE_OVERDUE',
  // A fee falls due soon; goes to the linked guardians
  'FEE_REMINDER',
  // A leave application was approved or rejected; goes to the applicant and, for a student, the guardians
  'LEAVE_DECIDED',
  // Someone asked the recipient to approve a request
  'APPROVAL_REQUESTED',
  // The recipient's request was approved or rejected
  'APPROVAL_RESOLVED',
  // A sign-in to the recipient's account
  'AUTH_LOGIN',
  // A password reset was requested for the recipient's account
  'AUTH_PASSWORD_RESET',
  // A sign-in from a device not seen before
  'AUTH_NEW_DEVICE',
  // The account was locked after too many failed attempts
  'AUTH_ACCOUNT_LOCKED',
  // A session of the recipient's account was revoked
  'AUTH_SESSION_REVOKED',
  // One-time code proving the recipient reads their mailbox; email only, never stored
  'EMAIL_VERIFICATION',
  // One-time code an institute admin enters to approve impersonation; never stored
  'IMPERSONATION_OTP',
  // First message to a new account, carrying its temporary password; never stored
  'USER_WELCOME',
  // A subscription or payment of an institute changed
  'BILLING_EVENT',
] as const;

export type NotificationTypeKey = (typeof NOTIFICATION_TYPE_VALUES)[number];

export const NotificationTypeKey = Object.fromEntries(
  NOTIFICATION_TYPE_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationTypeKey]: K };

// ─── NotificationSkipReason ─────────────────────────────────────────────────

/** `notification_deliveries.skip_reason`, in the order the channel gate checks them. */
export const NOTIFICATION_SKIP_REASON_VALUES = [
  // The institute switched this channel off for this kind of notification
  'channel_disabled',
  // The recipient has not consented to this channel
  'no_consent',
  // No provider is configured for this channel
  'no_provider',
  // The recipient has no address for this channel (email, phone, device token)
  'no_address',
] as const;

export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASON_VALUES)[number];

export const NotificationSkipReason = {
  CHANNEL_DISABLED: 'channel_disabled',
  NO_CONSENT: 'no_consent',
  NO_PROVIDER: 'no_provider',
  NO_ADDRESS: 'no_address',
} as const satisfies Record<string, NotificationSkipReason>;

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
