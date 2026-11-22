/**
 * ImpersonationService unit tests.
 *
 * Covers:
 *   - startImpersonation guards (reason length, scope, self, target lookup,
 *     membership check, institute lookup)
 *   - OTP gating (reseller always; platform when require_impersonation_consent;
 *     institute scope never)
 *   - verifyOtp (Redis miss, mismatch with attempt counter & TTL preservation,
 *     max-attempts invalidation, happy path → exchange code, session lookup
 *     edge cases)
 *   - exchangeCode regression (code miss, missing dependencies, happy path)
 *   - endImpersonation regression (state-machine, authorization)
 *
 * `@roviq/database` is mocked at the module boundary so `withAdmin` invokes the
 * service callback against a per-test fluent transaction stub. We don't assert
 * SQL shape — only Redis writes, exception types, NATS emits, and return values.
 *
 * `node:crypto` is mocked so `randomInt`/`randomUUID` are deterministic.
 */

import { randomInt, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AbilityFactory } from '@roviq/casl';
import type {
  AppAbility,
  InstituteContext,
  PlatformContext,
  ResellerContext,
} from '@roviq/common-types';
import { ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { createMock } from '@roviq/testing';
import { getTableName } from 'drizzle-orm';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthEventService } from '../auth-event.service';
import { ImpersonationSessionStatus } from '../dto/impersonation-session.model';
import { ImpersonationService } from '../impersonation.service';
import { REDIS_KEYS } from '../redis-keys';

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
        const tx = (globalThis as { __rovImpTx?: unknown }).__rovImpTx;
        return cb(tx);
      },
    ),
  };
});

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: vi.fn(() => 123456),
    randomUUID: vi.fn(() => 'fixed-uuid-0000-0000-0000-000000000000'),
  };
});

// ── Tx stub ────────────────────────────────────────────────────

interface SelectStep {
  table: string;
  rows: unknown[];
}

interface TxStubOpts {
  /** Ordered queue of select results, matched against `from(tableName)` calls. */
  selects?: SelectStep[];
  /** Row(s) returned from `insert().values().returning()` for impersonationSessions. */
  insertReturning?: unknown[];
  /** Rows returned from `update().set().where().returning()`. */
  updateReturning?: unknown[];
}

interface TxStub {
  tx: unknown;
  consumed: SelectStep[];
  inserted: { values: unknown }[];
  updated: { values: unknown }[];
}

function tableNameOf(table: unknown): string {
  if (table && typeof table === 'object') {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return '';
    }
  }
  return '';
}

function createTx(opts: TxStubOpts = {}): TxStub {
  const selects = [...(opts.selects ?? [])];
  const consumed: SelectStep[] = [];
  const inserted: { values: unknown }[] = [];
  const updated: { values: unknown }[] = [];

  const resolveSelect = (table: unknown): unknown[] => {
    const requested = tableNameOf(table);
    // Match the next queued step whose table name matches; if no match, take
    // the next step regardless (test setup mistakes will surface as wrong
    // shape downstream).
    const idx = selects.findIndex((s) => s.table === requested);
    const step = idx >= 0 ? selects.splice(idx, 1)[0] : selects.shift();
    if (step) consumed.push(step);
    return step?.rows ?? [];
  };

  // The chain must be awaitable both after `.limit(1)` and after `.where(...)`
  // (the role-hierarchy lookup omits `.limit`). We model this by wrapping the
  // returned object in a Proxy so accessing `then` lazily resolves the select —
  // avoiding the `lint/suspicious/noThenProperty` Biome rule that fires on a
  // declared `then` field.
  const makeSelectChain = () => {
    let table: unknown;
    const wrap = <T extends object>(target: T): T =>
      new Proxy(target, {
        get(obj, prop, receiver) {
          if (prop === 'then') {
            const promise = Promise.resolve(resolveSelect(table));
            return promise.then.bind(promise);
          }
          return Reflect.get(obj, prop, receiver);
        },
      });

    const chain: Record<string, unknown> = {};
    chain.from = (t: unknown) => {
      table = t;
      return wrap(chain);
    };
    chain.innerJoin = () => wrap(chain);
    chain.leftJoin = () => wrap(chain);
    chain.where = () => wrap(chain);
    chain.orderBy = () => wrap(chain);
    chain.limit = () => Promise.resolve(resolveSelect(table));
    return wrap(chain);
  };

  const tx = {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        inserted.push({ values });
        return {
          returning: () => Promise.resolve(opts.insertReturning ?? [{ id: 'session-1' }]),
        };
      },
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updated.push({ values });
        return {
          where: () =>
            Object.assign(Promise.resolve(), {
              returning: () => Promise.resolve(opts.updateReturning ?? []),
            }),
        };
      },
    })),
  };

  return { tx, consumed, inserted, updated };
}

function setTx(tx: unknown): void {
  (globalThis as { __rovImpTx?: unknown }).__rovImpTx = tx;
}

// ── Common factories ───────────────────────────────────────────

const REASON_VALID = 'investigating attendance bug';
const META = { ip: '10.0.0.9', userAgent: 'vitest-agent' };
const FIXED_UUID = 'fixed-uuid-0000-0000-0000-000000000000';

const platformActor: PlatformContext = {
  _scope: 'platform',
  scope: 'platform',
  userId: 'imp-1',
  membershipId: 'imp-mem',
  roleId: 'imp-role',
  type: 'access',
};

const resellerActor: ResellerContext = {
  _scope: 'reseller',
  scope: 'reseller',
  userId: 'imp-1',
  membershipId: 'imp-mem',
  roleId: 'imp-role',
  type: 'access',
  resellerId: 'reseller-1',
};

const instituteActor: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  userId: 'imp-1',
  membershipId: 'imp-mem',
  roleId: 'imp-role',
  type: 'access',
  tenantId: 'tenant-1',
};

