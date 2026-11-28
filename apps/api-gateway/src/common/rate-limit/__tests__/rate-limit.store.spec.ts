import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { REDIS_KEYS } from '../../../auth/redis-keys';
import { RateLimitStore } from '../rate-limit.store';

const SUBJECT = { kind: 'address', id: '198.51.100.7' } as const;

function redisCounting(...counts: number[]) {
  const incr = vi.fn();
  for (const count of counts) incr.mockResolvedValueOnce(count);
  return createMock<Redis>({ incr, expire: vi.fn().mockResolvedValue(1) });
}

describe('RateLimitStore', () => {
  it('should count in a key that names the bucket, the subject and the window', async () => {
    const redis = redisCounting(1);

    await new RateLimitStore(redis).hit('signIn', SUBJECT, 60, 120_500);

    expect(redis.incr).toHaveBeenCalledWith(
      `${REDIS_KEYS.RATE_LIMIT}signIn:address:198.51.100.7:2`,
    );
  });

  it('should set the expiry with the first request of a window only', async () => {
    const redis = redisCounting(1, 2);
    const store = new RateLimitStore(redis);

    await store.hit('signIn', SUBJECT, 60, 120_500);
    await store.hit('signIn', SUBJECT, 60, 121_000);

    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledWith(
      `${REDIS_KEYS.RATE_LIMIT}signIn:address:198.51.100.7:2`,
      60,
    );
  });

  it('should start a new counter in the next window', async () => {
    const redis = redisCounting(1, 1);
    const store = new RateLimitStore(redis);

    await store.hit('signIn', SUBJECT, 60, 179_999);
    await store.hit('signIn', SUBJECT, 60, 180_000);

    expect(vi.mocked(redis.incr).mock.calls.map(([key]) => key)).toEqual([
      `${REDIS_KEYS.RATE_LIMIT}signIn:address:198.51.100.7:2`,
      `${REDIS_KEYS.RATE_LIMIT}signIn:address:198.51.100.7:3`,
    ]);
  });

  it('should say how long the current window still lasts', async () => {
    const redis = redisCounting(5);

    const hit = await new RateLimitStore(redis).hit('signIn', SUBJECT, 60, 120_500);

    expect(hit).toEqual({ count: 5, retryAfterSeconds: 60 });
    expect(
      (await new RateLimitStore(redisCounting(5)).hit('signIn', SUBJECT, 60, 179_001))
        .retryAfterSeconds,
    ).toBe(1);
  });
});
