import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_BUCKETS, type RateLimits, rateLimitsFrom } from '../rate-limit.buckets';
import { RATE_LIMIT_KEY } from '../rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit.guard';
import type { RateLimitStore } from '../rate-limit.store';

const SECRET = 'unit-test-secret';
const LIMITS: RateLimits = rateLimitsFrom(new ConfigService({}));

function httpContext(
  request: { ip?: string; originalUrl?: string; headers?: Record<string, string> },
  marked?: string | false,
): ExecutionContext {
  const handler = () => undefined;
  if (marked !== undefined) Reflect.defineMetadata(RATE_LIMIT_KEY, marked, handler);
  return createMock<ExecutionContext>({
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...request }) }),
  });
}

function guardWith(store: RateLimitStore, limits: RateLimits = LIMITS): RateLimitGuard {
  return new RateLimitGuard(
    new Reflector(),
    store,
    new JwtService({}),
    new ConfigService({ JWT_SECRET: SECRET }),
    limits,
  );
}

const counting = (count: number) =>
  createMock<RateLimitStore>({
    hit: vi.fn().mockResolvedValue({ count, retryAfterSeconds: 17 }),
  });

describe('RateLimitGuard', () => {
  it('should count an anonymous request against its address only', async () => {
    const store = counting(1);

    await guardWith(store).canActivate(httpContext({ ip: '198.51.100.7' }));

    expect(store.hit).toHaveBeenCalledTimes(1);
    expect(store.hit).toHaveBeenCalledWith(
      'general',
      { kind: 'address', id: '198.51.100.7' },
      RATE_LIMIT_BUCKETS.general.windowSeconds,
    );
  });

  it('should count a signed-in request against its address and its user', async () => {
    const store = counting(1);
    const token = new JwtService({}).sign({ sub: 'user-1' }, { secret: SECRET });

    await guardWith(store).canActivate(
      httpContext({ ip: '198.51.100.7', headers: { authorization: `Bearer ${token}` } }),
    );

    expect(vi.mocked(store.hit).mock.calls.map(([bucket, subject]) => [bucket, subject])).toEqual([
      ['general', { kind: 'address', id: '198.51.100.7' }],
      ['user', { kind: 'user', id: 'user-1' }],
    ]);
  });

  it('should not count a token it cannot verify as a user', async () => {
    const store = counting(1);
    const forged = new JwtService({}).sign({ sub: 'user-1' }, { secret: 'another-secret' });

    await guardWith(store).canActivate(
      httpContext({ ip: '198.51.100.7', headers: { authorization: `Bearer ${forged}` } }),
    );

    expect(vi.mocked(store.hit).mock.calls.map(([bucket]) => bucket)).toEqual(['general']);
  });

  it('should also count a marked handler against its own bucket', async () => {
    const store = counting(1);

    await guardWith(store).canActivate(httpContext({ ip: '198.51.100.7' }, 'signIn'));

    expect(vi.mocked(store.hit).mock.calls.map(([bucket]) => bucket)).toEqual([
      'general',
      'signIn',
    ]);
  });

  it('should count a payment webhook against the webhook bucket', async () => {
    const store = counting(1);

    await guardWith(store).canActivate(
      httpContext({ ip: '198.51.100.7', originalUrl: '/api/webhooks/razorpay/abc' }),
    );

    expect(vi.mocked(store.hit).mock.calls.map(([bucket]) => bucket)).toEqual([
      'general',
      'webhook',
    ]);
  });

  it('should count nothing for a handler that is left out', async () => {
    const store = counting(1);

    expect(await guardWith(store).canActivate(httpContext({ ip: '198.51.100.7' }, false))).toBe(
      true,
    );
    expect(store.hit).not.toHaveBeenCalled();
  });

  it('should count nothing for an event handler', async () => {
    const store = counting(1);
    const context = createMock<ExecutionContext>({ getType: () => 'rpc' });

    expect(await guardWith(store).canActivate(context)).toBe(true);
    expect(store.hit).not.toHaveBeenCalled();
  });

  it('should refuse the request over the limit and say when to try again', async () => {
    const store = counting(LIMITS.general.limit + 1);

    await expect(
      guardWith(store).canActivate(httpContext({ ip: '198.51.100.7' })),
    ).rejects.toMatchObject({
      code: ErrorCode.TOO_MANY_REQUESTS,
      message: 'Too many requests. Try again in 17 seconds.',
    });
  });

  it('should accept the request exactly at the limit', async () => {
    const store = counting(LIMITS.general.limit);

    expect(await guardWith(store).canActivate(httpContext({ ip: '198.51.100.7' }))).toBe(true);
  });

  it('should let the request through when the counter store fails', async () => {
    const store = createMock<RateLimitStore>({
      hit: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    expect(await guardWith(store).canActivate(httpContext({ ip: '198.51.100.7' }))).toBe(true);
  });
});

describe('rateLimitsFrom', () => {
  it('should give the written defaults when no multiplier is set', () => {
    expect(rateLimitsFrom(new ConfigService({}))).toEqual(RATE_LIMIT_BUCKETS);
  });

  it('should multiply every limit and keep every window', () => {
    const limits = rateLimitsFrom(new ConfigService({ RATE_LIMIT_MULTIPLIER: '2.5' }));

    expect(limits.signIn).toEqual({ limit: 150, windowSeconds: 60 });
    expect(limits.password).toEqual({ limit: 25, windowSeconds: 60 });
    expect(limits.general.windowSeconds).toBe(RATE_LIMIT_BUCKETS.general.windowSeconds);
  });
});
