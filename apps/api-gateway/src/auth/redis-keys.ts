import { NOTIFICATION_REDIS_KEYS } from '@roviq/redis';

export const REDIS_KEYS = {
  /** Written by the notification service (sender rate, throttle, breakers). */
  ...NOTIFICATION_REDIS_KEYS,
  IMPERSONATION_CODE: 'impersonation-code:',
  IMPERSONATION_SESSION: 'impersonation-session:',
  IMPERSONATION_OTP: 'impersonation-otp:',
  WS_TICKET: 'ws-ticket:',
  /** Request counter of one bucket, subject and window: `<bucket>:<address|user>:<id>:<window>`. EX = the window. */
  RATE_LIMIT: 'rate-limit:',
  /** A user's pending passkey registration challenge, keyed by user id. EX = challenge lifetime. */
  WEBAUTHN_REGISTRATION: 'webauthn:reg:',
  /** A pending passkey sign-in challenge, keyed by a random challenge id. EX = challenge lifetime. */
  WEBAUTHN_AUTH: 'webauthn:auth:',
  /** Cached "may this reseller's staff use the API" answer, keyed by reseller id. */
  RESELLER_ACCESS: 'auth:reseller-access:',
  /** Cached "may this institute's members use the API" answer, keyed by institute id. */
  INSTITUTE_ACCESS: 'auth:institute-access:',
  /** Role a reseller membership's access tokens must carry, or `blocked`; written when a member is changed. */
  RESELLER_MEMBER_ACCESS: 'auth:reseller-member-access:',
  /** Current `users.token_version` of a user; access tokens issued with a lower one are refused. */
  TOKEN_VERSION: 'auth:token-version:',
  /** SHA-256 of a user's pending email verification code; `:attempts` counts the guesses. EX = code lifetime. */
  EMAIL_VERIFICATION: 'auth:email-verify:',
  /** Resends of a user's sign-in details: `<userId>:minute` (NX, EX 60) and `<userId>:day` (counter, EX 1 day). */
  SIGN_IN_RESEND: 'auth:sign-in-resend:',
  /** Sliding-window counter for failed login attempts, keyed by lowercased username. EX = FAILURE_WINDOW_SECONDS. */
  LOGIN_FAILURES: 'auth:failed-login:',
  /** Active lockout marker for a username. Presence ⇒ login is blocked for LOCKOUT_DURATION_SECONDS. */
  LOGIN_LOCKED: 'auth:locked:',
  /** Hourly uptime bucket hash `{ up, total }`, keyed `<MonitoredService>:<hourEpoch>`. EX = 25h, read back over the last 24 buckets. */
  SYSTEM_HEALTH_UPTIME: 'monitoring:uptime:',
} as const;
