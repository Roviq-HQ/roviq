/**
 * AdminResellerService unit tests.
 *
 * Covers:
 *   - ROV-97 lifecycle: suspend / unsuspend / delete (system protection,
 *     state-machine guards, 30-day grace period, NATS event emission,
 *     canonical RESELLER.status_changed event)
 *   - ROV-234 management: create (slug duplicates, linking an existing admin
 *     user), versioned update, changeTier guards, real counts on every result
 *
 * The Drizzle transaction chain is mocked via a fluent test double whose
 * terminal calls resolve to the rows staged for each test. `.returning()`
 * on updates/inserts echoes back the staged reseller row merged with
 * incoming `.set()` values — good enough to cover the paths the service
 * walks without spinning up a real Postgres.
 */
import {
  BusinessException,
  ErrorCode,
  IndianState,
  ResellerStatus,
  ResellerTier,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { getTableName, SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthEventService } from '../../../auth/auth-event.service';
import { IdentityService } from '../../../auth/identity.service';
import { AdminResellerService } from '../admin-reseller.service';

// ── Drizzle transaction mock ──────────────────────────────────

interface StagedRow {
  id: string;
  name?: string;
  slug?: string;
  tier?: string;
  isSystem?: boolean;
  isActive?: boolean;
  status?: string;
  suspendedAt?: Date | null;
  deletedAt?: Date | null;
  branding?: Record<string, unknown> | null;
  customDomain?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface TxStages {
  resellerRows?: StagedRow[];
  staffRows?: { id: string; userId: string }[];
  sessionRows?: { id: string }[];
  instituteRows?: { id: string }[];
  /** Rows to return in sequence from additional selects (slug conflict, role lookup) */
  extraSelectRows?: unknown[][];
  /** Row returned by insert().returning() — used by create() */
  insertedReseller?: StagedRow;
  /** Rows the grouped count queries return, keyed by base table name */
  countRows?: { institutes?: number; reseller_memberships?: number };
  /** False simulates a version mismatch: the reseller UPDATE matches no row */
  updateMatches?: boolean;
}

function createTxMock(stages: TxStages) {
  const calls = {
    updateReseller: vi.fn(),
    updateRefreshTokens: vi.fn(),
    updateInstitutes: vi.fn(),
    updateMemberships: vi.fn(),
    updateImpersonation: vi.fn(),
    insertReseller: vi.fn(),
    insertRoles: vi.fn(),
    updateRoles: vi.fn(),
  };

  // Selects are routed by the `from(table)` argument — more robust than
  // positional ordering because suspend / delete / create flows each select
  // different tables in different orders.
  const primaryReseller = stages.resellerRows?.[0];
  const extraSelects = [...(stages.extraSelectRows ?? [])];

  const resolveSelectRows = (table: unknown): unknown[] => {
    let tableName: string =
      typeof table === 'object' && table !== null ? String(getTableName(table as never)) : '';
    // After the live-views migration, services may read from `<table>_live`
    // views instead of base tables. Strip the suffix so fixtures stay keyed
    // by base name (`institutes`, `resellers`, `roles`, etc.).
    if (tableName.endsWith('_live')) tableName = tableName.slice(0, -5);
    switch (tableName) {
      case 'resellers':
        return stages.resellerRows ?? [];
      case 'reseller_memberships':
        return stages.staffRows ?? [];
      case 'impersonation_sessions':
        return stages.sessionRows ?? [];
      case 'institutes':
        return stages.instituteRows ?? [];
      case 'roles':
        // Role lookups are test-specific; shift from extraSelectRows queue.
        return extraSelects.shift() ?? [];
      default:
        return extraSelects.shift() ?? [];
    }
  };

  const tableNameOf = (table: unknown): string => {
    const name =
      typeof table === 'object' && table !== null ? String(getTableName(table as never)) : '';
    return name.endsWith('_live') ? name.slice(0, -5) : name;
  };

  const countRowsFor = (table: unknown) => {
    const name = tableNameOf(table);
    const counted =
      name === 'institutes' || name === 'reseller_memberships'
        ? stages.countRows?.[name]
        : undefined;
    const resellerId = primaryReseller?.id ?? stages.insertedReseller?.id ?? 'new-reseller-id';
    return counted === undefined ? [] : [{ resellerId, count: counted }];
  };

  const makeSelectChain = () => ({
    from: (table: unknown) => ({
      where: () =>
        Object.assign(Promise.resolve(resolveSelectRows(table)), {
          groupBy: () => Promise.resolve(countRowsFor(table)),
        }),
    }),
  });

  const makeUpdateChain = (tableName: string) => ({
    set: (values: Record<string, unknown>) => {
      const whereFn = (cond: unknown) => {
        if (tableName === 'resellers') calls.updateReseller({ values, cond });
        else if (tableName === 'refresh_tokens') calls.updateRefreshTokens({ values, cond });
        else if (tableName === 'institutes') calls.updateInstitutes({ values, cond });
        else if (tableName === 'impersonation_sessions')
          calls.updateImpersonation({ values, cond });
        else if (tableName === 'reseller_memberships') calls.updateMemberships({ values, cond });
        else if (tableName === 'roles') calls.updateRoles({ values, cond });
      };
      return {
        where: (cond: unknown) => {
          whereFn(cond);
          return Object.assign(Promise.resolve(), {
            returning: () =>
              Promise.resolve(
                primaryReseller && stages.updateMatches !== false
                  ? [{ ...primaryReseller, ...values }]
                  : [],
              ),
          });
        },
      };
    },
  });

  const tx = {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn((table: unknown) => {
      const tableName: string =
        typeof table === 'object' && table !== null ? String(getTableName(table as never)) : '';
      if (tableName === 'roles') {
        return {
          values: (values: { name: { en: string }; resellerId: string }[]) => ({
            onConflictDoUpdate: () => ({
              returning: () => {
                calls.insertRoles({ values });
                return Promise.resolve(
                  values.map((v) => ({ id: `role-${v.name.en}`, name: v.name })),
                );
              },
            }),
          }),
        };
      }
      return {
        values: (values: Record<string, unknown>) => ({
          returning: () => {
            calls.insertReseller({ values });
            return Promise.resolve([
              stages.insertedReseller ?? { ...values, id: 'new-reseller-id' },
            ]);
          },
        }),
      };
    }),
    update: vi.fn((table: unknown) => {
      const tableName: string =
        typeof table === 'object' && table !== null ? String(getTableName(table as never)) : '';
      return makeUpdateChain(tableName);
    }),
  };

  return { tx, calls };
}

vi.mock('@roviq/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roviq/database')>();
  return {
    ...actual,
    withAdmin: vi.fn(
      async (_db: unknown, ctxOrFn: unknown, fnArg?: (tx: unknown) => Promise<unknown>) => {
        const fn =
          typeof ctxOrFn === 'function'
            ? (ctxOrFn as (tx: unknown) => Promise<unknown>)
            : (fnArg as (tx: unknown) => Promise<unknown>);
        const txHolder = (globalThis as { __rovResellerTx?: unknown }).__rovResellerTx;
        return fn(txHolder);
      },
    ),
  };
});

