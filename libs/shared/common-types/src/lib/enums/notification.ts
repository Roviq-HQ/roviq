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
  // A scheduled test message the platform sends itself to prove delivery works; never an institute's
  'DELIVERY_CANARY',
] as const;

export type NotificationTypeKey = (typeof NOTIFICATION_TYPE_VALUES)[number];

export const NotificationTypeKey = Object.fromEntries(
  NOTIFICATION_TYPE_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationTypeKey]: K };

// ─── NotificationModule ─────────────────────────────────────────────────────

/** The part of the product a notification type belongs to; the delivery log filters by it. */
export const NOTIFICATION_MODULE_VALUES = [
  // Absence and late marks
  'ATTENDANCE',
  // Fee reminders and overdue fees
  'FEE',
  // Leave decisions
  'LEAVE',
  // Approval requests and their results
  'APPROVAL',
  // Sign-ins, password resets, locks, revoked sessions and impersonation codes
  'ACCOUNT_SECURITY',
  // Welcome messages and email verification
  'ACCOUNT',
  // Subscription and payment changes of the institute
  'BILLING',
  // The platform's own delivery checks; never shown to an institute
  'PLATFORM',
] as const;

export type NotificationModule = (typeof NOTIFICATION_MODULE_VALUES)[number];

export const NotificationModule = Object.fromEntries(
  NOTIFICATION_MODULE_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationModule]: K };

/** Exhaustive: a new type does not compile until it has a module. */
export const NOTIFICATION_MODULE_OF: Record<NotificationTypeKey, NotificationModule> = {
  ATTENDANCE_ABSENT: 'ATTENDANCE',
  FEE_OVERDUE: 'FEE',
  FEE_REMINDER: 'FEE',
  LEAVE_DECIDED: 'LEAVE',
  APPROVAL_REQUESTED: 'APPROVAL',
  APPROVAL_RESOLVED: 'APPROVAL',
  AUTH_LOGIN: 'ACCOUNT_SECURITY',
  AUTH_PASSWORD_RESET: 'ACCOUNT_SECURITY',
  AUTH_NEW_DEVICE: 'ACCOUNT_SECURITY',
  AUTH_ACCOUNT_LOCKED: 'ACCOUNT_SECURITY',
  AUTH_SESSION_REVOKED: 'ACCOUNT_SECURITY',
  IMPERSONATION_OTP: 'ACCOUNT_SECURITY',
  EMAIL_VERIFICATION: 'ACCOUNT',
  USER_WELCOME: 'ACCOUNT',
  BILLING_EVENT: 'BILLING',
  DELIVERY_CANARY: 'PLATFORM',
};

/**
 * Types sent whatever the institute's settings say and outside quiet hours: the registry's
 * critical types and every secret type (a code or password). notification-service tests that
 * this list matches its registry.
 */
export const CRITICAL_NOTIFICATION_TYPES: readonly NotificationTypeKey[] = [
  'AUTH_LOGIN',
  'AUTH_PASSWORD_RESET',
  'AUTH_NEW_DEVICE',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_SESSION_REVOKED',
  'BILLING_EVENT',
  'EMAIL_VERIFICATION',
  'IMPERSONATION_OTP',
  'USER_WELCOME',
];

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
  // No approved template exists for this type and language
  'no_template',
  // The recipient asked this sender to stop
  'opted_out',
  // The sender, or this institute's share of it, reached its daily cap
  'sender_cap',
  // Only on a DEFERRED row: the institute's quiet hours hold the message until they end
  'quiet_hours',
  // The sender is sending as fast as the provider allows, or the provider asked it to slow down
  'rate_limited',
  // The provider or sender keeps failing, so sending through it is paused for a short time
  'provider_paused',
  // Another step or recipient of the flow was reached first, so this one was not tried
  'not_needed',
  // The step's condition did not hold for this notification
  'condition_not_met',
  // The recipient was unlinked after the flow started
  'recipient_removed',
] as const;

export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASON_VALUES)[number];

