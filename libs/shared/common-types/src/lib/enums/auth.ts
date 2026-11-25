/**
 * Auth-domain enums — user, membership, and role lifecycle states.
 *
 * Single source of truth consumed by:
 *   - `libs/database` → `pgEnum(...)` column types
 *   - `apps/api-gateway` → `registerEnumType(...)` + `@IsEnum(...)`
 *   - `apps/web` → Zod schemas, Select options
 */

// ─── UserStatus ─────────────────────────────────────────────────────────────

export const USER_STATUS_VALUES = [
  // User can log in and access all permitted features
  'ACTIVE',
  // Temporarily blocked by a platform admin — cannot log in, data preserved
  'SUSPENDED',
  // Auto-locked after too many failed login attempts — requires admin unlock
  'LOCKED',
] as const;

export type UserStatus = (typeof USER_STATUS_VALUES)[number];
export const UserStatus = Object.fromEntries(USER_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in UserStatus]: K;
};

// ─── FormHelpMode ───────────────────────────────────────────────────────────

export const FORM_HELP_MODE_VALUES = [
  // The ⓘ button, plus a one-sentence hint under the label where the topic has one
  'ICON_AND_HINT',
  // Only the ⓘ button; optional hints are hidden
  'ICON_ONLY',
] as const;

export type FormHelpMode = (typeof FORM_HELP_MODE_VALUES)[number];
export const FormHelpMode = Object.fromEntries(FORM_HELP_MODE_VALUES.map((v) => [v, v])) as {
  readonly [K in FormHelpMode]: K;
};
/** A new account, a signed-out visitor and an impersonator see this mode. */
export const DEFAULT_FORM_HELP_MODE: FormHelpMode = 'ICON_AND_HINT';

// ─── MembershipStatus ───────────────────────────────────────────────────────

export const MEMBERSHIP_STATUS_VALUES = [
  // User is an active member of the institute and can exercise their role's abilities
  'ACTIVE',
  // Membership temporarily frozen by institute admin — user cannot access this institute
  'SUSPENDED',
  // Membership permanently removed — user loses all access and abilities in this institute
  'REVOKED',
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUS_VALUES)[number];
export const MembershipStatus = Object.fromEntries(MEMBERSHIP_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in MembershipStatus]: K;
};

// ─── RoleStatus ─────────────────────────────────────────────────────────────

export const ROLE_STATUS_VALUES = [
  // Role can be assigned to members and its abilities are enforced by CASL
  'ACTIVE',
  // Role is disabled — cannot be assigned to new members, existing holders lose its abilities
  'INACTIVE',
] as const;

export type RoleStatus = (typeof ROLE_STATUS_VALUES)[number];
export const RoleStatus = Object.fromEntries(ROLE_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in RoleStatus]: K;
};

// ─── AuthScope ──────────────────────────────────────────────────────────────
// Three-scope auth model — determines which RLS context, DB role, JWT TTL,
// guard, and module group a request uses. Casing is intentionally lowercase
// to match the JWT `scope` claim and the audit_logs `scope` column already
// in production.

export const AUTH_SCOPE_VALUES = [
  // Roviq super-admin / platform ops — manages the SaaS itself across all tenants
  'platform',
  // Reseller staff — manages institutes onboarded under their reseller
  'reseller',
  // Institute (tenant) member — operates inside a single institute's data
  'institute',
] as const;

export type AuthScope = (typeof AUTH_SCOPE_VALUES)[number];
export const AuthScope = Object.fromEntries(AUTH_SCOPE_VALUES.map((v) => [v, v])) as {
  readonly [K in AuthScope]: K;
};

// ─── AuthSecurityEventType ──────────────────────────────────────────────────
// Events emitted on the `NOTIFICATION.auth.security` subject. Consumed by
// notification-service to decide which message to send and by the
// user's recent-activity feed.

export const AUTH_SECURITY_EVENT_TYPE_VALUES = [
  // Successful sign-in — surfaces in the user's "recent activity" feed
  'LOGIN',
  // User completed the password-reset flow
  'PASSWORD_RESET',
  // Sign-in from a device fingerprint not seen before for this user
  'NEW_DEVICE',
  // Auto-lock after the configured number of failed attempts
  'ACCOUNT_LOCKED',
  // Active session revoked by the user, an admin, or impersonation cleanup
  'SESSION_REVOKED',
  // OTP delivered to the impersonation target for consent confirmation
  'IMPERSONATION_OTP',
  // One-time code sent only to the account's email address, to prove its owner reads it
  'EMAIL_VERIFICATION',
] as const;

export type AuthSecurityEventType = (typeof AUTH_SECURITY_EVENT_TYPE_VALUES)[number];
export const AuthSecurityEventType = Object.fromEntries(
  AUTH_SECURITY_EVENT_TYPE_VALUES.map((v) => [v, v]),
) as { readonly [K in AuthSecurityEventType]: K };

// ─── AuthFailureReason ──────────────────────────────────────────────────────
// Why a sign-in attempt was refused, stored in `auth_events.failure_reason`.
// Internal only: the API answers every one of these with the same generic
// error so a caller cannot tell them apart.

export const AUTH_FAILURE_REASON_VALUES = [
  // No account has the submitted username
  'UNKNOWN_USER',
  // The account exists but the password is wrong
  'INVALID_PASSWORD',
  // The account exists but is not ACTIVE (suspended, deactivated)
  'ACCOUNT_INACTIVE',
  // The attempt arrived while the username was locked out
  'ACCOUNT_LOCKED',
  // Credentials were valid, but the account has no usable membership in the portal used
  'NO_PORTAL_ACCESS',
  // The presented passkey credential is not registered
  'PASSKEY_UNKNOWN',
  // The passkey is registered but its signed response failed verification
  'PASSKEY_VERIFICATION_FAILED',
  // The failed attempt that reached the lockout threshold (on `account_locked` events)
  'TOO_MANY_ATTEMPTS',
] as const;

export type AuthFailureReason = (typeof AUTH_FAILURE_REASON_VALUES)[number];
export const AuthFailureReason = Object.fromEntries(
  AUTH_FAILURE_REASON_VALUES.map((v) => [v, v]),
) as { readonly [K in AuthFailureReason]: K };

// ─── SignInStatus ───────────────────────────────────────────────────────────
// Where a staff member or guardian stands with their first sign-in, as the institute sees it.

export const SIGN_IN_STATUS_VALUES = [
  // The person has signed in and set their own password
  'SIGNED_IN',
  // The latest sign-in details reached the provider on at least one channel
  'DETAILS_SENT',
  // The latest send failed on every channel that had an address
  'SEND_FAILED',
  // Nothing was sent: the person has no real email and no phone
  'NOT_SENT_NO_CONTACT',
  // Nothing was sent yet (created before sending existed, or the send is still running)
  'NOT_SENT',
] as const;

export type SignInStatus = (typeof SIGN_IN_STATUS_VALUES)[number];
export const SignInStatus = Object.fromEntries(SIGN_IN_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in SignInStatus]: K;
};

/** Domain of the address given to an account that has no email; nothing is ever sent to it. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'roviq.placeholder';

export function isPlaceholderEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