const SYSTEM_RESELLER_ID = '00000000-0000-7000-a000-000000000011';
const NORMAL_RESELLER_ID = '11111111-1111-4111-a111-111111111111';
const ACTOR_ID = '22222222-2222-4222-a222-222222222222';

function setTx(tx: unknown) {
  (globalThis as { __rovResellerTx?: unknown }).__rovResellerTx = tx;
}

describe('AdminResellerService', () => {
  let service: AdminResellerService;
  let authEventService: AuthEventService;
  let redis: Redis;
  let eventBus: EventBusService;
  let identityService: IdentityService;

  beforeEach(() => {
    authEventService = createMock<AuthEventService>({
      emit: vi.fn().mockResolvedValue(undefined),
    });
    redis = createMock<Redis>({
      del: vi.fn().mockResolvedValue(1),
      set: vi.fn().mockResolvedValue('OK'),
    });
    eventBus = createMock<EventBusService>({
      emit: vi.fn(),
    });
    identityService = createMock<IdentityService>({
      findUsersByEmail: vi.fn().mockResolvedValue([]),
      isUsernameTaken: vi.fn().mockResolvedValue(false),
      createUser: vi.fn().mockResolvedValue({ userId: 'new-user-id', tempPassword: 'temp-pass' }),
      createMembership: vi
        .fn()
        .mockResolvedValue({ membershipId: 'new-membership-id', scope: 'reseller' }),
      sendWelcomeNotification: vi.fn(),
    });

    service = new AdminResellerService(
      createMock(),
      redis,
      authEventService,
      eventBus,
      identityService,
    );
  });

  // ── suspendReseller ─────────────────────────────────────────

  describe('suspendReseller', () => {
    it('throws RESELLER_NOT_FOUND when reseller does not exist', async () => {
      const { tx } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await expect(service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });

    it('throws SYSTEM_RESELLER_PROTECTED when reseller.isSystem=true', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [{ id: SYSTEM_RESELLER_ID, isSystem: true, status: ResellerStatus.ACTIVE }],
      });
      setTx(tx);

      await expect(service.suspendReseller(SYSTEM_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.SYSTEM_RESELLER_PROTECTED,
      });
      expect(calls.updateReseller).not.toHaveBeenCalled();
    });

    it('throws RESELLER_ALREADY_SUSPENDED when reseller is already suspended', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [
          { id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.SUSPENDED },
        ],
      });
      setTx(tx);

      await expect(service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_ALREADY_SUSPENDED,
      });
      expect(calls.updateReseller).not.toHaveBeenCalled();
    });

    it('throws RESELLER_INVALID when reseller is deleted', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.DELETED }],
      });
      setTx(tx);

      await expect(service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
    });

    it('suspends reseller, drops the session caches and emits events', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.ACTIVE }],
        staffRows: [
          { id: 'membership-1', userId: 'staff-1' },
          { id: 'membership-2', userId: 'staff-2' },
        ],
        sessionRows: [{ id: 'session-1' }],
      });
      setTx(tx);

      await service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID, 'policy violation');

      expect(calls.updateReseller).toHaveBeenCalledTimes(1);
      const resellerUpdate = calls.updateReseller.mock.calls[0][0];
      expect(resellerUpdate.values.status).toBe(ResellerStatus.SUSPENDED);
      expect(resellerUpdate.values.suspendedAt).toBeInstanceOf(Date);
      expect(resellerUpdate.values.isActive).toBe(false);
      expect(resellerUpdate.values.updatedBy).toBe(ACTOR_ID);

      // Tokens and sessions are revoked by the `resellers_revoke_sessions` database trigger,
      // proven in reseller-suspension.integration.spec.ts; the service must not race it.
      expect(calls.updateRefreshTokens).not.toHaveBeenCalled();
      expect(calls.updateImpersonation).not.toHaveBeenCalled();

      expect(authEventService.emit).toHaveBeenCalledTimes(3);
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: ACTOR_ID,
        type: 'impersonation_end',
        scope: 'platform',
        metadata: { session_id: 'session-1', ended_reason: 'revoked' },
      });
      expect(authEventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'all_sessions_revoked',
          metadata: expect.objectContaining({ reason: 'reseller_suspended' }),
        }),
      );

      // Canonical upper-snake event for subscription consumers
      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.status_changed',
        expect.objectContaining({
          previousStatus: ResellerStatus.ACTIVE,
          newStatus: ResellerStatus.SUSPENDED,
          reason: 'policy violation',
        }),
      );

      expect(redis.del).toHaveBeenCalledWith('impersonation-session:session-1');
      expect(redis.set).toHaveBeenCalledWith(
        'impersonation-session:session-1:tombstone',
        '1',
        'EX',
        70,
      );
      expect(redis.set).toHaveBeenCalledWith(
        `auth:reseller-access:${NORMAL_RESELLER_ID}`,
        'blocked',
        'EX',
        60,
      );
      expect(redis.set).toHaveBeenCalledWith(
        `auth:reseller-access:${NORMAL_RESELLER_ID}:blocked`,
        '1',
        'EX',
        70,
      );
    });

    it('suspends reseller with no staff (no token revocation, still emits status_changed)', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.ACTIVE }],
        staffRows: [],
      });
      setTx(tx);

      await service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID);

      expect(calls.updateReseller).toHaveBeenCalledTimes(1);
      expect(calls.updateRefreshTokens).not.toHaveBeenCalled();
      expect(calls.updateImpersonation).not.toHaveBeenCalled();
      expect(authEventService.emit).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      // Staff added later must not slip through on a cached "allowed".
      expect(redis.set).toHaveBeenCalledWith(
        `auth:reseller-access:${NORMAL_RESELLER_ID}:blocked`,
        '1',
        'EX',
        70,
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.status_changed',
        expect.objectContaining({ newStatus: ResellerStatus.SUSPENDED }),
      );
    });
  });

  // ── unsuspendReseller ───────────────────────────────────────

  describe('unsuspendReseller', () => {
    it('throws RESELLER_NOT_FOUND when reseller does not exist', async () => {
      const { tx } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await expect(service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });

    it('throws SYSTEM_RESELLER_PROTECTED for system reseller', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: SYSTEM_RESELLER_ID, isSystem: true, status: ResellerStatus.ACTIVE }],
      });
      setTx(tx);

      await expect(service.unsuspendReseller(SYSTEM_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.SYSTEM_RESELLER_PROTECTED,
      });
    });

    it('throws RESELLER_INVALID when reseller is deleted', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.DELETED }],
      });
      setTx(tx);

      await expect(service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
    });

    it('throws RESELLER_NOT_SUSPENDED when reseller is not suspended', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.ACTIVE }],
      });
      setTx(tx);

      await expect(service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_SUSPENDED,
      });
    });

    it('reactivates a suspended reseller, clears suspendedAt, emits both events', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [
          { id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.SUSPENDED },
        ],
      });
      setTx(tx);

      await service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID);

      expect(calls.updateReseller).toHaveBeenCalledTimes(1);
      const update = calls.updateReseller.mock.calls[0][0].values;
      expect(update.status).toBe(ResellerStatus.ACTIVE);
      expect(update.suspendedAt).toBeNull();
      expect(update.isActive).toBe(true);
      expect(redis.del).toHaveBeenCalledWith(
        `auth:reseller-access:${NORMAL_RESELLER_ID}`,
        `auth:reseller-access:${NORMAL_RESELLER_ID}:blocked`,
      );

      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.status_changed',
        expect.objectContaining({
          previousStatus: ResellerStatus.SUSPENDED,
          newStatus: ResellerStatus.ACTIVE,
        }),
      );
    });
  });

  // ── deleteReseller ──────────────────────────────────────────

  describe('deleteReseller', () => {
    it('throws RESELLER_NOT_FOUND when reseller does not exist', async () => {
      const { tx } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await expect(service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });

    it('throws SYSTEM_RESELLER_PROTECTED for system reseller', async () => {
      const { tx } = createTxMock({
        resellerRows: [
          { id: SYSTEM_RESELLER_ID, isSystem: true, status: ResellerStatus.SUSPENDED },
        ],
      });
      setTx(tx);

      await expect(service.deleteReseller(SYSTEM_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.SYSTEM_RESELLER_PROTECTED,
      });
    });

    it('throws RESELLER_NOT_SUSPENDED when reseller is not suspended', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.ACTIVE }],
      });
      setTx(tx);

      await expect(service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_SUSPENDED,
      });
    });

    it('throws GRACE_PERIOD_NOT_ELAPSED when grace period (30 days) has not elapsed', async () => {
      const suspendedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const { tx } = createTxMock({
        resellerRows: [
          {
            id: NORMAL_RESELLER_ID,
            isSystem: false,
            status: ResellerStatus.SUSPENDED,
            suspendedAt,
          },
        ],
      });
      setTx(tx);

      await expect(service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.GRACE_PERIOD_NOT_ELAPSED,
      });
    });

    it('reassigns institutes, soft-deletes memberships and reseller after grace period', async () => {
      const suspendedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      const { tx, calls } = createTxMock({
        resellerRows: [
          {
            id: NORMAL_RESELLER_ID,
            isSystem: false,
            status: ResellerStatus.SUSPENDED,
            suspendedAt,
          },
        ],
        instituteRows: [{ id: 'inst-1' }, { id: 'inst-2' }],
      });
      setTx(tx);

      await service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID);

      expect(calls.updateInstitutes).toHaveBeenCalledTimes(1);
      expect(calls.updateInstitutes.mock.calls[0][0].values.resellerId).toBe(SYSTEM_RESELLER_ID);

      expect(calls.updateMemberships).toHaveBeenCalledTimes(1);
      const membershipUpdate = calls.updateMemberships.mock.calls[0][0].values;
      expect(membershipUpdate.deletedAt).toBeInstanceOf(Date);
      expect(membershipUpdate.deletedBy).toBe(ACTOR_ID);

      expect(calls.updateRoles).toHaveBeenCalledTimes(1);
      expect(calls.updateRoles.mock.calls[0][0].values.deletedAt).toBeInstanceOf(Date);

      expect(calls.updateReseller).toHaveBeenCalledTimes(1);
      const update = calls.updateReseller.mock.calls[0][0].values;
      expect(update.status).toBe(ResellerStatus.DELETED);
      expect(update.deletedAt).toBeInstanceOf(Date);
      expect(update.deletedBy).toBe(ACTOR_ID);
      expect(update.updatedBy).toBe(ACTOR_ID);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.status_changed',
        expect.objectContaining({
          newStatus: ResellerStatus.DELETED,
          affectedInstituteIds: ['inst-1', 'inst-2'],
        }),
      );
    });
  });

  // ── ROV-234: create / update / changeTier ───────────────────

  describe('create', () => {
    it('creates reseller with auto-derived slug, provisions identity, emits RESELLER.created with counts', async () => {
      const insertedReseller = {
        id: 'new-reseller-id',
        name: 'Acme Partners',
        slug: 'acme-partners',
        tier: ResellerTier.FULL_MANAGEMENT,
        status: ResellerStatus.ACTIVE,
        isSystem: false,
        isActive: true,
        branding: {},
        customDomain: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { tx, calls } = createTxMock({
        resellerRows: [], // no slug conflict
        insertedReseller,
        countRows: { reseller_memberships: 1 },
      });
      setTx(tx);

      const result = await service.create(
        {
          name: 'Acme Partners',
          tier: ResellerTier.FULL_MANAGEMENT,
          initialAdminEmail: 'admin@acme.test',
        },
        ACTOR_ID,
      );

      // Slug auto-derived from name
      expect(calls.insertReseller).toHaveBeenCalledWith(
        expect.objectContaining({
          values: expect.objectContaining({ slug: 'acme-partners', status: ResellerStatus.ACTIVE }),
        }),
      );

      // The reseller gets its own copy of all three system roles
      expect(calls.insertRoles).toHaveBeenCalledTimes(1);
      const roleValues: { name: { en: string }; resellerId: string; scope: string }[] =
        calls.insertRoles.mock.calls[0][0].values;
      expect(roleValues.map((r) => r.name.en)).toEqual([
        'reseller_full_admin',
        'reseller_support_admin',
        'reseller_viewer',
      ]);
      expect(roleValues.map((r) => r.resellerId)).toEqual([
        'new-reseller-id',
        'new-reseller-id',
        'new-reseller-id',
      ]);
      expect(roleValues.map((r) => r.scope)).toEqual(['reseller', 'reseller', 'reseller']);

      expect(identityService.createUser).toHaveBeenCalledWith({
        email: 'admin@acme.test',
        username: 'admin@acme.test',
        actorId: ACTOR_ID,
      });
      expect(identityService.createMembership).toHaveBeenCalledWith({
        userId: 'new-user-id',
        scope: 'reseller',
        resellerId: 'new-reseller-id',
        roleId: 'role-reseller_full_admin',
        actorId: ACTOR_ID,
      });
      expect(identityService.sendWelcomeNotification).toHaveBeenCalledWith({
        userId: 'new-user-id',
        username: 'admin@acme.test',
        email: 'admin@acme.test',
        tempPassword: 'temp-pass',
        scope: 'reseller',
        resellerId: 'new-reseller-id',
      });

      expect(eventBus.emit).toHaveBeenCalledWith('RESELLER.created', {
        ...insertedReseller,
        instituteCount: 0,
        teamSize: 1,
        scope: 'platform',
      });
      expect(result).toEqual({ ...insertedReseller, instituteCount: 0, teamSize: 1 });
    });

    it('links an existing user with that email and sends no welcome message', async () => {
      vi.mocked(identityService.findUsersByEmail).mockResolvedValue([
        { userId: 'existing-user-id', isDeleted: false },
      ]);
      const { tx } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await service.create(
        { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'taken@acme.test' },
        ACTOR_ID,
      );

      expect(identityService.createUser).not.toHaveBeenCalled();
      expect(identityService.createMembership).toHaveBeenCalledWith({
        userId: 'existing-user-id',
        scope: 'reseller',
        resellerId: 'new-reseller-id',
        roleId: 'role-reseller_viewer',
        actorId: ACTOR_ID,
      });
      expect(identityService.sendWelcomeNotification).not.toHaveBeenCalled();
    });

    it('throws RESELLER_ADMIN_EMAIL_UNAVAILABLE for a deleted user and creates nothing', async () => {
      vi.mocked(identityService.findUsersByEmail).mockResolvedValue([
        { userId: 'deleted-user-id', isDeleted: true },
      ]);
      const { tx, calls } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'gone@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE });
      expect(calls.insertReseller).not.toHaveBeenCalled();
      expect(identityService.createUser).not.toHaveBeenCalled();
    });

    it('refuses an email that is another account Roviq ID instead of linking that account', async () => {
      vi.mocked(identityService.isUsernameTaken).mockResolvedValue(true);
      const { tx, calls } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'x@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE });
      expect(identityService.isUsernameTaken).toHaveBeenCalledWith('x@acme.test');
      expect(identityService.createMembership).not.toHaveBeenCalled();
      expect(calls.insertReseller).not.toHaveBeenCalled();
    });

    it('refuses when several accounts share the email in different case', async () => {
      vi.mocked(identityService.findUsersByEmail).mockResolvedValue([
        { userId: 'user-a', isDeleted: false },
        { userId: 'user-b', isDeleted: false },
      ]);
      const { tx, calls } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'x@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE });
      expect(calls.insertReseller).not.toHaveBeenCalled();
    });

    it('looks the email up trimmed and lower-cased and stores it that way', async () => {
      const { tx } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await service.create(
        { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: '  Admin@Acme.TEST ' },
        ACTOR_ID,
      );

      expect(identityService.findUsersByEmail).toHaveBeenCalledWith('admin@acme.test');
      expect(identityService.createUser).toHaveBeenCalledWith({
        email: 'admin@acme.test',
        username: 'admin@acme.test',
        actorId: ACTOR_ID,
      });
    });

    it('checks the slug before creating any user', async () => {
      const { tx } = createTxMock({ resellerRows: [{ id: 'other', slug: 'acme' }] });
      setTx(tx);

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'a@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.SLUG_DUPLICATE });
      expect(identityService.findUsersByEmail).not.toHaveBeenCalled();
      expect(identityService.createUser).not.toHaveBeenCalled();
    });

    it('throws SLUG_DUPLICATE when slug is already taken', async () => {
      // 1st select = slug conflict lookup (finds an existing row)
      const { tx } = createTxMock({
        resellerRows: [{ id: 'some-other', slug: 'acme-partners' }],
      });
      setTx(tx);

      const promise = service.create(
        {
          name: 'Acme Partners',
          slug: 'acme-partners',
          tier: ResellerTier.FULL_MANAGEMENT,
          initialAdminEmail: 'admin@acme.test',
        },
        ACTOR_ID,
      );
      await expect(promise).rejects.toBeInstanceOf(BusinessException);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.SLUG_DUPLICATE });
    });

    it.each([
      [ResellerTier.FULL_MANAGEMENT, 'role-reseller_full_admin'],
      [ResellerTier.SUPPORT_MANAGEMENT, 'role-reseller_support_admin'],
      [ResellerTier.READ_ONLY, 'role-reseller_viewer'],
    ])('should give the initial admin the %s copy of the reseller role', async (tier, roleId) => {
      const { tx } = createTxMock({ resellerRows: [] });
      setTx(tx);

      await service.create(
        { name: 'Acme Partners', tier, initialAdminEmail: 'admin@acme.test' },
        ACTOR_ID,
      );

      expect(identityService.createMembership).toHaveBeenCalledWith({
        userId: 'new-user-id',
        scope: 'reseller',
        resellerId: 'new-reseller-id',
        roleId,
        actorId: ACTOR_ID,
      });
    });
  });

  describe('update', () => {
    it('throws SYSTEM_RESELLER_PROTECTED when updating Roviq Direct', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: SYSTEM_RESELLER_ID, isSystem: true, status: ResellerStatus.ACTIVE }],
      });
      setTx(tx);

      const promise = service.update(SYSTEM_RESELLER_ID, { version: 1, name: 'Renamed' }, ACTOR_ID);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.SYSTEM_RESELLER_PROTECTED });
    });

    it('throws RESELLER_INVALID when the reseller is soft-deleted', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.DELETED }],
      });
      setTx(tx);

      await expect(
        service.update(NORMAL_RESELLER_ID, { version: 1, name: 'Renamed' }, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_INVALID });
    });

    it('applies patch and emits RESELLER.updated', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [
          {
            id: NORMAL_RESELLER_ID,
            isSystem: false,
            status: ResellerStatus.ACTIVE,
            name: 'Old Name',
          },
        ],
        countRows: { institutes: 4 },
      });
      setTx(tx);

      const result = await service.update(
        NORMAL_RESELLER_ID,
        {
          version: 3,
          name: 'New Name',
          registrationNumber: 'U72900RJ2024PTC012345',
          registrationState: IndianState.RAJASTHAN,
          customDomain: null,
        },
        ACTOR_ID,
      );

      expect(calls.updateReseller).toHaveBeenCalledTimes(1);
      const { version, ...values } = calls.updateReseller.mock.calls[0][0].values;
      expect(values).toEqual({
        name: 'New Name',
        registrationNumber: 'U72900RJ2024PTC012345',
        registrationState: IndianState.RAJASTHAN,
        customDomain: null,
        updatedBy: ACTOR_ID,
      });
      expect(version).toBeInstanceOf(SQL);
      expect(result.instituteCount).toBe(4);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.updated',
        expect.objectContaining({ name: 'New Name', instituteCount: 4, actorId: ACTOR_ID }),
      );
    });

    it('throws CONCURRENT_MODIFICATION when the version no longer matches', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.ACTIVE }],
        updateMatches: false,
      });
      setTx(tx);

      await expect(
        service.update(NORMAL_RESELLER_ID, { version: 1, name: 'Late' }, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('changeTier', () => {
    it('throws SYSTEM_RESELLER_PROTECTED on Roviq Direct', async () => {
      const { tx } = createTxMock({
        resellerRows: [{ id: SYSTEM_RESELLER_ID, isSystem: true, status: ResellerStatus.ACTIVE }],
      });
      setTx(tx);

      await expect(
        service.changeTier(SYSTEM_RESELLER_ID, ResellerTier.READ_ONLY, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.SYSTEM_RESELLER_PROTECTED });
    });

    it('throws TIER_CHANGE_REQUIRES_ACTIVE when reseller is suspended', async () => {
      const { tx } = createTxMock({
        resellerRows: [
          { id: NORMAL_RESELLER_ID, isSystem: false, status: ResellerStatus.SUSPENDED },
        ],
      });
      setTx(tx);

      await expect(
        service.changeTier(NORMAL_RESELLER_ID, ResellerTier.READ_ONLY, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.TIER_CHANGE_REQUIRES_ACTIVE });
    });

    it('is a no-op when the new tier equals the existing tier (no DB write, no event)', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [
          {
            id: NORMAL_RESELLER_ID,
            isSystem: false,
            status: ResellerStatus.ACTIVE,
            tier: ResellerTier.FULL_MANAGEMENT,
          },
        ],
        // No extraSelectRows — role lookup must NOT be reached
      });
      setTx(tx);

      const result = await service.changeTier(
        NORMAL_RESELLER_ID,
        ResellerTier.FULL_MANAGEMENT,
        ACTOR_ID,
      );

      expect(calls.updateReseller).not.toHaveBeenCalled();
      expect(calls.updateMemberships).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(result.id).toBe(NORMAL_RESELLER_ID);
    });

    it('cascades role update to memberships and emits RESELLER.tier_changed', async () => {
      const { tx, calls } = createTxMock({
        resellerRows: [
          {
            id: NORMAL_RESELLER_ID,
            isSystem: false,
            status: ResellerStatus.ACTIVE,
            tier: ResellerTier.FULL_MANAGEMENT,
          },
        ],
      });
      setTx(tx);

      await service.changeTier(NORMAL_RESELLER_ID, ResellerTier.READ_ONLY, ACTOR_ID);

      expect(calls.updateReseller).toHaveBeenCalled();
      expect(calls.updateReseller.mock.calls[0][0].values.tier).toBe(ResellerTier.READ_ONLY);
      expect(calls.updateMemberships).toHaveBeenCalledTimes(1);
      expect(calls.insertRoles.mock.calls[0][0].values[0].resellerId).toBe(NORMAL_RESELLER_ID);
      expect(calls.updateMemberships.mock.calls[0][0].values.roleId).toBe('role-reseller_viewer');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.tier_changed',
        expect.objectContaining({
          oldTier: ResellerTier.FULL_MANAGEMENT,
          newTier: ResellerTier.READ_ONLY,
          actorId: ACTOR_ID,
        }),
      );
    });
  });
});
