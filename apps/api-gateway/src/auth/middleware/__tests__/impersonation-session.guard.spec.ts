/**
 * ImpersonationSessionGuard unit tests.
 *
 * Covers:
 *   - Dual auth source: `req.user` (HTTP passport-jwt + WS extra.user copy)
 *     wins over the Bearer header fallback.
 *   - Bearer header fallback triggers only when `req.user` is absent — the
 *     APP_GUARD-before-passport-jwt ordering case.
 *   - Tombstone short-circuit closes the DB→cache race on `endImpersonation`.
 *   - Fast-path: non-impersonation requests fall through.
 *
 * `@roviq/database` is mocked so `withAdmin` invokes the guard's callback
 * against a per-test transaction stub. We don't assert SQL shape — only
 * Redis reads/writes and exception payloads.
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
import { ImpersonationSessionGuard } from '../impersonation-session.guard';

// ── Module-level mocks ─────────────────────────────────────────

vi.mock('@roviq/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roviq/database')>();
  return {
    ...actual,
    withAdmin: vi.fn(
      async (_db: unknown, ctxOrFn: unknown, fnArg?: (tx: unknown) => Promise<unknown>) => {
        const cb =
          typeof ctxOrFn === 'function'
            ? (ctxOrFn as (tx: unknown) => Promise<unknown>)
            : (fnArg as (tx: unknown) => Promise<unknown>);
        const tx = (globalThis as { __rovGuardTx?: unknown }).__rovGuardTx;
        return cb(tx);
      },
    ),
  };
});

vi.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: vi.fn(),
  },
}));

const mockedGqlCreate = vi.mocked(GqlExecutionContext.create);

// ── Helpers ────────────────────────────────────────────────────

const SESSION_ID = 'sess-1';

function makeImpersonatedUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    _scope: 'institute',
    userId: 'target-1',
    scope: 'institute',
    tenantId: 'tenant-1',
    membershipId: 'mem-1',
    roleId: 'role-1',
    type: 'access',
    isImpersonated: true,
    impersonatorId: 'admin-1',
    impersonationSessionId: SESSION_ID,
    ...overrides,
  } as AuthUser;
}

function makeExecutionContext(): ExecutionContext {
  return createMock<ExecutionContext>({
    getType: vi.fn().mockReturnValue('graphql'),
    getHandler: vi.fn().mockReturnValue(() => {}),
    getClass: vi.fn().mockReturnValue(class {}),
    switchToHttp: vi.fn().mockReturnValue({ getRequest: () => undefined }),
  });
}

interface RawGqlContext {
  req?:
    | {
        user?: AuthUser;
        headers?: Record<string, string | string[] | undefined>;
      }
    | undefined;
  extra?: unknown;
}

function stubGqlContext(raw: RawGqlContext): void {
  mockedGqlCreate.mockReturnValue(
    createMock<GqlExecutionContext>({
      getContext: () => raw as Record<string, unknown>,
    }),
  );
}

/** Build a Drizzle tx stub that resolves a single select → limit(1) call with
 *  the supplied row set. We don't need join/where branches; the guard only
 *  issues one select from `impersonationSessions`. */
function setSessionRow(
  row: { endedAt?: Date | null; endedReason?: string | null; expiresAt: Date } | null,
): void {
  const rows = row === null ? [] : [row];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
  (globalThis as { __rovGuardTx?: unknown }).__rovGuardTx = tx;
}

/**
 * `JwtService.verify` is overloaded (`(token, opts?) => object` plus a generic
 * variant). Picking the non-generic overload explicitly keeps `createMock`
 * type-safe without needing an `as unknown` escape hatch.
 */
type VerifyOverload = (token: string, options?: Parameters<JwtService['verify']>[1]) => object;