function impersonated(actor: InstituteContext): InstituteContext {
  return {
    ...actor,
    isImpersonated: true,
    impersonatorId: 'real-admin',
    impersonationSessionId: 'outer-session',
  };
}

const TARGET_USER: SelectStep = { table: 'users', rows: [{ id: 'tgt-1', status: 'ACTIVE' }] };
const ADMIN_RECIPIENT: SelectStep = { table: 'memberships', rows: [{ userId: 'admin-1' }] };
const ACTIVE_RESELLER_MEMBERSHIP: SelectStep = {
  table: 'reseller_memberships',
  rows: [{ id: 'imp-mem' }],
};
const ADMIN_PHONE: SelectStep = {
  table: 'phone_numbers',
  rows: [{ countryCode: '+91', number: '9999999999' }],
};

function targetMembership(roleName: string, roleAbilities: unknown[] = []): SelectStep {
  return { table: 'memberships', rows: [{ id: 'tgt-mem', roleName, roleAbilities }] };
}

function actorMembership(roleName: string, roleAbilities: unknown[]): SelectStep {
  return {
    table: 'memberships',
    rows: [{ id: 'imp-mem', roleId: 'imp-role', roleName, roleAbilities }],
  };
}

function institute(row: { resellerId: string; requireImpersonationConsent: boolean }): SelectStep {
  return { table: 'institutes', rows: [{ id: 'tenant-1', ...row }] };
}

function createSubject() {
  const config = createMock<ConfigService>({
    get: vi.fn(),
    getOrThrow: vi.fn(() => 'test-secret'),
  });
  const jwt = createMock<JwtService>({ sign: vi.fn(() => 'fake-jwt') });
  const authEventService = createMock<AuthEventService>({
    emit: vi.fn().mockResolvedValue(undefined),
  });
  const abilityFactory = createMock<AbilityFactory>({
    createForUser: vi.fn().mockResolvedValue({ can: vi.fn(() => true) }),
  });
  const redis = createMock<Redis>({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    getdel: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  });
  const eventBus = createMock<EventBusService>({ emit: vi.fn() });

  const service = new ImpersonationService(
    config,
    jwt,
    authEventService,
    abilityFactory,
    createMock(),
    redis,
    eventBus,
  );

  return { service, config, jwt, authEventService, abilityFactory, redis, eventBus };
}

const mockedRandomInt = vi.mocked(randomInt as (min: number, max: number) => number);
const mockedRandomUUID = vi.mocked(randomUUID);

beforeEach(() => {
  vi.clearAllMocks();
  setTx(undefined);
  mockedRandomInt.mockReturnValue(123456);
  mockedRandomUUID.mockReturnValue('fixed-uuid-0000-0000-0000-000000000000');
});

// ── Tests ──────────────────────────────────────────────────────

