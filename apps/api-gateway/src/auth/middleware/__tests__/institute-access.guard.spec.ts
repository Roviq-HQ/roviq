/**
 * InstituteAccessGuard unit tests — the cache and marker logic. A real status change cutting
 * off a real token is covered by institute-status-access.integration.spec.ts.
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
import { recordInstituteAccess } from '../../institute-access-cache';
import { InstituteAccessGuard } from '../institute-access.guard';

vi.mock('@roviq/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roviq/database')>();
  return {
    ...actual,
    withAdmin: vi.fn(async (_db: unknown, _ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn((globalThis as { __rovInstituteGuardTx?: unknown }).__rovInstituteGuardTx),
    ),
  };
});

vi.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: { create: vi.fn() },
}));

const TENANT_ID = '22222222-2222-4222-a222-222222222222';
const CACHE_KEY = `auth:institute-access:${TENANT_ID}`;
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

const instituteUser = (overrides: Partial<AuthUser> = {}): AuthUser =>
  ({
    _scope: 'institute',
    scope: 'institute',
    userId: 'user-1',
    tenantId: TENANT_ID,
    resellerId: 'reseller-1',
    membershipId: 'membership-1',
    roleId: 'role-1',
    type: 'access',
    mustChangePassword: false,
    ...overrides,
  }) as AuthUser;

const resellerUser = (): AuthUser => ({
  _scope: 'reseller',
  scope: 'reseller',
  userId: 'staff-1',
  resellerId: 'reseller-1',
  membershipId: 'membership-2',
  roleId: 'role-2',
  type: 'access',
  mustChangePassword: false,
});

function setInstituteRow(row: { status: string } | null): void {
  const limit = vi.fn(() => Promise.resolve(row === null ? [] : [row]));
  (globalThis as { __rovInstituteGuardTx?: unknown }).__rovInstituteGuardTx = {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  };
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
  return { guard: new InstituteAccessGuard(redis, createMock(), jwt, config), redis };
}

const context = createMock<ExecutionContext>({
  switchToHttp: vi.fn().mockReturnValue({ getRequest: () => undefined }),
});

describe('InstituteAccessGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { __rovInstituteGuardTx?: unknown }).__rovInstituteGuardTx = undefined;
  });

  it('lets a request without a token through without touching Redis', async () => {
    stubRequest({});
    const { guard, redis } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('lets a reseller token through', async () => {
    stubRequest({ user: resellerUser() });
    const { guard, redis } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('lets an impersonation token into an institute that is blocked', async () => {
    stubRequest({ user: instituteUser({ isImpersonated: true }) });
    const { guard, redis } = createGuard({ [BLOCKED_KEY]: '1', [CACHE_KEY]: 'blocked' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('reads the institute on a cache miss and caches "allowed" for an active one', async () => {
    stubRequest({ user: instituteUser() });
    setInstituteRow({ status: 'ACTIVE' });
    const { guard, redis } = createGuard();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'allowed', 'EX', 60);
  });

  it.each([
    'PENDING_APPROVAL',
    'PENDING',
    'INACTIVE',
    'SUSPENDED',
    'REJECTED',
  ])('rejects and caches "blocked" for a %s institute', async (status) => {
    stubRequest({ user: instituteUser() });
    setInstituteRow({ status });
    const { guard, redis } = createGuard();

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'blocked', 'EX', 60);
  });

  it('rejects when the institute no longer exists', async () => {
    stubRequest({ user: instituteUser() });
    setInstituteRow(null);
    const { guard } = createGuard();

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('lets the block marker win over a cached "allowed"', async () => {
    stubRequest({ user: instituteUser() });
    const { guard } = createGuard({ [BLOCKED_KEY]: '1', [CACHE_KEY]: 'allowed' });

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });

  it('verifies the Bearer token itself when req.user is not set yet', async () => {
    stubRequest({ headers: { authorization: 'Bearer signed.jwt.value' } });
    const { guard } = createGuard({ [CACHE_KEY]: 'blocked' }, () => ({
      scope: 'institute',
      tenantId: TENANT_ID,
    }));

    await expectBusinessError(guard.canActivate(context), ErrorCode.UNAUTHENTICATED);
  });
});

describe('recordInstituteAccess', () => {
  it('blocks at once when the institute leaves ACTIVE', async () => {
    const redis = createMock<Redis>({ set: vi.fn().mockResolvedValue('OK') });

    await recordInstituteAccess(redis, TENANT_ID, 'SUSPENDED');

    expect(redis.set).toHaveBeenCalledWith(CACHE_KEY, 'blocked', 'EX', 60);
    expect(redis.set).toHaveBeenCalledWith(BLOCKED_KEY, '1', 'EX', 70);
  });

  it('drops both keys when the institute becomes ACTIVE', async () => {
    const redis = createMock<Redis>({ del: vi.fn().mockResolvedValue(2) });

    await recordInstituteAccess(redis, TENANT_ID, 'ACTIVE');

    expect(redis.del).toHaveBeenCalledWith(CACHE_KEY, BLOCKED_KEY);
  });
});
