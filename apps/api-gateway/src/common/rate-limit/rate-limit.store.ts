import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { REDIS_KEYS } from '../../auth/redis-keys';

/** Whose requests a counter adds up. */
export type RateLimitSubject = { kind: 'address' | 'user'; id: string };

/**
 * Fixed-window counters in Redis. The window's number is part of the key, so a counter that
 * lost its expiry is simply never read again.
 */
@Injectable()
export class RateLimitStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Adds one to the subject's counter for the current window and returns the new count. */
  async hit(
    bucket: string,
    subject: RateLimitSubject,
    windowSeconds: number,
    now = Date.now(),
  ): Promise<{ count: number; retryAfterSeconds: number }> {
    const windowMs = windowSeconds * 1000;
    const window = Math.floor(now / windowMs);
    const key = `${REDIS_KEYS.RATE_LIMIT}${bucket}:${subject.kind}:${subject.id}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return { count, retryAfterSeconds: Math.ceil(((window + 1) * windowMs - now) / 1000) };
  }
}
