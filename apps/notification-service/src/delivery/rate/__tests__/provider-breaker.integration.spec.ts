/**
 * The breaker scripts against a real Redis: opening, one probe at a time under concurrent
 * callers, closing and reopening. Short constants stand in for the minute-long defaults.
 */
import { randomUUID } from 'node:crypto';
import { NOTIFICATION_REDIS_KEYS } from '@roviq/redis';
import type Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testRedis } from '../../../__tests__/delivery-limits';
import { ProviderBreaker } from '../provider-breaker';

const COOLDOWN_MS = 300;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ProviderBreaker (real Redis)', () => {
  let redis: Redis;
  let breaker: ProviderBreaker;
  const used: string[] = [];

  const name = () => {
    const n = `adapter:EMAIL:spec-${randomUUID()}`;
    used.push(n);
    return n;
  };
  const fail = async (n: string, times: number) => {
    const opened: boolean[] = [];
    for (let i = 0; i < times; i += 1) opened.push(await breaker.failed(n));
    return opened;
  };

  beforeAll(() => {
    redis = testRedis();
    breaker = new ProviderBreaker(redis, {
      failures: 5,
      windowMs: 10_000,
      cooldownMs: COOLDOWN_MS,
      probeLeaseMs: 5_000,
    });
  });

  afterAll(async () => {
    if (used.length > 0) {
      await redis.del(...used.map((n) => `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}${n}`));
    }
    await redis.quit();
  });

  it('should stay closed below the threshold and open on the fifth failure', async () => {
    const n = name();

    const opened = await fail(n, 5);
    const answer = await breaker.allow(n);

    expect(opened).toEqual([false, false, false, false, true]);
    expect(answer.ok).toBe(false);
  });

  it('should start counting again after a success', async () => {
    const n = name();

    await fail(n, 4);
    await breaker.succeeded(n);
    const opened = await fail(n, 4);

    expect(opened).toEqual([false, false, false, false]);
    await expect(breaker.allow(n)).resolves.toEqual({ ok: true });
  });

  it('should count only failures inside the window', async () => {
    const short = new ProviderBreaker(redis, { failures: 3, windowMs: 200, cooldownMs: 1_000 });
    const n = name();

    await short.failed(n);
    await short.failed(n);
    await wait(250);
    const third = await short.failed(n);

    expect(third).toBe(false);
  });

  it('should let exactly one probe through after the cool-down, even to many callers', async () => {
    const n = name();
    await fail(n, 5);
    await wait(COOLDOWN_MS + 50);

    const answers = await Promise.all(Array.from({ length: 20 }, () => breaker.allow(n)));

    expect(answers.filter((a) => a.ok)).toHaveLength(1);
  });

  it('should close on a successful probe', async () => {
    const n = name();
    await fail(n, 5);
    await wait(COOLDOWN_MS + 50);
    await breaker.allow(n);

    await breaker.succeeded(n);

    await expect(breaker.allow(n)).resolves.toEqual({ ok: true });
    await expect(breaker.allow(n)).resolves.toEqual({ ok: true });
  });

  it('should reopen on a failed probe and report it as opened', async () => {
    const n = name();
    await fail(n, 5);
    await wait(COOLDOWN_MS + 50);
    await breaker.allow(n);

    const reopened = await breaker.failed(n);
    const answer = await breaker.allow(n);

    expect(reopened).toBe(true);
    expect(answer.ok).toBe(false);
  });

  it('should not close on a late success while open', async () => {
    const n = name();
    await fail(n, 5);

    await breaker.succeeded(n);

    expect((await breaker.allow(n)).ok).toBe(false);
  });

  it('should open at once on a trip and report it only once', async () => {
    const n = name();

    const first = await breaker.trip(n);
    const second = await breaker.trip(n);
    const answer = await breaker.allow(n);

    expect([first, second]).toEqual([true, false]);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.retryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should name as open the breakers that are open or probing, not closed or unknown ones', async () => {
    const [open, probing, failing, closed, unknown] = [name(), name(), name(), name(), name()];
    await breaker.trip(open);
    await breaker.trip(probing);
    await wait(COOLDOWN_MS + 50);
    expect((await breaker.allow(probing)).ok).toBe(true);
    await fail(failing, 2);
    await breaker.trip(closed);
    await wait(COOLDOWN_MS + 50);
    await breaker.allow(closed);
    await breaker.succeeded(closed);

    const found = await breaker.openAmong([open, probing, failing, closed, unknown]);

    expect([...found].sort()).toEqual([open, probing].sort());
    await expect(breaker.openAmong([])).resolves.toEqual(new Set());
  });
});
