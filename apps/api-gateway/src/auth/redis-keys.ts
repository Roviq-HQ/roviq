export const REDIS_KEYS = {
  IMPERSONATION_CODE: 'impersonation-code:',
  IMPERSONATION_SESSION: 'impersonation-session:',
  IMPERSONATION_OTP: 'impersonation-otp:',
  WS_TICKET: 'ws-ticket:',
  /** Cached "may this reseller's staff use the API" answer, keyed by reseller id. */
  RESELLER_ACCESS: 'auth:reseller-access:',
  /** Cached "may this institute's members use the API" answer, keyed by institute id. */
  INSTITUTE_ACCESS: 'auth:institute-access:',
  /** Role a reseller membership's access tokens must carry, or `blocked`; written when a member is changed. */
  RESELLER_MEMBER_ACCESS: 'auth:reseller-member-access:',
  /** Sliding-window counter for failed login attempts, keyed by lowercased username. EX = FAILURE_WINDOW_SECONDS. */
  LOGIN_FAILURES: 'auth:failed-login:',
  /** Active lockout marker for a username. Presence ⇒ login is blocked for LOCKOUT_DURATION_SECONDS. */
  LOGIN_LOCKED: 'auth:locked:',
  /** Hourly uptime bucket hash `{ up, total }`, keyed `<MonitoredService>:<hourEpoch>`. EX = 25h, read back over the last 24 buckets. */
  SYSTEM_HEALTH_UPTIME: 'monitoring:uptime:',
} as const;
