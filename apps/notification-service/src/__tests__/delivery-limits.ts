import { createMock } from '@roviq/testing';
import Redis from 'ioredis';
import { vi } from 'vitest';
import type { ProviderBreaker } from '../delivery/rate/provider-breaker';
import type { SenderRateLimiter } from '../delivery/rate/sender-rate-limiter';

/**
 * For specs about something else: every sender has a token and every breaker is closed. The
 * rate and breaker specs use the real classes on a real Redis instead (`testRedis`).
 */
export function noDeliveryLimits(): [SenderRateLimiter, ProviderBreaker] {
  return [
    createMock<SenderRateLimiter>({
      take: vi.fn().mockResolvedValue({ ok: true }),
      throttle: vi.fn().mockResolvedValue(new Date()),
    }),
    createMock<ProviderBreaker>({
      allow: vi.fn().mockResolvedValue({ ok: true }),
      succeeded: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(false),
      trip: vi.fn().mockResolvedValue(false),
    }),
  ];
}

/**
 * This instance's dev Redis, database 15, so test keys never mix with the dev app's. Keys are
 * per sender id or per provider name made for the run, so specs running at once do not meet.
 */
export function testRedis(): Redis {
  const url =
    process.env.REDIS_TEST_URL ??
    `redis://:roviq_redis_dev@localhost:${process.env.DEV_REDIS_PORT ?? '6379'}/15`;
  return new Redis(url, { maxRetriesPerRequest: 1 });
}