export const NotificationSkipReason = {
  CHANNEL_DISABLED: 'channel_disabled',
  NO_CONSENT: 'no_consent',
  NO_PROVIDER: 'no_provider',
  NO_ADDRESS: 'no_address',
  NO_TEMPLATE: 'no_template',
  OPTED_OUT: 'opted_out',
  SENDER_CAP: 'sender_cap',
  QUIET_HOURS: 'quiet_hours',
  RATE_LIMITED: 'rate_limited',
  PROVIDER_PAUSED: 'provider_paused',
  NOT_NEEDED: 'not_needed',
  CONDITION_NOT_MET: 'condition_not_met',
  RECIPIENT_REMOVED: 'recipient_removed',
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
  // The recipient opened the message (only where the provider reports it)
  'READ',
  // Held for later; `skip_reason` says why (quiet hours, a full or slowed sender, a paused provider).
  // A later row says how it ended
  'DEFERRED',
] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

export const NotificationDeliveryStatus = Object.fromEntries(
  NOTIFICATION_DELIVERY_STATUS_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationDeliveryStatus]: K };

// ─── NotificationDeliveryState ──────────────────────────────────────────────

/**
 * What the institute's delivery log shows for one message, recipient and channel, derived
 * from all its `notification_deliveries` rows.
 */
export const NOTIFICATION_DELIVERY_STATE_VALUES = [
  // A READ row exists: the recipient opened it
  'READ',
  // A DELIVERED row exists and no READ row: it reached the recipient's device
  'DELIVERED',
  // The latest row is SENT: the provider accepted it and no report has come back yet
  'SENT',
  // The latest row is FAILED: the provider refused it or reported it undeliverable
  'FAILED',
  // The latest row is SKIPPED: never attempted (channel off, no consent, no address, …)
  'SKIPPED',
  // The latest row is DEFERRED: held by quiet hours or a full sender, to be tried later
  'WAITING',
] as const;

export type NotificationDeliveryState = (typeof NOTIFICATION_DELIVERY_STATE_VALUES)[number];

export const NotificationDeliveryState = Object.fromEntries(
  NOTIFICATION_DELIVERY_STATE_VALUES.map((v) => [v, v]),
) as { readonly [K in NotificationDeliveryState]: K };

// ─── MessagingSenderStatus ──────────────────────────────────────────────────

/** State of a WhatsApp sender (`messaging_senders.status`). Only an ACTIVE sender sends. */
export const MESSAGING_SENDER_STATUS_VALUES = [
  // Messages go out through this sender
  'ACTIVE',
  // Switched off by the platform; nothing is sent
  'PAUSED',
  // The provider restricted the number; nothing is sent until it is cleared
  'BLOCKED',
] as const;

export type MessagingSenderStatus = (typeof MESSAGING_SENDER_STATUS_VALUES)[number];

export const MessagingSenderStatus = Object.fromEntries(
  MESSAGING_SENDER_STATUS_VALUES.map((v) => [v, v]),
) as { readonly [K in MessagingSenderStatus]: K };

// ─── MessageTemplateCategory ────────────────────────────────────────────────

/** The provider's price class of a template (`notification_deliveries.template_category`). */
export const MESSAGE_TEMPLATE_CATEGORY_VALUES = [
  // A message about something the recipient's own account or ward did
  'UTILITY',
  // A one-time code
  'AUTHENTICATION',
  // Promotion; charged at a much higher rate
  'MARKETING',
] as const;

export type MessageTemplateCategory = (typeof MESSAGE_TEMPLATE_CATEGORY_VALUES)[number];

export const MessageTemplateCategory = Object.fromEntries(
  MESSAGE_TEMPLATE_CATEGORY_VALUES.map((v) => [v, v]),
) as { readonly [K in MessageTemplateCategory]: K };

// ─── DevicePlatform ─────────────────────────────────────────────────────────

export const DEVICE_PLATFORM_VALUES = ['WEB', 'ANDROID', 'IOS'] as const;

export type DevicePlatform = (typeof DEVICE_PLATFORM_VALUES)[number];

export const DevicePlatform = Object.fromEntries(DEVICE_PLATFORM_VALUES.map((v) => [v, v])) as {
  readonly [K in DevicePlatform]: K;
};
