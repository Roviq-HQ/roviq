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
 * The repository is a fake over staged rows: each lifecycle method runs the
 * service's rule callback on the staged reseller and records a write only when
 * the rule lets it through. The SQL itself is covered by
 * reseller-suspension.integration.spec.ts and admin-reseller.integration.spec.ts.
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
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthEventService } from '../../../auth/auth-event.service';
import { IdentityService } from '../../../auth/identity.service';
import { AdminResellerService } from '../admin-reseller.service';
import { AdminResellerRepository } from '../repositories/admin-reseller.repository';
import type {
  MemberRoleMove,
  ResellerMemberRole,
  ResellerPatch,
  ResellerRecord,
  ResellerSystemRoleIds,
} from '../repositories/types';

const SYSTEM_RESELLER_ID = '00000000-0000-7000-a000-000000000011';
const NORMAL_RESELLER_ID = '11111111-1111-4111-a111-111111111111';
const ACTOR_ID = '22222222-2222-4222-a222-222222222222';

const ROLE_IDS: ResellerSystemRoleIds = {
  reseller_full_admin: 'role-reseller_full_admin',
  reseller_support_admin: 'role-reseller_support_admin',
  reseller_viewer: 'role-reseller_viewer',
};

function buildReseller(overrides: Partial<ResellerRecord> = {}): ResellerRecord {
  return {
    id: NORMAL_RESELLER_ID,
    name: 'Acme Partners',
    slug: 'acme-partners',
    tier: ResellerTier.FULL_MANAGEMENT,
    isSystem: false,
    isActive: true,
    status: ResellerStatus.ACTIVE,
    suspendedAt: null,
    branding: {},
    logoFileId: null,
    faviconFileId: null,
    customDomain: null,
    registrationNumber: null,
    registrationState: null,
    contact: { phones: [], emails: [] },
    address: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: ACTOR_ID,
    updatedBy: ACTOR_ID,
    deletedAt: null,
    deletedBy: null,
    version: 1,
    ...overrides,
  };
}

interface Stages {
  /** The reseller every lifecycle method reads; absent means not found. */
  reseller?: ResellerRecord;
  /** Members (with their role) that a tier change walks. */
  members?: ResellerMemberRole[];
  staffUserIds?: string[];
  endedSessionIds?: string[];
  affectedInstituteIds?: string[];
  slugTaken?: boolean;
  /** Row the create insert returns. */
  created?: ResellerRecord;
  /** Grouped counts for the reseller of the result. */
  counts?: { institutes?: number; teamSize?: number };
  /** False simulates a version mismatch: the reseller UPDATE matches no row. */
  updateMatches?: boolean;
}

interface Writes {
  suspended: boolean;
  unsuspended: boolean;
  deleted: boolean;
  tierChanged: boolean;
  patch?: ResellerPatch;
  moved?: MemberRoleMove[];
}

