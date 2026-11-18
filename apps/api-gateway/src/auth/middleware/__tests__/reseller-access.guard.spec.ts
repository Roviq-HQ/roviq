/**
 * ResellerAccessGuard unit tests — the cache and marker logic. The end-to-end
 * behaviour (a real suspension cutting off a real token) is covered by
 * reseller-suspension.integration.spec.ts.
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
import { ResellerAccessGuard } from '../reseller-access.guard';

vi.mock('@roviq/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roviq/database')>();
  return {
    ...actual,
    withAdmin: vi.fn(async (_db: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn((globalThis as { __rovResellerGuardTx?: unknown }).__rovResellerGuardTx),
    ),
  };
});

vi.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: { create: vi.fn() },
}));

const RESELLER_ID = '11111111-1111-4111-a111-111111111111';
const CACHE_KEY = `auth:reseller-access:${RESELLER_ID}`;
const BLOCKED_KEY = `${CACHE_KEY}:blocked`;

type VerifyOverload = (token: string, options?: Parameters<JwtService['verify']>[1]) => object;

interface RequestStub {
  user?: AuthUser;
  headers?: Record<string, string | string[] | undefined>;
}

function stubRequest(req: RequestStub): void {
  vi.mocked(GqlExecutionContext.create).mockReturnValue(
    createMock<GqlExecutionContext>({ getContext: () => ({ req }) }),
  );
}

const resellerUser = (): AuthUser => ({
  _scope: 'reseller',
  scope: 'reseller',
  userId: 'staff-1',
  resellerId: RESELLER_ID,
  membershipId: 'membership-1',
  roleId: 'role-1',
  type: 'access',
  mustChangePassword: false,
});

const instituteUser = (): AuthUser => ({
  _scope: 'institute',
  scope: 'institute',
  userId: 'user-1',
  tenantId: 'tenant-1',
  resellerId: RESELLER_ID,
  membershipId: 'membership-2',
  roleId: 'role-2',
  type: 'access',
  mustChangePassword: false,
});

function setResellerRow(
  row: { status: string; isActive: boolean } | null,
): ReturnType<typeof vi.fn> {
  const limit = vi.fn(() => Promise.resolve(row === null ? [] : [row]));
  (globalThis as { __rovResellerGuardTx?: unknown }).__rovResellerGuardTx = {
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
  return { guard: new ResellerAccessGuard(redis, createMock(), jwt, config), redis };
}

const context = createMock<ExecutionContext>({
  switchToHttp: vi.fn().mockReturnValue({ getRequest: () => undefined }),
});

describe('ResellerAccessGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { __rovResellerGuardTx?: unknown }).__rovResellerGuardTx = undefined;
  });

  it('lets a request without a token through without touching Redis', async () => {
    stubRequest({});
    const { guard, redis } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('lets an institute token through even when it names a blocked reseller', async () => {
    stubRequest({ user: instituteUser() });
    const { guard, redis } = createGuard({ [BLOCKED_KEY]: '1', [CACHE_KEY]: 'blocked' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('reads the reseller on a cache miss and caches "allowed" for an active one', async () => {
    stubRequest({ user: resellerUser() });
    setResellerRow({ status: 'ACTIVE', isActive: true });
    const { guard, redis } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'allowed', 'EX', 60);
  });

  it('rejects and caches "blocked" for a suspended reseller', async () => {
    stubRequest({ user: resellerUser() });
    setResellerRow({ status: 'SUSPENDED', isActive: false });
    const { guard, redis } = createGuard();

    await expectBusinessError(() => guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'blocked', 'EX', 60);
  });

  it('rejects when the reseller row is gone (deleted)', async () => {
    stubRequest({ user: resellerUser() });
    setResellerRow(null);
    const { guard } = createGuard();

    await expectBusinessError(() => guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('trusts a cached "allowed" without reading the database', async () => {
    stubRequest({ user: resellerUser() });
    const limit = setResellerRow({ status: 'SUSPENDED', isActive: false });
    const { guard } = createGuard({ [CACHE_KEY]: 'allowed' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(limit).not.toHaveBeenCalled();
  });

  it('lets the block marker win over a stale cached "allowed"', async () => {
    stubRequest({ user: resellerUser() });
    const { guard } = createGuard({ [BLOCKED_KEY]: '1', [CACHE_KEY]: 'allowed' });

    await expectBusinessError(() => guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('checks the Bearer token when req.user is not populated yet', async () => {
    stubRequest({ headers: { authorization: 'Bearer some.jwt.token' } });
    const { guard } = createGuard({ [BLOCKED_KEY]: '1' }, () => ({
      scope: 'reseller',
      resellerId: RESELLER_ID,
    }));

    await expectBusinessError(() => guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });
});