function createGuard(
  overrides: { redisGet?: (k: string) => Promise<string | null>; jwtVerify?: VerifyOverload } = {},
): { guard: ImpersonationSessionGuard; redis: Redis; jwt: JwtService } {
  const redis = createMock<Redis>({
    get: vi.fn(overrides.redisGet ?? (async () => null)),
    set: vi.fn().mockResolvedValue('OK'),
  });
  const jwt = createMock<JwtService>({
    verify: vi.fn<VerifyOverload>(overrides.jwtVerify ?? (() => ({}))),
  });
  const config = createMock<ConfigService>({
    getOrThrow: vi.fn(() => 'test-secret'),
  });
  const guard = new ImpersonationSessionGuard(redis, createMock(), jwt, config);
  return { guard, redis, jwt };
}

async function expectImpersonationEnded(fn: () => Promise<unknown>): Promise<void> {
  await expectBusinessError(fn, ErrorCode.IMPERSONATION_ENDED);
}

// ── Tests ──────────────────────────────────────────────────────

describe('ImpersonationSessionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { __rovGuardTx?: unknown }).__rovGuardTx = undefined;
  });

  describe('req.user source (HTTP passport-jwt OR WS extra.user copy)', () => {
    it('passes through an active impersonation session', async () => {
      const { guard } = createGuard();
      stubGqlContext({ req: { user: makeImpersonatedUser() } });
      setSessionRow({
        endedAt: null,
        endedReason: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('throws IMPERSONATION_ENDED when DB row has endedAt set', async () => {
      const { guard } = createGuard();
      stubGqlContext({ req: { user: makeImpersonatedUser() } });
      setSessionRow({
        endedAt: new Date(),
        endedReason: 'manual',
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expectImpersonationEnded(() => guard.canActivate(makeExecutionContext()));
    });
  });

  describe('fallthrough paths', () => {
    it('returns true when no req.user AND no Authorization header (WS with no ticket-derived user)', async () => {
      const { guard, jwt } = createGuard();
      stubGqlContext({ req: { headers: {} } });

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('returns true when Bearer header is present but JwtService.verify throws (invalid token)', async () => {
      const { guard } = createGuard({
        jwtVerify: () => {
          throw new Error('invalid signature');
        },
      });
      stubGqlContext({
        req: { headers: { authorization: 'Bearer garbage' } },
      });

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('returns true when req.user is present but not impersonated (normal authenticated request)', async () => {
      const { guard } = createGuard();
      stubGqlContext({
        req: {
          user: makeImpersonatedUser({ isImpersonated: false, impersonationSessionId: undefined }),
        },
      });

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });
  });

  describe('Bearer header fallback (req.user absent)', () => {
    it('uses JWT claims and hits DB when only a Bearer header is present', async () => {
      const { guard, jwt } = createGuard({
        jwtVerify: () => ({ isImpersonated: true, impersonationSessionId: SESSION_ID }),
      });
      stubGqlContext({
        req: { headers: { authorization: 'Bearer valid.jwt.token' } },
      });
      setSessionRow({
        endedAt: null,
        endedReason: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
      expect(jwt.verify).toHaveBeenCalledWith('valid.jwt.token', { secret: 'test-secret' });
    });
  });

  describe('tombstone check', () => {
    it('throws IMPERSONATION_ENDED without touching the DB when a tombstone is set', async () => {
      const redisGet = vi.fn(async (key: string) => {
        if (key.endsWith(':tombstone')) return '1';
        return null;
      });
      const { guard, redis } = createGuard({ redisGet });
      stubGqlContext({ req: { user: makeImpersonatedUser() } });
      // No session row set — if the DB is hit, the guard would throw
      // "session not found" instead of our expected tombstone rejection.

      await expectImpersonationEnded(() => guard.canActivate(makeExecutionContext()));

      // First Redis read must be the tombstone key, and the session cache
      // key must NOT be read when the tombstone short-circuits. ioredis types
      // its keys as `RedisKey` (string | Buffer) — we only ever pass strings
      // from this guard, but TS doesn't know that, so narrow for `.endsWith`.
      const keys = vi
        .mocked(redis.get)
        .mock.calls.map((c) => c[0])
        .map((k) => (typeof k === 'string' ? k : k.toString()));
      expect(keys[0]).toMatch(/:tombstone$/);
      expect(keys).toEqual(keys.filter((k) => k.endsWith(':tombstone')));
    });
  });

  describe('view-only sessions (ROV-183)', () => {
    const live = { endedAt: null, endedReason: null, expiresAt: new Date(Date.now() + 60_000) };

    function stubOperation(
      user: AuthUser,
      operation: 'query' | 'mutation' | 'subscription',
      fieldName: string,
      nested = false,
    ): void {
      mockedGqlCreate.mockReturnValue(
        createMock<GqlExecutionContext>({
          getContext: () => ({ req: { user } }),
          getInfo: () => ({
            operation: { operation },
            fieldName,
            path: { key: fieldName, prev: nested ? { key: 'parent' } : undefined },
          }),
        }),
      );
    }

    const viewOnly = () => makeImpersonatedUser({ impersonationReadOnly: true });

    it('refuses a mutation', async () => {
      const { guard } = createGuard();
      setSessionRow(live);
      stubOperation(viewOnly(), 'mutation', 'markAttendance');

      await expectBusinessError(
        () => guard.canActivate(makeExecutionContext()),
        ErrorCode.IMPERSONATION_READ_ONLY,
      );
    });

    it.each([
      ['query', 'me'],
      ['subscription', 'studentUpdated'],
    ] as const)('lets a %s through', async (operation, fieldName) => {
      const { guard } = createGuard();
      setSessionRow(live);
      stubOperation(viewOnly(), operation, fieldName);

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('lets a file be opened, which is a mutation only to be audited', async () => {
      const { guard } = createGuard();
      setSessionRow(live);
      stubOperation(viewOnly(), 'mutation', 'fileDownloadUrl');

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('lets the session end itself', async () => {
      const { guard } = createGuard();
      setSessionRow(live);
      stubOperation(viewOnly(), 'mutation', 'endImpersonation');

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('does not mistake a field resolved under a mutation result for a second mutation', async () => {
      const { guard } = createGuard();
      setSessionRow(live);
      stubOperation(viewOnly(), 'mutation', 'endImpersonation', true);

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('leaves a normal impersonation session free to write', async () => {
      const { guard } = createGuard();
      setSessionRow(live);
      stubOperation(makeImpersonatedUser(), 'mutation', 'markAttendance');

      await expect(guard.canActivate(makeExecutionContext())).resolves.toBe(true);
    });

    it('reports an ended session as ended, not as view-only', async () => {
      const { guard } = createGuard();
      setSessionRow({ ...live, endedAt: new Date() });
      stubOperation(viewOnly(), 'mutation', 'markAttendance');

      await expectImpersonationEnded(() => guard.canActivate(makeExecutionContext()));
    });

    it.each([
      ['POST', false],
      ['DELETE', false],
      ['GET', true],
    ])('on a plain HTTP route, %s is allowed: %s', async (method, allowed) => {
      const { guard } = createGuard();
      setSessionRow(live);
      const user = viewOnly();
      mockedGqlCreate.mockReturnValue(
        createMock<GqlExecutionContext>({ getContext: () => ({ req: { user } }) }),
      );
      const context = createMock<ExecutionContext>({
        getType: vi.fn().mockReturnValue('http'),
        switchToHttp: vi.fn().mockReturnValue({ getRequest: () => ({ user, method }) }),
      });

      if (allowed) {
        await expect(guard.canActivate(context)).resolves.toBe(true);
      } else {
        await expectBusinessError(
          () => guard.canActivate(context),
          ErrorCode.IMPERSONATION_READ_ONLY,
        );
      }
    });
  });
});
