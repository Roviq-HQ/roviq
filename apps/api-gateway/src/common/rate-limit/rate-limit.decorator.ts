import { SetMetadata } from '@nestjs/common';
import type { NamedRateLimitBucket } from './rate-limit.buckets';

export const RATE_LIMIT_KEY = 'rate-limit:bucket';

/** Counts each call of this handler against a stricter bucket as well as the general ones. */
export const RateLimit = (bucket: NamedRateLimitBucket) => SetMetadata(RATE_LIMIT_KEY, bucket);

/**
 * Leaves this handler or controller out of every bucket. Only for a probe that must keep
 * answering whatever else an address is doing, and whose own cost is bounded.
 */
export const NoRateLimit = () => SetMetadata(RATE_LIMIT_KEY, false);
