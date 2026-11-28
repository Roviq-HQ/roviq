import type { ConfigService } from '@nestjs/config';

/**
 * Request limits of the API gateway. Every handler call counts against `general` (by client
 * address) and, with a valid access token, against `user`; a handler marked `@RateLimit(name)`
 * also counts against that bucket. What each number was measured against:
 * docs/auth.md → "Request limits".
 */
export const RATE_LIMIT_BUCKETS = {
  /** Every request from one address. High: a whole institute office shares one address. */
  general: { limit: 3000, windowSeconds: 60 },
  /** Every request of one signed-in user, whatever address it comes from. */
  user: { limit: 600, windowSeconds: 60 },
  /** Sign-in in any portal, and choosing or switching the institute. */
  signIn: { limit: 60, windowSeconds: 60 },
  /** Exchanging a refresh token for a new access token. */
  refresh: { limit: 120, windowSeconds: 60 },
  /** Changing a password. */
  password: { limit: 10, windowSeconds: 60 },
  /** Requesting or entering a one-time code (e-mail verification, impersonation approval). */
  oneTimeCode: { limit: 10, windowSeconds: 60 },
  /** Passkey registration and sign-in challenges and their answers. */
  passkey: { limit: 30, windowSeconds: 60 },
  /** Starting an impersonation session or exchanging its code. */
  impersonation: { limit: 20, windowSeconds: 60 },
  /** Lookups open to anyone, such as verifying a transfer certificate. */
  publicLookup: { limit: 30, windowSeconds: 60 },
  /** Payment provider webhooks; a provider delivers in bursts from few addresses. */
  webhook: { limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimit>;

export interface RateLimit {
  limit: number;
  windowSeconds: number;
}

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;
/** A bucket a handler can be marked with; `general` and `user` apply to every handler. */
export type NamedRateLimitBucket = Exclude<RateLimitBucket, 'general' | 'user'>;
export type RateLimits = Readonly<Record<RateLimitBucket, RateLimit>>;

/** Injection token of the limits in force. */
export const RATE_LIMITS = Symbol('RATE_LIMITS');

/**
 * The limits in force: the defaults times `RATE_LIMIT_MULTIPLIER`. Production leaves the
 * multiplier at 1. A stack whose every request comes from one address by design (the e2e
 * stack, a load test) sets it higher, in its own configuration.
 */
export function rateLimitsFrom(config: Pick<ConfigService, 'get'>): RateLimits {
  const multiplier = Number(config.get('RATE_LIMIT_MULTIPLIER') ?? 1);
  const scaled = Object.entries(RATE_LIMIT_BUCKETS).map(([name, bucket]) => [
    name,
    { limit: Math.ceil(bucket.limit * multiplier), windowSeconds: bucket.windowSeconds },
  ]);
  return Object.fromEntries(scaled) as RateLimits;
}
