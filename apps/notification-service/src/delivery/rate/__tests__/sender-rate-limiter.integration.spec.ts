/**
 * The sender rate scripts against a real Redis: atomic under concurrent callers, shared by two
 * limiter instances, the digest reserve, the per-person gap and the provider's throttle.
 */
import { randomUUID } from 'node:crypto';
import { NOTIFICATION_REDIS_KEYS } from '@roviq/redis';
import type Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testRedis } from '../../../__tests__/delivery-limits';
import { SenderRateLimiter } from '../sender-rate-limiter';

describe('SenderRateLimiter (real Redis)', () => {
  let redis: Redis;
  const used: string[] = [];

  const senderId = () => {
    const id = randomUUID();
    used.push(id);
    return id;
  };
  const phone = () => `+9198${Math.floor(Math.random() * 1e8)}`;

  beforeAll(() => {
    redis = testRedis();
  });

  afterAll(async () => {
    for (const id of used) {
      await redis.del(
        `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${id}`,
        `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${id}:queue`,
        `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_THROTTLE}${id}`,
      );
    }
    await redis.quit();
  });

  it('should grant exactly one second of tokens to 50 callers at once', async () => {
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 0 });
    const id = senderId();

    const answers = await Promise.all(
      Array.from({ length: 50 }, () =>
        limiter.take({ senderId: id, messagesPerSecond: 5, phone: phone(), reserve: false }),
      ),
    );

    expect(answers.filter((a) => a.ok)).toHaveLength(5);
  });

  it('should share one bucket between two limiter instances on their own connections', async () => {
    const second = testRedis();
    try {
      const a = new SenderRateLimiter(redis, { recipientGapMs: 0 });
      const b = new SenderRateLimiter(second, { recipientGapMs: 0 });
      const id = senderId();
      const take = (l: SenderRateLimiter) =>
        l.take({ senderId: id, messagesPerSecond: 4, phone: phone(), reserve: false });

      const answers = await Promise.all(
        Array.from({ length: 20 }, (_, i) => take(i % 2 === 0 ? a : b)),
      );

      expect(answers.filter((x) => x.ok)).toHaveLength(4);
    } finally {
      await second.quit();
    }
  });

  it('should give waiting callers slots one rate step apart', async () => {
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 0 });
    const id = senderId();
    const take = () =>
      limiter.take({ senderId: id, messagesPerSecond: 2, phone: phone(), reserve: false });
    await take();
    await take();

    const waits = await Promise.all([take(), take(), take()]);

    const at = waits.map((w) => (w.ok ? 0 : w.retryAt.getTime()));
    expect(at.every((t) => t > 0)).toBe(true);
    const sorted = [...at].sort((x, y) => x - y);
    expect((sorted[1] ?? 0) - (sorted[0] ?? 0)).toBeGreaterThanOrEqual(500);
    expect((sorted[2] ?? 0) - (sorted[1] ?? 0)).toBeGreaterThanOrEqual(500);
  });

  it('should keep the reserved share of the bucket from a digest and give it to others', async () => {
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 0 });
    const id = senderId();
    const take = (reserve: boolean) =>
      limiter.take({ senderId: id, messagesPerSecond: 10, phone: phone(), reserve });

    const digests = [];
    for (let i = 0; i < 10; i += 1) digests.push(await take(true));
    const critical = await take(false);

    // 10 tokens, a digest must leave 3: seven digests go, the eighth waits.
    expect(digests.filter((d) => d.ok)).toHaveLength(7);
    expect(critical).toEqual({ ok: true, grantedAt: expect.any(Date) });
  });

  it('should hold a second message to the same person for the gap', async () => {
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 6_000 });
    const id = senderId();
    const to = phone();
    const take = () =>
      limiter.take({ senderId: id, messagesPerSecond: 10, phone: to, reserve: false });

    await expect(take()).resolves.toEqual({ ok: true, grantedAt: expect.any(Date) });
    const second = await take();
    const other = await limiter.take({
      senderId: id,
      messagesPerSecond: 10,
      phone: phone(),
      reserve: false,
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retryAt.getTime() - Date.now()).toBeGreaterThan(5_000);
    expect(other).toEqual({ ok: true, grantedAt: expect.any(Date) });
  });

  it('should never store the phone number in a key', async () => {
    const limiter = new SenderRateLimiter(redis);
    const id = senderId();
    const to = phone();

    await limiter.take({ senderId: id, messagesPerSecond: 10, phone: to, reserve: false });

    const keys = await redis.keys(`${NOTIFICATION_REDIS_KEYS.NOTIFICATION_RECIPIENT_RATE}${id}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(to.slice(3));
  });

  it("should pause the sender for the provider's Retry-After", async () => {
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 0 });
    const id = senderId();

    const until = await limiter.throttle(id, 10, 2_000);
    const answer = await limiter.take({
      senderId: id,
      messagesPerSecond: 10,
      phone: phone(),
      reserve: false,
    });

    expect(until.getTime() - Date.now()).toBeGreaterThan(1_500);
    expect(answer).toEqual({ ok: false, retryAt: until });
  });

  it('should halve the rate on a throttle without Retry-After and double it back each step', async () => {
    const step = 400;
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 0, recoveryStepMs: step });
    const id = senderId();
    const burst = async () => {
      const answers = await Promise.all(
        Array.from({ length: 20 }, () =>
          limiter.take({ senderId: id, messagesPerSecond: 8, phone: phone(), reserve: false }),
        ),
      );
      return answers.filter((a) => a.ok).length;
    };

    await limiter.throttle(id, 8, null);
    await redis.del(`${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${id}`);
    const halved = await burst();
    await new Promise((resolve) => setTimeout(resolve, step + 50));
    await redis.del(`${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${id}`);
    const recovered = await burst();

    expect(halved).toBe(4);
    expect(recovered).toBe(8);
  });

  it('should treat throttles within a second of each other as one halving', async () => {
    const limiter = new SenderRateLimiter(redis, { recipientGapMs: 0 });
    const id = senderId();

    await Promise.all([limiter.throttle(id, 8, null), limiter.throttle(id, 8, null)]);

    const rate = await redis.hget(
      `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_THROTTLE}${id}`,
      'rate',
    );
    expect(Number(rate)).toBe(4);
  });
});