describe('ImpersonationService', () => {
  describe('startImpersonation — basic guards', () => {
    it('rejects reason shorter than 10 chars', async () => {
      const { service } = createSubject();
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', 'short'),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    });

    it('rejects a caller that is itself an impersonation session', async () => {
      const { service } = createSubject();
      const { tx } = createTx();
      setTx(tx);

      await expect(
        service.startImpersonation(impersonated(instituteActor), 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(tx.select).not.toHaveBeenCalled();
    });

    it('rejects self-impersonation', async () => {
      const { service } = createSubject();
      await expect(
        service.startImpersonation(platformActor, 'imp-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
    });

    it('rejects when target user is not found', async () => {
      const { service } = createSubject();
      const { tx } = createTx({ selects: [{ table: 'users', rows: [] }] });
      setTx(tx);
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
    });

    it('rejects when target user is not ACTIVE', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [{ table: 'users', rows: [{ id: 'tgt-1', status: 'SUSPENDED' }] }],
      });
      setTx(tx);
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
    });

    it('rejects when target has no active membership in the target tenant', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [TARGET_USER, { table: 'memberships', rows: [] }],
      });
      setTx(tx);
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
    });

    it('rejects when target institute is not found', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [TARGET_USER, targetMembership('student'), { table: 'institutes', rows: [] }],
      });
      setTx(tx);
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.INSTITUTE_NOT_FOUND });
    });
  });

  describe('startImpersonation — OTP gating', () => {
    it('reseller scope owning the institute always requires OTP and parks the request in Redis', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx, inserted } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
          ACTIVE_RESELLER_MEMBERSHIP,
          ADMIN_RECIPIENT,
          ADMIN_PHONE,
        ],
      });
      setTx(tx);

      const result = await service.startImpersonation(
        resellerActor,
        'tgt-1',
        'tenant-1',
        `  ${REASON_VALID}  `,
        { ip: '10.0.0.1', userAgent: 'vitest' },
      );

      expect(result).toEqual({ sessionId: FIXED_UUID, requiresOtp: true });
      // No session row until the OTP is verified.
      expect(inserted).toEqual([]);
      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, mode, ttl] = vi.mocked(redis.set).mock.calls[0];
      expect(key).toBe(`${REDIS_KEYS.IMPERSONATION_OTP}${FIXED_UUID}`);
      expect(JSON.parse(String(value))).toEqual({
        otp: '123456',
        impersonatorId: 'imp-1',
        impersonatorScope: 'reseller',
        targetUserId: 'tgt-1',
        targetMembershipId: 'tgt-mem',
        tenantId: 'tenant-1',
        reason: REASON_VALID,
        ip: '10.0.0.1',
        userAgent: 'vitest',
        verifierUserId: 'admin-1',
      });
      expect(mode).toBe('EX');
      expect(ttl).toBe(300);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(NOTIFICATION_SUBJECTS.AUTH_SECURITY, {
        tenantId: 'tenant-1',
        userId: 'admin-1',
        eventType: 'IMPERSONATION_OTP',
        metadata: {
          otp: '123456',
          recipientPhone: '+919999999999',
          purpose: 'impersonation_consent',
          impersonator_id: 'imp-1',
          target_user_id: 'tgt-1',
          session_id: FIXED_UUID,
        },
        scope: 'institute',
        resellerId: null,
      });
    });

    it('reseller scope rejects when the institute belongs to a different reseller than the token', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx, inserted } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-B', requireImpersonationConsent: false }),
        ],
      });
      setTx(tx);

      await expect(
        service.startImpersonation(resellerActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });

    it('reseller scope rejects a caller whose reseller membership is no longer active', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx, inserted } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
          { table: 'reseller_memberships', rows: [] },
        ],
      });
      setTx(tx);

      await expect(
        service.startImpersonation(resellerActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });

    it('platform scope with consent flag returns the request id and dispatches OTP without a session row', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx, inserted } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
          ADMIN_RECIPIENT,
          ADMIN_PHONE,
        ],
      });
      setTx(tx);

      const result = await service.startImpersonation(
        platformActor,
        'tgt-1',
        'tenant-1',
        REASON_VALID,
      );

      expect(result).toEqual({ sessionId: FIXED_UUID, requiresOtp: true });
      expect(inserted).toEqual([]);
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(vi.mocked(redis.set).mock.calls[0][0]).toBe(
        `${REDIS_KEYS.IMPERSONATION_OTP}${FIXED_UUID}`,
      );
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });

    it('platform scope without consent flag skips OTP, writes the session and returns an exchange code', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx, inserted } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('institute_admin', [{ action: 'manage', subject: 'all' }]),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
        ],
        insertReturning: [{ id: 'session-11' }],
      });
      setTx(tx);

      const result = await service.startImpersonation(
        platformActor,
        'tgt-1',
        'tenant-1',
        REASON_VALID,
        { ip: '10.0.0.1', userAgent: 'vitest' },
      );

      expect(result).toEqual({ code: FIXED_UUID });
      expect(inserted).toHaveLength(1);
      const row = inserted[0].values as { startedAt: Date; expiresAt: Date };
      expect(inserted[0].values).toEqual({
        impersonatorId: 'imp-1',
        impersonatorScope: 'platform',
        targetUserId: 'tgt-1',
        targetTenantId: 'tenant-1',
        reason: REASON_VALID,
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        otpVerified: null,
        otpVerifiedBy: null,
      });
      expect(row.expiresAt.getTime() - row.startedAt.getTime()).toBe(60 * 60 * 1000);
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        `${REDIS_KEYS.IMPERSONATION_CODE}${FIXED_UUID}`,
        JSON.stringify({
          sessionId: 'session-11',
          targetUserId: 'tgt-1',
          targetMembershipId: 'tgt-mem',
          tenantId: 'tenant-1',
        }),
        'EX',
        30,
      );
      // No OTP notification; only the signal that a session opened.
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('IMPERSONATION.session_started', {
        id: 'session-11',
        tenantId: 'tenant-1',
        impersonatorScope: 'platform',
      });
    });

    it('institute scope (intra-institute) never requires OTP regardless of consent flag', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
          actorMembership('institute_admin', [{ action: 'manage', subject: 'all' }]),
        ],
        insertReturning: [{ id: 'session-13' }],
      });
      setTx(tx);

      const result = await service.startImpersonation(
        instituteActor,
        'tgt-1',
        'tenant-1',
        REASON_VALID,
      );

      expect(result).toEqual({ code: FIXED_UUID });
      const otpSets = vi
        .mocked(redis.set)
        .mock.calls.filter(([key]) => (key as string).startsWith(REDIS_KEYS.IMPERSONATION_OTP));
      expect(otpSets).toHaveLength(0);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('IMPERSONATION.session_started', {
        id: 'session-13',
        tenantId: 'tenant-1',
        impersonatorScope: 'institute',
      });
    });

    it('OTP path: when no institute_admin is found, rejects without writing the Redis OTP key', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
          { table: 'memberships', rows: [] },
        ],
      });
      setTx(tx);

      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_CONSENT_UNAVAILABLE });

      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('OTP path: institute_admin without a primary phone rejects without writing the Redis OTP key', async () => {
      const { service, redis, eventBus } = createSubject();
      const { tx } = createTx({
        selects: [
          TARGET_USER,
          targetMembership('student'),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
          ADMIN_RECIPIENT,
          { table: 'phone_numbers', rows: [] },
        ],
      });
      setTx(tx);

      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_CONSENT_UNAVAILABLE });

      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('startImpersonation — intra-institute authorization', () => {
    const MANAGE_ALL = [{ action: 'manage', subject: 'all' }];
    const IMPERSONATE = [{ action: 'impersonate', subject: 'User' }];

    function arrange(targetRole: string, targetAbilities: unknown[], actor: SelectStep) {
      const subject = createSubject();
      const stub = createTx({
        selects: [
          TARGET_USER,
          targetMembership(targetRole, targetAbilities),
          institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
          actor,
        ],
        insertReturning: [{ id: 'session-21' }],
      });
      setTx(stub.tx);
      return { ...subject, ...stub };
    }

    it('ranks a target by the most senior of its memberships in the institute', async () => {
      const { service, inserted } = (() => {
        const subject = createSubject();
        const stub = createTx({
          selects: [
            TARGET_USER,
            {
              table: 'memberships',
              rows: [
                { id: 'tgt-mem', roleName: 'student', roleAbilities: [] },
                { id: 'tgt-mem-2', roleName: 'institute_admin', roleAbilities: MANAGE_ALL },
              ],
            },
            institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
            actorMembership('principal', IMPERSONATE),
          ],
        });
        setTx(stub.tx);
        return { ...subject, ...stub };
      })();

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(inserted).toEqual([]);
    });

    it('rejects a token for a different institute than the target', async () => {
      const { service, inserted } = arrange(
        'student',
        [],
        actorMembership('institute_admin', MANAGE_ALL),
      );

      await expect(
        service.startImpersonation(
          { ...instituteActor, tenantId: 'tenant-other' },
          'tgt-1',
          'tenant-1',
          REASON_VALID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(inserted).toEqual([]);
    });

    it('rejects when the caller membership is no longer active', async () => {
      const { service, inserted } = arrange('student', [], { table: 'memberships', rows: [] });

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(inserted).toEqual([]);
    });

    it('rejects a caller without the impersonate ability', async () => {
      const { service, abilityFactory, inserted } = arrange(
        'student',
        [],
        actorMembership('class_teacher', []),
      );
      vi.mocked(abilityFactory.createForUser).mockResolvedValue(
        createMock<AppAbility>({ can: vi.fn(() => false) }),
      );

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(abilityFactory.createForUser).toHaveBeenCalledWith({
        userId: 'imp-1',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'imp-mem',
        roleId: 'imp-role',
      });
      expect(inserted).toEqual([]);
    });

    it.each([
      ['principal', IMPERSONATE, 'class_teacher', []],
      ['principal', IMPERSONATE, 'subject_teacher', []],
      ['principal', IMPERSONATE, 'student', []],
      ['principal', IMPERSONATE, 'parent', []],
      ['custom_role', IMPERSONATE, 'student', []],
      ['institute_admin', MANAGE_ALL, 'principal', IMPERSONATE],
      ['institute_admin', MANAGE_ALL, 'accountant', []],
      ['institute_admin', MANAGE_ALL, 'custom_role', []],
    ])('lets %s impersonate %3$s', async (actorRole, actorAbilities, targetRole, targetAbilities) => {
      const { service } = arrange(
        targetRole,
        targetAbilities,
        actorMembership(actorRole, actorAbilities),
      );

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).resolves.toEqual({ code: FIXED_UUID });
    });

    it.each([
      // Same or higher rank.
      ['principal', IMPERSONATE, 'institute_admin', MANAGE_ALL],
      ['principal', IMPERSONATE, 'principal', IMPERSONATE],
      ['institute_admin', MANAGE_ALL, 'institute_admin', MANAGE_ALL],
      // A custom role with manage:all ranks with the institute admin whatever its name.
      ['principal', IMPERSONATE, 'custom_super_role', MANAGE_ALL],
      ['institute_admin', MANAGE_ALL, 'custom_super_role', MANAGE_ALL],
      // Lower rank, but holding abilities a principal does not have.
      ['principal', IMPERSONATE, 'vice_principal', []],
      ['principal', IMPERSONATE, 'accountant', []],
      ['principal', IMPERSONATE, 'nurse', []],
      ['principal', IMPERSONATE, 'counselor', []],
      ['principal', IMPERSONATE, 'it_admin', []],
      ['principal', IMPERSONATE, 'custom_role', []],
      // A custom role ranks as staff, so it cannot reach teachers.
      ['custom_role', IMPERSONATE, 'class_teacher', []],
    ])('refuses %s impersonating %3$s', async (actorRole, actorAbilities, targetRole, targetAbilities) => {
      const { service, inserted, redis } = arrange(
        targetRole,
        targetAbilities,
        actorMembership(actorRole, actorAbilities),
      );

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(inserted).toEqual([]);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    const KEY = `${REDIS_KEYS.IMPERSONATION_OTP}request-1`;
    const ATTEMPTS_KEY = `${KEY}:attempts`;
    const pending = {
      otp: '111111',
      impersonatorId: 'imp-1',
      impersonatorScope: 'reseller',
      targetUserId: 'tgt-1',
      targetMembershipId: 'tgt-mem',
      tenantId: 'tenant-1',
      reason: REASON_VALID,
      ip: '10.0.0.1',
      userAgent: 'vitest',
      verifierUserId: 'admin-1',
    };

    it('rejects a caller that is itself an impersonation session', async () => {
      const { service, redis } = createSubject();

      await expect(
        service.verifyOtp(impersonated(instituteActor), 'request-1', '111111'),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('rejects when the pending request is missing or expired', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(service.verifyOtp(resellerActor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_EXPIRED,
      });
      expect(redis.get).toHaveBeenCalledWith(KEY);
    });

    it('rejects a caller who did not start the request, without spending an attempt', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));

      await expect(
        service.verifyOtp({ ...resellerActor, userId: 'someone-else' }, 'request-1', '111111'),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_OTP_INVALID });
      expect(redis.incr).not.toHaveBeenCalled();
      expect(redis.getdel).not.toHaveBeenCalled();
    });

    it('on mismatch below the limit counts the attempt atomically and keeps the request', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.incr).mockResolvedValue(1);
      const { tx, inserted } = createTx();
      setTx(tx);

      await expect(service.verifyOtp(resellerActor, 'request-1', '999999')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_INVALID,
      });

      expect(redis.incr).toHaveBeenCalledWith(ATTEMPTS_KEY);
      expect(redis.expire).toHaveBeenCalledWith(ATTEMPTS_KEY, 300);
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.getdel).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });

    it('rejects an OTP of a different length', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.incr).mockResolvedValue(1);

      await expect(service.verifyOtp(resellerActor, 'request-1', '1111')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_INVALID,
      });
    });

    it('on the third mismatch deletes the request and its counter', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.incr).mockResolvedValue(3);
      const { tx, inserted } = createTx();
      setTx(tx);

      await expect(service.verifyOtp(resellerActor, 'request-1', '999999')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_ATTEMPTS_EXCEEDED,
      });
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
      expect(inserted).toEqual([]);
    });

    it('refuses even the correct OTP once the attempts are used up', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      // A parallel guess already took the last attempt.
      vi.mocked(redis.incr).mockResolvedValue(4);
      const { tx, inserted } = createTx();
      setTx(tx);

      await expect(service.verifyOtp(resellerActor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_ATTEMPTS_EXCEEDED,
      });
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
      expect(redis.getdel).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });

    it('rejects when a parallel request consumed the OTP first', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.getdel).mockResolvedValue(null);
      const { tx, inserted } = createTx();
      setTx(tx);

      await expect(service.verifyOtp(resellerActor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_EXPIRED,
      });
      expect(inserted).toEqual([]);
    });

    it.each([
      ['the caller uses a token of another scope', platformActor, []],
      [
        'the reseller membership was deactivated meanwhile',
        resellerActor,
        [{ table: 'reseller_memberships', rows: [] }],
      ],
      [
        'the institute moved to another reseller meanwhile',
        resellerActor,
        [ACTIVE_RESELLER_MEMBERSHIP, { table: 'institutes', rows: [{ resellerId: 'reseller-B' }] }],
      ],
    ])('opens no session with the right OTP when %s', async (_label, actor, selects) => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.getdel).mockResolvedValue(JSON.stringify(pending));
      const { tx, inserted } = createTx({ selects });
      setTx(tx);

      await expect(service.verifyOtp(actor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(inserted).toEqual([]);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('on match consumes the request, writes the verified session and returns an exchange code', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.getdel).mockResolvedValue(JSON.stringify(pending));
      const { tx, inserted } = createTx({
        selects: [
          ACTIVE_RESELLER_MEMBERSHIP,
          { table: 'institutes', rows: [{ resellerId: 'reseller-1' }] },
        ],
        insertReturning: [{ id: 'session-31' }],
      });
      setTx(tx);

      const result = await service.verifyOtp(resellerActor, 'request-1', '111111');

      expect(result).toEqual({ code: FIXED_UUID });
      expect(redis.getdel).toHaveBeenCalledWith(KEY);
      expect(redis.del).toHaveBeenCalledWith(ATTEMPTS_KEY);
      // The attempt is reserved before the comparison.
      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.incr).toHaveBeenCalledWith(ATTEMPTS_KEY);
      expect(inserted).toHaveLength(1);
      const row = inserted[0].values as { startedAt: Date; expiresAt: Date; otpVerified: Date };
      expect(inserted[0].values).toEqual({
        impersonatorId: 'imp-1',
        impersonatorScope: 'reseller',
        targetUserId: 'tgt-1',
        targetTenantId: 'tenant-1',
        reason: REASON_VALID,
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        otpVerified: row.startedAt,
        otpVerifiedBy: 'admin-1',
      });
      expect(row.otpVerified).toBeInstanceOf(Date);
      expect(redis.set).toHaveBeenCalledWith(
        `${REDIS_KEYS.IMPERSONATION_CODE}${FIXED_UUID}`,
        JSON.stringify({
          sessionId: 'session-31',
          targetUserId: 'tgt-1',
          targetMembershipId: 'tgt-mem',
          tenantId: 'tenant-1',
        }),
        'EX',
        30,
      );
    });
  });

  describe('exchangeCode', () => {
    const CODE_PAYLOAD = JSON.stringify({
      sessionId: 'session-1',
      targetUserId: 'tgt-1',
      targetMembershipId: 'mem-1',
      tenantId: 'tenant-1',
    });
    const EXCHANGE_USER = {
      table: 'users',
      rows: [
        {
          id: 'tgt-1',
          username: 'student-jane',
          firstName: { en: 'Jane' },
          lastName: { en: 'Doe' },
        },
      ],
    };
    const EXCHANGE_MEMBERSHIP = {
      table: 'memberships',
      rows: [{ id: 'mem-1', tenantId: 'tenant-1', roleId: 'role-student' }],
    };
    const EXCHANGE_INSTITUTE = {
      table: 'institutes',
      rows: [{ id: 'tenant-1', name: { en: 'Test Institute' }, resellerId: 'reseller-1' }],
    };
    const liveSession = (overrides: Record<string, unknown> = {}) => ({
      table: 'impersonation_sessions',
      rows: [
        {
          id: 'session-1',
          impersonatorId: 'imp-1',
          impersonatorScope: 'reseller',
          endedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          ...overrides,
        },
      ],
    });

    it('rejects when the code is not in Redis', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(null);
      await expect(service.exchangeCode('missing-code', META)).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_CODE_EXPIRED,
      });
      expect(redis.getdel).toHaveBeenCalledWith(`${REDIS_KEYS.IMPERSONATION_CODE}missing-code`);
    });

    it('rejects when the target user is no longer ACTIVE', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      const { tx } = createTx({
        selects: [
          { table: 'users', rows: [] },
          { table: 'memberships', rows: [] },
          { table: 'impersonation_sessions', rows: [] },
          { table: 'institutes', rows: [] },
        ],
      });
      setTx(tx);

      await expect(service.exchangeCode('code-1', META)).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_INACTIVE,
      });
    });

    it('rejects when the target lost their active membership', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      const { tx } = createTx({
        selects: [
          EXCHANGE_USER,
          { table: 'memberships', rows: [] },
          liveSession(),
          EXCHANGE_INSTITUTE,
        ],
      });
      setTx(tx);

      await expect(service.exchangeCode('code-1', META)).rejects.toMatchObject({
        code: ErrorCode.NO_ACTIVE_MEMBERSHIP,
      });
    });

    it.each([
      ['ended or revoked', { endedAt: new Date() }],
      ['past its expiry', { expiresAt: new Date(Date.now() - 1000) }],
    ])('issues no token when the session is %s', async (_label, overrides) => {
      const { service, redis, jwt, authEventService } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      const { tx } = createTx({
        selects: [EXCHANGE_USER, EXCHANGE_MEMBERSHIP, liveSession(overrides), EXCHANGE_INSTITUTE],
      });
      setTx(tx);

      await expect(service.exchangeCode('code-1', META)).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_SESSION_INVALID,
      });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(authEventService.emit).not.toHaveBeenCalled();
    });

    const impersonatorRole = (roleName: string) => ({
      table: 'reseller_memberships',
      rows: [{ roleName }],
    });

    it.each([
      ['a reseller support admin', [impersonatorRole('reseller_support_admin')]],
      ['a reseller viewer', [impersonatorRole('reseller_viewer')]],
      ['a reseller user whose membership is gone', [{ table: 'reseller_memberships', rows: [] }]],
    ])('issues a view-only token to %s', async (_who, roleSelect) => {
      const { service, redis, jwt } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      const { tx } = createTx({
        selects: [
          EXCHANGE_USER,
          EXCHANGE_MEMBERSHIP,
          liveSession(),
          EXCHANGE_INSTITUTE,
          ...roleSelect,
        ],
      });
      setTx(tx);

      await service.exchangeCode('code-1', META);

      expect(vi.mocked(jwt.sign).mock.calls[0][0]).toMatchObject({ impersonationReadOnly: true });
    });

    const platformRole = (abilities: { action: string; subject: string }[]) => ({
      table: 'platform_memberships',
      rows: [{ abilities }],
    });

    async function exchangeAsPlatform(roleSelect: { table: string; rows: unknown[] }) {
      const { service, redis, jwt } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      const { tx } = createTx({
        selects: [
          EXCHANGE_USER,
          EXCHANGE_MEMBERSHIP,
          liveSession({ impersonatorScope: 'platform' }),
          EXCHANGE_INSTITUTE,
          roleSelect,
        ],
      });
      setTx(tx);
      await service.exchangeCode('code-1', META);
      return vi.mocked(jwt.sign).mock.calls[0][0];
    }

    it('issues a view-only token to platform support, whose role only reads', async () => {
      const claims = await exchangeAsPlatform(
        platformRole([
          { action: 'read', subject: 'all' },
          { action: 'impersonate', subject: 'User' },
        ]),
      );
      expect(claims).toMatchObject({ impersonationReadOnly: true });
    });

    it('issues a view-only token when the platform membership is gone', async () => {
      const claims = await exchangeAsPlatform({ table: 'platform_memberships', rows: [] });
      expect(claims).toMatchObject({ impersonationReadOnly: true });
    });

    it('lets a platform admin (manage all) write', async () => {
      const claims = await exchangeAsPlatform(platformRole([{ action: 'manage', subject: 'all' }]));
      expect(claims).not.toHaveProperty('impersonationReadOnly');
    });

    it('never marks an institute-started session view-only', async () => {
      const { service, redis, jwt } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      const { tx } = createTx({
        selects: [
          EXCHANGE_USER,
          EXCHANGE_MEMBERSHIP,
          liveSession({ impersonatorScope: 'institute' }),
          EXCHANGE_INSTITUTE,
        ],
      });
      setTx(tx);

      await service.exchangeCode('code-1', META);

      expect(vi.mocked(jwt.sign).mock.calls[0][0]).not.toHaveProperty('impersonationReadOnly');
    });

    it('happy path returns a 15-minute token carrying the impersonation and reseller claims', async () => {
      const { service, redis, jwt, authEventService } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');

      const { tx } = createTx({
        selects: [
          EXCHANGE_USER,
          EXCHANGE_MEMBERSHIP,
          liveSession(),
          EXCHANGE_INSTITUTE,
          impersonatorRole('reseller_full_admin'),
        ],
      });
      setTx(tx);

      const result = await service.exchangeCode('code-1', META);
      expect(result).toEqual({
        accessToken: 'fake-jwt',
        user: {
          id: 'tgt-1',
          username: 'student-jane',
          firstName: { en: 'Jane' },
          lastName: { en: 'Doe' },
        },
        institute: { id: 'tenant-1', name: { en: 'Test Institute' } },
      });
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          sub: 'tgt-1',
          scope: 'institute',
          tenantId: 'tenant-1',
          resellerId: 'reseller-1',
          membershipId: 'mem-1',
          roleId: 'role-student',
          isImpersonated: true,
          impersonatorId: 'imp-1',
          impersonationSessionId: 'session-1',
          type: 'access',
        },
        { secret: 'test-secret', expiresIn: 900 },
      );
      // Allow the fire-and-forget audit emit a chance to run before assertion.
      await Promise.resolve();
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'imp-1',
        type: 'impersonation_start',
        scope: 'reseller',
        tenantId: 'tenant-1',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
        metadata: {
          target_user_id: 'tgt-1',
          target_tenant_id: 'tenant-1',
          session_id: 'session-1',
        },
      });
    });
  });

  describe('endImpersonation', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      table: 'impersonation_sessions',
      rows: [
        {
          id: 'session-1',
          impersonatorId: 'imp-1',
          impersonatorScope: 'reseller',
          targetUserId: 'tgt-1',
          targetTenantId: 'tenant-1',
          endedAt: null,
          ...overrides,
        },
      ],
    });
    const outsider = { userId: 'someone-else', membershipId: 'other-mem', roleId: 'other-role' };

    function withAbility(abilityFactory: AbilityFactory, allowed: boolean) {
      vi.mocked(abilityFactory.createForUser).mockResolvedValue(
        createMock<AppAbility>({ can: vi.fn(() => allowed) }),
      );
    }

    it('rejects when the session is not found', async () => {
      const { service } = createSubject();
      const { tx } = createTx({ selects: [{ table: 'impersonation_sessions', rows: [] }] });
      setTx(tx);
      await expect(
        service.endImpersonation('session-1', platformActor, META),
      ).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_SESSION_INVALID,
      });
    });

    it('rejects when the session is already ended', async () => {
      const { service } = createSubject();
      const { tx, updated } = createTx({ selects: [session({ endedAt: new Date() })] });
      setTx(tx);
      await expect(
        service.endImpersonation('session-1', platformActor, META),
      ).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_SESSION_INVALID,
      });
      expect(updated).toEqual([]);
    });

    it('impersonator ends its own session as manual, clears the cache and emits impersonation_end', async () => {
      const { service, redis, authEventService, abilityFactory } = createSubject();
      const { tx, updated } = createTx({ selects: [session()] });
      setTx(tx);

      await service.endImpersonation('session-1', resellerActor, META);

      expect(updated).toHaveLength(1);
      const setValues = updated[0].values as { endedAt: Date; endedReason: string };
      expect(setValues.endedReason).toBe('manual');
      expect(setValues.endedAt).toBeInstanceOf(Date);
      expect(abilityFactory.createForUser).not.toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith(`${REDIS_KEYS.IMPERSONATION_SESSION}session-1`);
      expect(redis.set).toHaveBeenCalledWith(
        `${REDIS_KEYS.IMPERSONATION_SESSION}session-1:tombstone`,
        '1',
        'EX',
        70,
      );
      // Allow the fire-and-forget audit emit a chance to run before assertion.
      await Promise.resolve();
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'imp-1',
        type: 'impersonation_end',
        scope: 'reseller',
        tenantId: 'tenant-1',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
        metadata: { session_id: 'session-1', ended_reason: 'manual' },
      });
    });

    it('the impersonated user ends the session from the impersonation token as manual', async () => {
      const { service } = createSubject();
      const { tx, updated } = createTx({ selects: [session()] });
      setTx(tx);

      await service.endImpersonation(
        'session-1',
        impersonated({ ...instituteActor, userId: 'tgt-1' }),
        META,
      );

      expect((updated[0].values as { endedReason: string }).endedReason).toBe('manual');
    });

    it('an impersonation token cannot end a session it is not part of', async () => {
      const { service, abilityFactory } = createSubject();
      const { tx, updated } = createTx({ selects: [session()] });
      setTx(tx);

      await expect(
        service.endImpersonation(
          'session-1',
          impersonated({ ...instituteActor, ...outsider }),
          META,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(abilityFactory.createForUser).not.toHaveBeenCalled();
      expect(updated).toEqual([]);
    });

    it('a platform user with the impersonate ability revokes any session', async () => {
      const { service, abilityFactory, authEventService } = createSubject();
      withAbility(abilityFactory, true);
      const { tx, updated } = createTx({ selects: [session()] });
      setTx(tx);

      await service.endImpersonation('session-1', { ...platformActor, ...outsider }, META);

      expect((updated[0].values as { endedReason: string }).endedReason).toBe('revoked');
      await Promise.resolve();
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'someone-else',
        type: 'impersonation_end',
        scope: 'platform',
        tenantId: 'tenant-1',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
        metadata: { session_id: 'session-1', ended_reason: 'revoked' },
      });
    });

    it('a third party without the impersonate ability is refused', async () => {
      const { service, abilityFactory } = createSubject();
      withAbility(abilityFactory, false);
      const { tx, updated } = createTx({ selects: [session()] });
      setTx(tx);

      await expect(
        service.endImpersonation('session-1', { ...platformActor, ...outsider }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(updated).toEqual([]);
    });

    it('a reseller user revokes a session started by a teammate', async () => {
      const { service, abilityFactory } = createSubject();
      withAbility(abilityFactory, true);
      const { tx, updated } = createTx({
        selects: [session(), { table: 'reseller_memberships', rows: [{ id: 'team-mem' }] }],
      });
      setTx(tx);

      await service.endImpersonation('session-1', { ...resellerActor, ...outsider }, META);

      expect((updated[0].values as { endedReason: string }).endedReason).toBe('revoked');
    });

    it('a reseller user cannot revoke a session started outside their team', async () => {
      const { service, abilityFactory } = createSubject();
      withAbility(abilityFactory, true);
      const { tx, updated } = createTx({
        selects: [session(), { table: 'reseller_memberships', rows: [] }],
      });
      setTx(tx);

      await expect(
        service.endImpersonation('session-1', { ...resellerActor, ...outsider }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(updated).toEqual([]);
    });

    it('a reseller user cannot revoke a platform-started session', async () => {
      const { service, abilityFactory } = createSubject();
      withAbility(abilityFactory, true);
      const { tx, updated } = createTx({ selects: [session({ impersonatorScope: 'platform' })] });
      setTx(tx);

      await expect(
        service.endImpersonation('session-1', { ...resellerActor, ...outsider }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(updated).toEqual([]);
    });

    it('an institute admin revokes a session into their own institute', async () => {
      const { service, abilityFactory } = createSubject();
      withAbility(abilityFactory, true);
      const { tx, updated } = createTx({ selects: [session()] });
      setTx(tx);

      await service.endImpersonation('session-1', { ...instituteActor, ...outsider }, META);

      expect((updated[0].values as { endedReason: string }).endedReason).toBe('revoked');
    });

    it('an institute admin cannot revoke a session into another institute', async () => {
      const { service, abilityFactory } = createSubject();
      withAbility(abilityFactory, true);
      const { tx, updated } = createTx({ selects: [session({ targetTenantId: 'tenant-other' })] });
      setTx(tx);

      await expect(
        service.endImpersonation('session-1', { ...instituteActor, ...outsider }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(updated).toEqual([]);
    });
  });

  describe('expireOverdueSessions', () => {
    it('closes overdue sessions as expired and records impersonation_end for each', async () => {
      const { service, authEventService } = createSubject();
      const { tx, updated } = createTx({
        updateReturning: [
          {
            id: 'session-1',
            impersonatorId: 'imp-1',
            impersonatorScope: 'reseller',
            targetTenantId: 'tenant-1',
          },
          {
            id: 'session-2',
            impersonatorId: 'imp-2',
            impersonatorScope: 'platform',
            targetTenantId: null,
          },
        ],
      });
      setTx(tx);

      const count = await service.expireOverdueSessions();

      expect(count).toBe(2);
      expect((updated[0].values as { endedReason: string }).endedReason).toBe('expired');
      expect(authEventService.emit).toHaveBeenCalledTimes(2);
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'imp-1',
        type: 'impersonation_end',
        scope: 'reseller',
        tenantId: 'tenant-1',
        metadata: { session_id: 'session-1', ended_reason: 'expired' },
      });
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'imp-2',
        type: 'impersonation_end',
        scope: 'platform',
        tenantId: undefined,
        metadata: { session_id: 'session-2', ended_reason: 'expired' },
      });
    });

    it('records nothing when no session is overdue', async () => {
      const { service, authEventService } = createSubject();
      const { tx } = createTx();
      setTx(tx);

      expect(await service.expireOverdueSessions()).toBe(0);
      expect(authEventService.emit).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    const baseRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'session-1',
      impersonatorId: 'imp-1',
      impersonatorScope: 'platform',
      impersonatorName: 'Admin User',
      targetUserId: 'tgt-1',
      targetUserName: 'Teacher One',
      targetTenantId: 'tenant-1',
      targetTenantName: { en: 'Greenfield Institute' },
      reason: REASON_VALID,
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
      startedAt: new Date('2026-01-01T10:00:00Z'),
      expiresAt: new Date('2999-01-01T10:00:00Z'),
      endedAt: null,
      endedReason: null,
      otpVerified: null,
      otpVerifiedByName: null,
      ...overrides,
    });

    it('derives ACTIVE / ENDED / EXPIRED status from endedAt and expiresAt', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [
          {
            table: 'impersonation_sessions',
            rows: [
              baseRow({ id: 'active', expiresAt: new Date('2999-01-01T00:00:00Z'), endedAt: null }),
              baseRow({ id: 'ended', endedAt: new Date('2026-01-01T11:00:00Z') }),
              baseRow({
                id: 'expired',
                expiresAt: new Date('2020-01-01T00:00:00Z'),
                endedAt: null,
              }),
              baseRow({
                id: 'swept',
                expiresAt: new Date('2020-01-01T00:00:00Z'),
                endedAt: new Date('2020-01-01T00:00:00Z'),
                endedReason: 'expired',
              }),
            ],
          },
        ],
      });
      setTx(tx);

      const result = await service.listSessions({ limit: 50 });

      expect(result.map((s) => [s.id, s.status])).toEqual([
        ['active', ImpersonationSessionStatus.ACTIVE],
        ['ended', ImpersonationSessionStatus.ENDED],
        ['expired', ImpersonationSessionStatus.EXPIRED],
        ['swept', ImpersonationSessionStatus.EXPIRED],
      ]);
    });

    it('passes through resolved display fields and normalises a null institute name', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [{ table: 'impersonation_sessions', rows: [baseRow({ targetTenantName: null })] }],
      });
      setTx(tx);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorName).toBe('Admin User');
      expect(session.targetUserName).toBe('Teacher One');
      expect(session.reason).toBe(REASON_VALID);
      expect(session.targetTenantName).toBeNull();
    });

    it('reseller scope with no team members returns [] without querying sessions', async () => {
      const { service } = createSubject();
      const { tx, consumed } = createTx({
        selects: [{ table: 'reseller_memberships', rows: [] }],
      });
      setTx(tx);

      const result = await service.listSessions({ resellerId: 'reseller-1', limit: 50 });

      expect(result).toEqual([]);
      expect(consumed.map((s) => s.table)).toEqual(['reseller_memberships']);
    });

    it('reseller scope returns sessions started by the reseller team', async () => {
      const { service } = createSubject();
      const { tx, consumed } = createTx({
        selects: [
          { table: 'reseller_memberships', rows: [{ userId: 'imp-1' }] },
          { table: 'impersonation_sessions', rows: [baseRow({ impersonatorScope: 'reseller' })] },
        ],
      });
      setTx(tx);

      const result = await service.listSessions({ resellerId: 'reseller-1', limit: 50 });

      expect(result).toHaveLength(1);
      expect(result[0].impersonatorScope).toBe('reseller');
      expect(consumed.map((s) => s.table)).toEqual([
        'reseller_memberships',
        'impersonation_sessions',
      ]);
    });

    it('resolves a platform impersonator role from platform_memberships', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [
          { table: 'impersonation_sessions', rows: [baseRow({ impersonatorScope: 'platform' })] },
          {
            table: 'platform_memberships',
            rows: [{ userId: 'imp-1', roleName: { en: 'Platform Admin' } }],
          },
        ],
      });
      setTx(tx);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorRole).toEqual({ en: 'Platform Admin' });
    });

    it('resolves an institute impersonator role keyed by (user, target tenant)', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [
          {
            table: 'impersonation_sessions',
            rows: [baseRow({ impersonatorScope: 'institute', targetTenantId: 'tenant-1' })],
          },
          {
            table: 'memberships_live',
            rows: [{ userId: 'imp-1', tenantId: 'tenant-1', roleName: { en: 'Principal' } }],
          },
        ],
      });
      setTx(tx);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorRole).toEqual({ en: 'Principal' });
    });

    it('returns a null impersonator role when no matching membership exists', async () => {
      const { service } = createSubject();
      const { tx } = createTx({
        selects: [
          { table: 'impersonation_sessions', rows: [baseRow({ impersonatorScope: 'platform' })] },
          { table: 'platform_memberships', rows: [] },
        ],
      });
      setTx(tx);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorRole).toBeNull();
    });
  });
});
