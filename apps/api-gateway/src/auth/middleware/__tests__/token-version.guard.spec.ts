/**
 * TokenVersionGuard unit tests — the cache and floor logic. A real password change cutting
 * off a real token is covered by must-change-password.integration.spec.ts.
 */
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { type AuthUser, ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectBusinessError } from '../../../__tests__/expect-business-error';
import { recordTokenVersion } from '../../token-version-cache';
import { TokenVersionGuard } from '../token-version.guard';

vi.mock('@roviq/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roviq/database')>();
  return {
    ...actual,
    withAdmin: vi.fn(async (_db: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn((globalThis as { __rovTokenVersionTx?: unknown }).__rovTokenVersionTx),
    ),
  };
});

vi.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: { create: vi.fn() },
}));

const USER_ID = '33333333-3333-4333-a333-333333333333';
const CACHE_KEY = `auth:token-version:${USER_ID}`;
const FLOOR_KEY = `${CACHE_KEY}:floor`;

type VerifyOverload = (token: string, options?: Parameters<JwtService['verify']>[1]) => object;

function stubRequest(req: {
  user?: AuthUser;
  headers?: Record<string, string | string[] | undefined>;
}): void {
  vi.mocked(GqlExecutionContext.create).mockReturnValue(
    createMock<GqlExecutionContext>({ getContext: () => ({ req }) }),
  );
}

const user = (overrides: Partial<AuthUser> = {}): AuthUser =>
  ({
    _scope: 'reseller',
    scope: 'reseller',
    userId: USER_ID,
    resellerId: 'reseller-1',
    membershipId: 'membership-1',
    roleId: 'role-1',
    type: 'access',
    mustChangePassword: false,
    tokenVersion: 2,
    ...overrides,
  }) as AuthUser;

function setUserRow(row: { tokenVersion: number } | null): ReturnType<typeof vi.fn> {
  const limit = vi.fn(() => Promise.resolve(row === null ? [] : [row]));
  (globalThis as { __rovTokenVersionTx?: unknown }).__rovTokenVersionTx = {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  };
  return limit;
}

function createGuard(stored: Record<string, string> = {}, jwtVerify?: VerifyOverload) {
  const redis = createMock<Redis>({
    get: vi.fn(async (key: string) => stored[key] ?? null),
    set: vi.fn().mockResolvedValue('OK'),
  });
  const jwt = createMock<JwtService>({
    verify: vi.fn<VerifyOverload>(jwtVerify ?? (() => ({}))),
  });
  const config = createMock<ConfigService>({ getOrThrow: vi.fn(() => 'test-secret') });
  return { guard: new TokenVersionGuard(redis, createMock(), jwt, config), redis };
}

const context = createMock<ExecutionContext>({
  switchToHttp: vi.fn().mockReturnValue({ getRequest: () => undefined }),
});

describe('TokenVersionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { __rovTokenVersionTx?: unknown }).__rovTokenVersionTx = undefined;
  });

  it('lets a request without a token through without touching Redis', async () => {
    stubRequest({});
    const { guard, redis } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('lets an impersonation token through: it ends with its session', async () => {
    stubRequest({ user: user({ isImpersonated: true, tokenVersion: 0 }) });
    const { guard, redis } = createGuard({ [CACHE_KEY]: '9', [FLOOR_KEY]: '9' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('accepts a token issued with the current version, from the cache', async () => {
    stubRequest({ user: user({ tokenVersion: 2 }) });
    const lookup = setUserRow({ tokenVersion: 7 });
    const { guard } = createGuard({ [CACHE_KEY]: '2' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a token issued before the version was raised', async () => {
    stubRequest({ user: user({ tokenVersion: 2 }) });
    const { guard } = createGuard({ [CACHE_KEY]: '3' });

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('reads the claim from the Bearer token when passport has not run yet', async () => {
    stubRequest({ headers: { authorization: 'Bearer raw.jwt.token' } });
    const { guard } = createGuard({ [CACHE_KEY]: '5' }, () => ({ sub: USER_ID, tv: 4 }));

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('treats a token without the claim as version 0', async () => {
    stubRequest({ headers: { authorization: 'Bearer raw.jwt.token' } });
    const fresh = createGuard({ [CACHE_KEY]: '0' }, () => ({ sub: USER_ID }));
    await expect(fresh.guard.canActivate(context)).resolves.toBe(true);

    const changed = createGuard({ [CACHE_KEY]: '1' }, () => ({ sub: USER_ID }));
    await expectBusinessError(changed.guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('loads the version from the database on a cache miss and caches it for a minute', async () => {
    stubRequest({ user: user({ tokenVersion: 2 }) });
    setUserRow({ tokenVersion: 3 });
    const { guard, redis } = createGuard();

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, '3', 'EX', 60);
  });

  it('lets a token through when its user row is gone; the resolvers answer for that', async () => {
    stubRequest({ user: user({ tokenVersion: 0 }) });
    setUserRow(null);
    const { guard } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('obeys the floor over a stale lower cache entry written by a racing request', async () => {
    stubRequest({ user: user({ tokenVersion: 2 }) });
    const { guard } = createGuard({ [CACHE_KEY]: '2', [FLOOR_KEY]: '3' });

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('recordTokenVersion writes the cache and a floor that outlives it', async () => {
    const redis = createMock<Redis>({ set: vi.fn().mockResolvedValue('OK') });

    await recordTokenVersion(redis, USER_ID, 3);

    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, '3', 'EX', 60);
    expect(redis.set).toHaveBeenCalledWith(FLOOR_KEY, '3', 'EX', 70);
  });
});