function createRepo(stages: Stages, writes: Writes): AdminResellerRepository {
  const row = stages.reseller;
  return createMock<AdminResellerRepository>({
    slugTaken: vi.fn().mockResolvedValue(stages.slugTaken ?? false),
    create: vi.fn().mockImplementation(async () => ({
      reseller: stages.created ?? buildReseller({ id: 'new-reseller-id' }),
      roleIds: ROLE_IDS,
    })),
    update: vi
      .fn()
      .mockImplementation(
        async (
          _id: string,
          _version: number,
          _actorId: string,
          buildPatch: (existing: ResellerRecord) => ResellerPatch,
        ) => {
          if (!row) return { kind: 'not_found' };
          const patch = buildPatch(row);
          writes.patch = patch;
          if (stages.updateMatches === false) return { kind: 'conflict' };
          return { kind: 'ok', record: { ...row, ...patch } };
        },
      ),
    changeTier: vi
      .fn()
      .mockImplementation(
        async (
          _id: string,
          newTier: ResellerTier,
          _actorId: string,
          rules: Parameters<AdminResellerRepository['changeTier']>[3],
        ) => {
          if (!row) return { kind: 'not_found' };
          if (rules.decide(row) === 'skip') {
            return { kind: 'ok', record: row, oldTier: row.tier, moved: [] };
          }
          writes.tierChanged = true;
          const moved = rules.planMoves(row, stages.members ?? [], ROLE_IDS);
          writes.moved = moved;
          return { kind: 'ok', record: { ...row, tier: newTier }, oldTier: row.tier, moved };
        },
      ),
    suspend: vi
      .fn()
      .mockImplementation(
        async (_id: string, _actorId: string, check: (r: ResellerRecord) => void) => {
          if (!row) return { kind: 'not_found' };
          check(row);
          writes.suspended = true;
          return {
            kind: 'ok',
            record: { ...row, status: ResellerStatus.SUSPENDED, isActive: false },
            previousStatus: row.status,
            staffUserIds: stages.staffUserIds ?? [],
            endedSessionIds: stages.endedSessionIds ?? [],
          };
        },
      ),
    unsuspend: vi
      .fn()
      .mockImplementation(
        async (_id: string, _actorId: string, check: (r: ResellerRecord) => void) => {
          if (!row) return { kind: 'not_found' };
          check(row);
          writes.unsuspended = true;
          return { kind: 'ok', record: { ...row, status: ResellerStatus.ACTIVE, isActive: true } };
        },
      ),
    delete: vi
      .fn()
      .mockImplementation(
        async (
          _id: string,
          _actorId: string,
          _defaultResellerId: string,
          check: (r: ResellerRecord) => void,
        ) => {
          if (!row) return { kind: 'not_found' };
          check(row);
          writes.deleted = true;
          return {
            kind: 'ok',
            record: { ...row, status: ResellerStatus.DELETED, deletedAt: new Date() },
            affectedInstituteIds: stages.affectedInstituteIds ?? [],
          };
        },
      ),
    counts: vi.fn().mockImplementation(async (ids: string[]) => {
      const instituteCount = new Map<string, number>();
      const teamSize = new Map<string, number>();
      if (stages.counts?.institutes !== undefined) {
        instituteCount.set(ids[0], stages.counts.institutes);
      }
      if (stages.counts?.teamSize !== undefined) teamSize.set(ids[0], stages.counts.teamSize);
      return { instituteCount, teamSize };
    }),
  });
}

describe('AdminResellerService', () => {
  let service: AdminResellerService;
  let authEventService: AuthEventService;
  let redis: Redis;
  let eventBus: EventBusService;
  let identityService: IdentityService;
  let repo: AdminResellerRepository;
  let writes: Writes;

  function stage(stages: Stages) {
    writes = { suspended: false, unsuspended: false, deleted: false, tierChanged: false };
    repo = createRepo(stages, writes);
    service = new AdminResellerService(repo, redis, authEventService, eventBus, identityService);
  }

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
    // The real resolution runs on top of the mocked lookups, so these tests still cover it.
    identityService.findOrCreateUserByEmail = vi.fn((email: string, actorId: string) =>
      IdentityService.prototype.findOrCreateUserByEmail.call(identityService, email, actorId),
    );
  });

  // ── suspendReseller ─────────────────────────────────────────

  describe('suspendReseller', () => {
    it('throws RESELLER_NOT_FOUND when reseller does not exist', async () => {
      stage({});

      await expect(service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });

    it('throws SYSTEM_RESELLER_PROTECTED when reseller.isSystem=true', async () => {
      stage({ reseller: buildReseller({ id: SYSTEM_RESELLER_ID, isSystem: true }) });

      await expect(service.suspendReseller(SYSTEM_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.SYSTEM_RESELLER_PROTECTED,
      });
      expect(writes.suspended).toBe(false);
    });

    it('throws RESELLER_ALREADY_SUSPENDED when reseller is already suspended', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.SUSPENDED }) });

      await expect(service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_ALREADY_SUSPENDED,
      });
      expect(writes.suspended).toBe(false);
    });

    it('throws RESELLER_INVALID when reseller is deleted', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.DELETED }) });

      await expect(service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
      expect(writes.suspended).toBe(false);
    });

    it('suspends reseller, drops the session caches and emits events', async () => {
      stage({
        reseller: buildReseller(),
        staffUserIds: ['staff-1', 'staff-2'],
        endedSessionIds: ['session-1'],
      });

      await service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID, 'policy violation');

      expect(repo.suspend).toHaveBeenCalledTimes(1);
      expect(vi.mocked(repo.suspend).mock.calls[0][0]).toBe(NORMAL_RESELLER_ID);
      expect(vi.mocked(repo.suspend).mock.calls[0][1]).toBe(ACTOR_ID);
      expect(writes.suspended).toBe(true);

      expect(authEventService.emit).toHaveBeenCalledTimes(3);
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: ACTOR_ID,
        type: 'IMPERSONATION_END',
        scope: 'platform',
        metadata: { session_id: 'session-1', ended_reason: 'revoked' },
      });
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'staff-1',
        type: 'ALL_SESSIONS_REVOKED',
        metadata: {
          reason: 'reseller_suspended',
          resellerId: NORMAL_RESELLER_ID,
          suspensionReason: 'policy violation',
        },
      });

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
      stage({ reseller: buildReseller(), staffUserIds: [], endedSessionIds: [] });

      await service.suspendReseller(NORMAL_RESELLER_ID, ACTOR_ID);

      expect(writes.suspended).toBe(true);
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
      stage({});

      await expect(service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });

    it('throws SYSTEM_RESELLER_PROTECTED for system reseller', async () => {
      stage({ reseller: buildReseller({ id: SYSTEM_RESELLER_ID, isSystem: true }) });

      await expect(service.unsuspendReseller(SYSTEM_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.SYSTEM_RESELLER_PROTECTED,
      });
      expect(writes.unsuspended).toBe(false);
    });

    it('throws RESELLER_INVALID when reseller is deleted', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.DELETED }) });

      await expect(service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_INVALID,
      });
      expect(writes.unsuspended).toBe(false);
    });

    it('throws RESELLER_NOT_SUSPENDED when reseller is not suspended', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.ACTIVE }) });

      await expect(service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_SUSPENDED,
      });
      expect(writes.unsuspended).toBe(false);
    });

    it('reactivates a suspended reseller, clears suspendedAt, emits both events', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.SUSPENDED }) });

      await service.unsuspendReseller(NORMAL_RESELLER_ID, ACTOR_ID);

      expect(writes.unsuspended).toBe(true);
      expect(vi.mocked(repo.unsuspend).mock.calls[0][1]).toBe(ACTOR_ID);
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
      stage({});

      await expect(service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });

    it('throws SYSTEM_RESELLER_PROTECTED for system reseller', async () => {
      stage({
        reseller: buildReseller({
          id: SYSTEM_RESELLER_ID,
          isSystem: true,
          status: ResellerStatus.SUSPENDED,
        }),
      });

      await expect(service.deleteReseller(SYSTEM_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.SYSTEM_RESELLER_PROTECTED,
      });
      expect(writes.deleted).toBe(false);
    });

    it('throws RESELLER_NOT_SUSPENDED when reseller is not suspended', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.ACTIVE }) });

      await expect(service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_SUSPENDED,
      });
      expect(writes.deleted).toBe(false);
    });

    it('throws GRACE_PERIOD_NOT_ELAPSED when grace period (30 days) has not elapsed', async () => {
      const suspendedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      stage({ reseller: buildReseller({ status: ResellerStatus.SUSPENDED, suspendedAt }) });

      await expect(service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.GRACE_PERIOD_NOT_ELAPSED,
      });
      expect(writes.deleted).toBe(false);
    });

    it('reassigns institutes, soft-deletes memberships and reseller after grace period', async () => {
      const suspendedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      stage({
        reseller: buildReseller({ status: ResellerStatus.SUSPENDED, suspendedAt }),
        affectedInstituteIds: ['inst-1', 'inst-2'],
      });

      await service.deleteReseller(NORMAL_RESELLER_ID, ACTOR_ID);

      expect(writes.deleted).toBe(true);
      const [id, actorId, defaultResellerId] = vi.mocked(repo.delete).mock.calls[0];
      expect(id).toBe(NORMAL_RESELLER_ID);
      expect(actorId).toBe(ACTOR_ID);
      // Institutes move to the "Roviq Direct" system reseller.
      expect(defaultResellerId).toBe(SYSTEM_RESELLER_ID);

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
      const insertedReseller = buildReseller({
        id: 'new-reseller-id',
        name: 'Acme Partners',
        slug: 'acme-partners',
        tier: ResellerTier.FULL_MANAGEMENT,
      });
      stage({ created: insertedReseller, counts: { teamSize: 1 } });

      const result = await service.create(
        {
          name: 'Acme Partners',
          tier: ResellerTier.FULL_MANAGEMENT,
          initialAdminEmail: 'admin@acme.test',
        },
        ACTOR_ID,
      );

      // Slug auto-derived from name
      expect(repo.create).toHaveBeenCalledWith({
        name: 'Acme Partners',
        slug: 'acme-partners',
        tier: ResellerTier.FULL_MANAGEMENT,
        branding: {},
        customDomain: null,
        actorId: ACTOR_ID,
      });

      expect(identityService.createUser).toHaveBeenCalledWith({
        email: 'admin@acme.test',
        username: 'admin@acme.test',
        actorId: ACTOR_ID,
        // A reseller's first admin is created by the platform, not by an institute.
        originTenantId: null,
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

    it('refuses an existing account whose email is not verified and that someone else created', async () => {
      vi.mocked(identityService.findUsersByEmail).mockResolvedValue([
        {
          userId: 'squatted-user-id',
          isDeleted: false,
          isEmailVerified: false,
          createdBy: 'other-actor',
        },
      ]);
      stage({});

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'taken@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE,
        message: 'Initial admin email cannot be used',
      });
      expect(identityService.createMembership).not.toHaveBeenCalled();
    });

    it('links an existing user with that email and sends no welcome message', async () => {
      vi.mocked(identityService.findUsersByEmail).mockResolvedValue([
        {
          userId: 'existing-user-id',
          isDeleted: false,
          isEmailVerified: true,
          createdBy: 'other-actor',
        },
      ]);
      stage({});

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
        {
          userId: 'deleted-user-id',
          isDeleted: true,
          isEmailVerified: true,
          createdBy: 'other-actor',
        },
      ]);
      stage({});

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'gone@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE });
      expect(repo.create).not.toHaveBeenCalled();
      expect(identityService.createUser).not.toHaveBeenCalled();
    });

    it('refuses an email that is another account Roviq ID instead of linking that account', async () => {
      vi.mocked(identityService.isUsernameTaken).mockResolvedValue(true);
      stage({});

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'x@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE });
      expect(identityService.isUsernameTaken).toHaveBeenCalledWith('x@acme.test');
      expect(identityService.createMembership).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('refuses when several accounts share the email in different case', async () => {
      vi.mocked(identityService.findUsersByEmail).mockResolvedValue([
        { userId: 'user-a', isDeleted: false, isEmailVerified: true, createdBy: 'other-actor' },
        { userId: 'user-b', isDeleted: false, isEmailVerified: true, createdBy: 'other-actor' },
      ]);
      stage({});

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'x@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_ADMIN_EMAIL_UNAVAILABLE });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('looks the email up trimmed and lower-cased and stores it that way', async () => {
      stage({});

      await service.create(
        { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: '  Admin@Acme.TEST ' },
        ACTOR_ID,
      );

      expect(identityService.findUsersByEmail).toHaveBeenCalledWith('admin@acme.test');
      expect(identityService.createUser).toHaveBeenCalledWith({
        email: 'admin@acme.test',
        username: 'admin@acme.test',
        actorId: ACTOR_ID,
        // A reseller's first admin is created by the platform, not by an institute.
        originTenantId: null,
      });
    });

    it('checks the slug before creating any user', async () => {
      stage({ slugTaken: true });

      await expect(
        service.create(
          { name: 'Acme', tier: ResellerTier.READ_ONLY, initialAdminEmail: 'a@acme.test' },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.SLUG_DUPLICATE });
      expect(repo.slugTaken).toHaveBeenCalledWith('acme');
      expect(identityService.findUsersByEmail).not.toHaveBeenCalled();
      expect(identityService.createUser).not.toHaveBeenCalled();
    });

    it('throws SLUG_DUPLICATE when slug is already taken', async () => {
      stage({ slugTaken: true });

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
      expect(repo.slugTaken).toHaveBeenCalledWith('acme-partners');
    });

    it.each([
      [ResellerTier.FULL_MANAGEMENT, 'role-reseller_full_admin'],
      [ResellerTier.SUPPORT_MANAGEMENT, 'role-reseller_support_admin'],
      [ResellerTier.READ_ONLY, 'role-reseller_viewer'],
    ])('should give the initial admin the %s copy of the reseller role', async (tier, roleId) => {
      stage({});

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
      stage({ reseller: buildReseller({ id: SYSTEM_RESELLER_ID, isSystem: true }) });

      const promise = service.update(SYSTEM_RESELLER_ID, { version: 1, name: 'Renamed' }, ACTOR_ID);
      await expect(promise).rejects.toMatchObject({ code: ErrorCode.SYSTEM_RESELLER_PROTECTED });
      expect(writes.patch).toBeUndefined();
    });

    it('throws RESELLER_INVALID when the reseller is soft-deleted', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.DELETED }) });

      await expect(
        service.update(NORMAL_RESELLER_ID, { version: 1, name: 'Renamed' }, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.RESELLER_INVALID });
      expect(writes.patch).toBeUndefined();
    });

    it('applies patch and emits RESELLER.updated', async () => {
      stage({ reseller: buildReseller({ name: 'Old Name' }), counts: { institutes: 4 } });

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

      expect(repo.update).toHaveBeenCalledTimes(1);
      const [id, version, actorId] = vi.mocked(repo.update).mock.calls[0];
      expect([id, version, actorId]).toEqual([NORMAL_RESELLER_ID, 3, ACTOR_ID]);
      expect(writes.patch).toEqual({
        name: 'New Name',
        registrationNumber: 'U72900RJ2024PTC012345',
        registrationState: IndianState.RAJASTHAN,
        customDomain: null,
      });
      expect(result.instituteCount).toBe(4);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.updated',
        expect.objectContaining({ name: 'New Name', instituteCount: 4, actorId: ACTOR_ID }),
      );
    });

    it('leaves name and contact alone when they arrive as null', async () => {
      stage({ reseller: buildReseller() });

      await service.update(
        NORMAL_RESELLER_ID,
        { version: 2, name: null, contact: null, branding: null, registrationNumber: 'U1' },
        ACTOR_ID,
      );

      expect(writes.patch).toEqual({ registrationNumber: 'U1' });
    });

    it("keeps the reseller's own theme and stylesheet when the platform edits branding", async () => {
      stage({
        reseller: buildReseller({
          branding: {
            primaryColor: '#000000',
            theme: 'DARK',
            customCss: '.brand-header { letter-spacing: 1px; }',
          },
        }),
      });

      await service.update(
        NORMAL_RESELLER_ID,
        { version: 2, branding: { primaryColor: '#112233' } },
        ACTOR_ID,
      );

      expect(writes.patch?.branding).toEqual({
        primaryColor: '#112233',
        theme: 'DARK',
        customCss: '.brand-header { letter-spacing: 1px; }',
      });
    });

    it('throws CONCURRENT_MODIFICATION when the version no longer matches', async () => {
      stage({ reseller: buildReseller(), updateMatches: false });

      await expect(
        service.update(NORMAL_RESELLER_ID, { version: 1, name: 'Late' }, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('changeTier', () => {
    it('throws SYSTEM_RESELLER_PROTECTED on Roviq Direct', async () => {
      stage({ reseller: buildReseller({ id: SYSTEM_RESELLER_ID, isSystem: true }) });

      await expect(
        service.changeTier(SYSTEM_RESELLER_ID, ResellerTier.READ_ONLY, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.SYSTEM_RESELLER_PROTECTED });
      expect(writes.tierChanged).toBe(false);
    });

    it('throws TIER_CHANGE_REQUIRES_ACTIVE when reseller is suspended', async () => {
      stage({ reseller: buildReseller({ status: ResellerStatus.SUSPENDED }) });

      await expect(
        service.changeTier(NORMAL_RESELLER_ID, ResellerTier.READ_ONLY, ACTOR_ID),
      ).rejects.toMatchObject({ code: ErrorCode.TIER_CHANGE_REQUIRES_ACTIVE });
      expect(writes.tierChanged).toBe(false);
    });

    it('is a no-op when the new tier equals the existing tier (no DB write, no event)', async () => {
      stage({ reseller: buildReseller({ tier: ResellerTier.FULL_MANAGEMENT }) });

      const result = await service.changeTier(
        NORMAL_RESELLER_ID,
        ResellerTier.FULL_MANAGEMENT,
        ACTOR_ID,
      );

      expect(writes.tierChanged).toBe(false);
      expect(writes.moved).toBeUndefined();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(result.id).toBe(NORMAL_RESELLER_ID);
    });

    it('moves each member by the tier rule, expires moved tokens and emits RESELLER.tier_changed', async () => {
      stage({
        reseller: buildReseller({ tier: ResellerTier.FULL_MANAGEMENT }),
        members: [
          { id: 'm-admin', roleId: 'role-reseller_full_admin', roleName: 'reseller_full_admin' },
          {
            id: 'm-support',
            roleId: 'role-reseller_support_admin',
            roleName: 'reseller_support_admin',
          },
          { id: 'm-viewer', roleId: 'role-reseller_viewer', roleName: 'reseller_viewer' },
        ],
      });

      await service.changeTier(NORMAL_RESELLER_ID, ResellerTier.SUPPORT_MANAGEMENT, ACTOR_ID);

      const [id, newTier, actorId] = vi.mocked(repo.changeTier).mock.calls[0];
      expect([id, newTier, actorId]).toEqual([
        NORMAL_RESELLER_ID,
        ResellerTier.SUPPORT_MANAGEMENT,
        ACTOR_ID,
      ]);
      expect(writes.tierChanged).toBe(true);
      // Only the full admin holds a role above the new tier; the other two keep theirs.
      expect(writes.moved).toEqual([{ id: 'm-admin', roleId: 'role-reseller_support_admin' }]);
      expect(redis.set).toHaveBeenCalledWith(
        'auth:reseller-member-access:m-admin',
        'role-reseller_support_admin',
        'EX',
        660,
      );
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'RESELLER.tier_changed',
        expect.objectContaining({
          oldTier: ResellerTier.FULL_MANAGEMENT,
          newTier: ResellerTier.SUPPORT_MANAGEMENT,
          actorId: ACTOR_ID,
        }),
      );
    });

    it('promotes holders of the old top role on an upgrade and nobody else', async () => {
      stage({
        reseller: buildReseller({ tier: ResellerTier.SUPPORT_MANAGEMENT }),
        members: [
          {
            id: 'm-support',
            roleId: 'role-reseller_support_admin',
            roleName: 'reseller_support_admin',
          },
          { id: 'm-viewer', roleId: 'role-reseller_viewer', roleName: 'reseller_viewer' },
        ],
      });

      await service.changeTier(NORMAL_RESELLER_ID, ResellerTier.FULL_MANAGEMENT, ACTOR_ID);

      expect(writes.moved).toEqual([{ id: 'm-support', roleId: 'role-reseller_full_admin' }]);
      expect(redis.set).toHaveBeenCalledWith(
        'auth:reseller-member-access:m-support',
        'role-reseller_full_admin',
        'EX',
        660,
      );
    });
  });
});
