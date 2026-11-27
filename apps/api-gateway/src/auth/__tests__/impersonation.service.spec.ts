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
 * The repository is mocked; its SQL is covered by impersonation.integration.spec.ts.
 * `node:crypto` is mocked so `randomInt`/`randomUUID` are deterministic.
 */

import assert from 'node:assert';
import { randomInt, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AbilityFactory } from '@roviq/casl';
import type {
  AbilityRule,
  AppAbility,
  InstituteContext,
  PlatformContext,
  ResellerContext,
} from '@roviq/common-types';
import { ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthEventService } from '../auth-event.service';
import { ImpersonationSessionStatus } from '../dto/impersonation-session.model';
import { ImpersonationService } from '../impersonation.service';
import { REDIS_KEYS } from '../redis-keys';
import { ImpersonationRepository } from '../repositories/impersonation.repository';
import type {
  ImpersonationActorMembership,
  ImpersonationExchangeRows,
  ImpersonationInstitute,
  ImpersonationSessionListRow,
  ImpersonationTargetMembership,
  ImpersonatorRoleNames,
} from '../repositories/types';

// ── Module-level mocks ─────────────────────────────────────────

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: vi.fn(() => 123456),
    randomUUID: vi.fn(() => 'fixed-uuid-0000-0000-0000-000000000000'),
  };
});

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

const ACTIVE_TARGET = { id: 'tgt-1', status: 'ACTIVE' };
const ADMIN_PHONE = { countryCode: '+91', number: '9999999999' };

function targetMembership(
  roleName: string,
  roleAbilities: AbilityRule[] = [],
): ImpersonationTargetMembership[] {
  return [{ id: 'tgt-mem', roleName, roleAbilities }];
}

function actorMembership(
  roleName: string,
  roleAbilities: AbilityRule[],
): ImpersonationActorMembership {
  return { id: 'imp-mem', roleId: 'imp-role', roleName, roleAbilities };
}

function institute(row: {
  resellerId: string;
  requireImpersonationConsent: boolean;
}): ImpersonationInstitute {
  return { id: 'tenant-1', ...row };
}

function emptyRoles(): ImpersonatorRoleNames {
  return { platform: new Map(), reseller: new Map(), institute: new Map() };
}

/** Every lookup answers "nothing found" until a test says otherwise. */
function createRepo() {
  return createMock<ImpersonationRepository>({
    findUserStatus: vi.fn().mockResolvedValue(null),
    findActiveMembershipsWithRole: vi.fn().mockResolvedValue([]),
    findInstitute: vi.fn().mockResolvedValue(null),
    isInstituteOfReseller: vi.fn().mockResolvedValue(false),
    findExchangeRows: vi.fn().mockResolvedValue({
      targetUser: null,
      membership: null,
      session: null,
      institute: null,
    }),
    findSessionForEnd: vi.fn().mockResolvedValue(null),
    endSession: vi.fn().mockResolvedValue(undefined),
    expireOverdueSessions: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ rows: [], roles: emptyRoles() }),
    hasActiveResellerMembership: vi.fn().mockResolvedValue(false),
    findActiveUserRolesInInstitute: vi.fn().mockResolvedValue([]),
    findActiveActorMembership: vi.fn().mockResolvedValue(null),
    hasActiveResellerMembershipOf: vi.fn().mockResolvedValue(false),
    findPlatformRoleAbilities: vi.fn().mockResolvedValue(null),
    findResellerRoleName: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue('session-1'),
    findInstituteAdminUserId: vi.fn().mockResolvedValue(null),
    findPrimaryPhone: vi.fn().mockResolvedValue(null),
  });
}

type Repo = ReturnType<typeof createRepo>;

/** Target user active, holding `memberships` in an institute shaped by `inst`. */
function arrangeStart(
  repo: Repo,
  memberships: ImpersonationTargetMembership[],
  inst: ImpersonationInstitute | null,
): void {
  vi.mocked(repo.findUserStatus).mockResolvedValue(ACTIVE_TARGET);
  vi.mocked(repo.findActiveMembershipsWithRole).mockResolvedValue(memberships);
  vi.mocked(repo.findInstitute).mockResolvedValue(inst);
  // The reseller-context read sees the institute only when it is the reseller's own.
  vi.mocked(repo.isInstituteOfReseller).mockResolvedValue(
    inst?.resellerId === resellerActor.resellerId,
  );
}

function arrangeOtpRecipient(repo: Repo): void {
  vi.mocked(repo.findInstituteAdminUserId).mockResolvedValue('admin-1');
  vi.mocked(repo.findPrimaryPhone).mockResolvedValue(ADMIN_PHONE);
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
  const repo = createRepo();
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
    repo,
    redis,
    eventBus,
  );

  return { service, config, jwt, authEventService, abilityFactory, repo, redis, eventBus };
}

/** The values the one session row was written with. */
function writtenSession(repo: Repo) {
  expect(repo.createSession).toHaveBeenCalledTimes(1);
  return vi.mocked(repo.createSession).mock.calls[0][0];
}

const mockedRandomInt = vi.mocked(randomInt as (min: number, max: number) => number);
const mockedRandomUUID = vi.mocked(randomUUID);

beforeEach(() => {
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
      const { service, repo } = createSubject();

      await expect(
        service.startImpersonation(impersonated(instituteActor), 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.findUserStatus).not.toHaveBeenCalled();
    });

    it('rejects self-impersonation', async () => {
      const { service } = createSubject();
      await expect(
        service.startImpersonation(platformActor, 'imp-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
    });

    it('rejects when target user is not found', async () => {
      const { service, repo } = createSubject();
      vi.mocked(repo.findActiveMembershipsWithRole).mockResolvedValue(targetMembership('student'));
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
      expect(repo.findUserStatus).toHaveBeenCalledWith('tgt-1');
    });

    it('rejects when target user is not ACTIVE', async () => {
      const { service, repo } = createSubject();
      vi.mocked(repo.findActiveMembershipsWithRole).mockResolvedValue(targetMembership('student'));
      vi.mocked(repo.findUserStatus).mockResolvedValue({ id: 'tgt-1', status: 'SUSPENDED' });
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
    });

    it('rejects when target has no active membership in the target tenant', async () => {
      const { service, repo } = createSubject();
      arrangeStart(repo, [], null);
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
      expect(repo.findActiveMembershipsWithRole).toHaveBeenCalledWith('tgt-1', 'tenant-1');
    });

    it('rejects when target institute is not found', async () => {
      const { service, repo } = createSubject();
      arrangeStart(repo, targetMembership('student'), null);
      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.INSTITUTE_NOT_FOUND });
      expect(repo.findInstitute).toHaveBeenCalledWith('tenant-1');
    });
  });

  describe('startImpersonation — OTP gating', () => {
    it('reseller scope owning the institute always requires OTP and parks the request in Redis', async () => {
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
      );
      vi.mocked(repo.hasActiveResellerMembership).mockResolvedValue(true);
      arrangeOtpRecipient(repo);

      const result = await service.startImpersonation(
        resellerActor,
        'tgt-1',
        'tenant-1',
        `  ${REASON_VALID}  `,
        { ip: '10.0.0.1', userAgent: 'vitest' },
      );

      expect(result).toEqual({ sessionId: FIXED_UUID, requiresOtp: true });
      expect(repo.hasActiveResellerMembership).toHaveBeenCalledWith({
        membershipId: 'imp-mem',
        userId: 'imp-1',
        resellerId: 'reseller-1',
      });
      expect(repo.findInstituteAdminUserId).toHaveBeenCalledWith('tenant-1');
      expect(repo.findPrimaryPhone).toHaveBeenCalledWith('admin-1');
      // No session row until the OTP is verified.
      expect(repo.createSession).not.toHaveBeenCalled();
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
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-B', requireImpersonationConsent: false }),
      );
      vi.mocked(repo.hasActiveResellerMembership).mockResolvedValue(true);

      await expect(
        service.startImpersonation(resellerActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
      // Refused before anything about the target is read.
      expect(repo.findUserStatus).not.toHaveBeenCalled();
      expect(repo.findActiveMembershipsWithRole).not.toHaveBeenCalled();
      expect(repo.findInstitute).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('reseller scope rejects a caller whose reseller membership is no longer active', async () => {
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
      );
      vi.mocked(repo.hasActiveResellerMembership).mockResolvedValue(false);

      await expect(
        service.startImpersonation(resellerActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('platform scope with consent flag returns the request id and dispatches OTP without a session row', async () => {
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
      );
      arrangeOtpRecipient(repo);

      const result = await service.startImpersonation(
        platformActor,
        'tgt-1',
        'tenant-1',
        REASON_VALID,
      );

      expect(result).toEqual({ sessionId: FIXED_UUID, requiresOtp: true });
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(vi.mocked(redis.set).mock.calls[0][0]).toBe(
        `${REDIS_KEYS.IMPERSONATION_OTP}${FIXED_UUID}`,
      );
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });

    it('platform scope without consent flag skips OTP, writes the session and returns an exchange code', async () => {
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('institute_admin', [{ action: 'manage', subject: 'all' }]),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
      );
      vi.mocked(repo.createSession).mockResolvedValue('session-11');

      const result = await service.startImpersonation(
        platformActor,
        'tgt-1',
        'tenant-1',
        REASON_VALID,
        { ip: '10.0.0.1', userAgent: 'vitest' },
      );

      expect(result).toEqual({ code: FIXED_UUID });
      const row = writtenSession(repo);
      expect(row).toEqual({
        impersonatorId: 'imp-1',
        impersonatorScope: 'platform',
        targetUserId: 'tgt-1',
        targetTenantId: 'tenant-1',
        reason: REASON_VALID,
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        otpVerifiedAt: null,
        otpVerifiedBy: null,
      });
      assert(row.startedAt instanceof Date);
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
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
      );
      vi.mocked(repo.findActiveActorMembership).mockResolvedValue(
        actorMembership('institute_admin', [{ action: 'manage', subject: 'all' }]),
      );
      vi.mocked(repo.createSession).mockResolvedValue('session-13');

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
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
      );

      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_CONSENT_UNAVAILABLE });

      expect(repo.findPrimaryPhone).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('OTP path: institute_admin without a primary phone rejects without writing the Redis OTP key', async () => {
      const { service, repo, redis, eventBus } = createSubject();
      arrangeStart(
        repo,
        targetMembership('student'),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: true }),
      );
      vi.mocked(repo.findInstituteAdminUserId).mockResolvedValue('admin-1');

      await expect(
        service.startImpersonation(platformActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_CONSENT_UNAVAILABLE });

      expect(redis.set).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('startImpersonation — intra-institute authorization', () => {
    const MANAGE_ALL: AbilityRule[] = [{ action: 'manage', subject: 'all' }];
    const IMPERSONATE: AbilityRule[] = [{ action: 'impersonate', subject: 'User' }];

    function arrange(
      targetRole: string,
      targetAbilities: AbilityRule[],
      actor: ImpersonationActorMembership | null,
    ) {
      const subject = createSubject();
      arrangeStart(
        subject.repo,
        targetMembership(targetRole, targetAbilities),
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
      );
      vi.mocked(subject.repo.findActiveActorMembership).mockResolvedValue(actor);
      vi.mocked(subject.repo.createSession).mockResolvedValue('session-21');
      return subject;
    }

    it('ranks a target by the most senior of its memberships in the institute', async () => {
      const { service, repo } = createSubject();
      arrangeStart(
        repo,
        [
          { id: 'tgt-mem', roleName: 'student', roleAbilities: [] },
          { id: 'tgt-mem-2', roleName: 'institute_admin', roleAbilities: MANAGE_ALL },
        ],
        institute({ resellerId: 'reseller-1', requireImpersonationConsent: false }),
      );
      vi.mocked(repo.findActiveActorMembership).mockResolvedValue(
        actorMembership('principal', IMPERSONATE),
      );

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects a token for a different institute than the target', async () => {
      const { service, repo } = arrange(
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
      ).rejects.toMatchObject({ code: ErrorCode.IMPERSONATION_TARGET_INVALID });
      // Refused before anything about the target is read.
      expect(repo.findActiveMembershipsWithRole).not.toHaveBeenCalled();
      expect(repo.findUserStatus).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects when the caller membership is no longer active', async () => {
      const { service, repo } = arrange('student', [], null);

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.findActiveActorMembership).toHaveBeenCalledWith({
        membershipId: 'imp-mem',
        userId: 'imp-1',
        tenantId: 'tenant-1',
      });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects a caller without the impersonate ability', async () => {
      const { service, abilityFactory, repo } = arrange(
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
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it.each<[string, AbilityRule[], string, AbilityRule[]]>([
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

    it.each<[string, AbilityRule[], string, AbilityRule[]]>([
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
      const { service, repo, redis } = arrange(
        targetRole,
        targetAbilities,
        actorMembership(actorRole, actorAbilities),
      );

      await expect(
        service.startImpersonation(instituteActor, 'tgt-1', 'tenant-1', REASON_VALID),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.createSession).not.toHaveBeenCalled();
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
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.incr).mockResolvedValue(1);

      await expect(service.verifyOtp(resellerActor, 'request-1', '999999')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_INVALID,
      });

      expect(redis.incr).toHaveBeenCalledWith(ATTEMPTS_KEY);
      expect(redis.expire).toHaveBeenCalledWith(ATTEMPTS_KEY, 300);
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.getdel).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
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
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.incr).mockResolvedValue(3);

      await expect(service.verifyOtp(resellerActor, 'request-1', '999999')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_ATTEMPTS_EXCEEDED,
      });
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('refuses even the correct OTP once the attempts are used up', async () => {
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      // A parallel guess already took the last attempt.
      vi.mocked(redis.incr).mockResolvedValue(4);

      await expect(service.verifyOtp(resellerActor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_ATTEMPTS_EXCEEDED,
      });
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
      expect(redis.getdel).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects when a parallel request consumed the OTP first', async () => {
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.getdel).mockResolvedValue(null);

      await expect(service.verifyOtp(resellerActor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_OTP_EXPIRED,
      });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it.each<[string, PlatformContext | ResellerContext, (repo: Repo) => void]>([
      ['the caller uses a token of another scope', platformActor, () => {}],
      [
        'the reseller membership was deactivated meanwhile',
        resellerActor,
        (repo) => vi.mocked(repo.hasActiveResellerMembership).mockResolvedValue(false),
      ],
      [
        'the institute moved to another reseller meanwhile',
        resellerActor,
        (repo) => {
          vi.mocked(repo.hasActiveResellerMembership).mockResolvedValue(true);
          vi.mocked(repo.isInstituteOfReseller).mockResolvedValue(false);
        },
      ],
    ])('opens no session with the right OTP when %s', async (_label, actor, arrangeRepo) => {
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.getdel).mockResolvedValue(JSON.stringify(pending));
      arrangeRepo(repo);

      await expect(service.verifyOtp(actor, 'request-1', '111111')).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('on match consumes the request, writes the verified session and returns an exchange code', async () => {
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(redis.getdel).mockResolvedValue(JSON.stringify(pending));
      vi.mocked(repo.hasActiveResellerMembership).mockResolvedValue(true);
      vi.mocked(repo.isInstituteOfReseller).mockResolvedValue(true);
      vi.mocked(repo.createSession).mockResolvedValue('session-31');

      const result = await service.verifyOtp(resellerActor, 'request-1', '111111');

      expect(result).toEqual({ code: FIXED_UUID });
      expect(repo.isInstituteOfReseller).toHaveBeenCalledWith(resellerActor, 'tenant-1');
      expect(redis.getdel).toHaveBeenCalledWith(KEY);
      expect(redis.del).toHaveBeenCalledWith(ATTEMPTS_KEY);
      // The attempt is reserved before the comparison.
      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.incr).toHaveBeenCalledWith(ATTEMPTS_KEY);
      const row = writtenSession(repo);
      expect(row).toEqual({
        impersonatorId: 'imp-1',
        impersonatorScope: 'reseller',
        targetUserId: 'tgt-1',
        targetTenantId: 'tenant-1',
        reason: REASON_VALID,
        ipAddress: '10.0.0.1',
        userAgent: 'vitest',
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        otpVerifiedAt: row.startedAt,
        otpVerifiedBy: 'admin-1',
      });
      expect(row.otpVerifiedAt).toBeInstanceOf(Date);
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
      id: 'tgt-1',
      username: 'student-jane',
      firstName: { en: 'Jane' },
      lastName: { en: 'Doe' },
    };
    const EXCHANGE_MEMBERSHIP = { id: 'mem-1', tenantId: 'tenant-1', roleId: 'role-student' };
    const EXCHANGE_INSTITUTE = {
      id: 'tenant-1',
      name: { en: 'Test Institute' },
      resellerId: 'reseller-1',
    };
    const liveSession = (
      overrides: Partial<NonNullable<ImpersonationExchangeRows['session']>> = {},
    ) => ({
      id: 'session-1',
      impersonatorId: 'imp-1',
      impersonatorScope: 'reseller',
      endedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    });

    function exchangeRows(
      overrides: Partial<ImpersonationExchangeRows> = {},
    ): ImpersonationExchangeRows {
      return {
        targetUser: EXCHANGE_USER,
        membership: EXCHANGE_MEMBERSHIP,
        session: liveSession(),
        institute: EXCHANGE_INSTITUTE,
        ...overrides,
      };
    }

    it('rejects when the code is not in Redis', async () => {
      const { service, redis } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(null);
      await expect(service.exchangeCode('missing-code', META)).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_CODE_EXPIRED,
      });
      expect(redis.getdel).toHaveBeenCalledWith(`${REDIS_KEYS.IMPERSONATION_CODE}missing-code`);
    });

    it('rejects when the target user is no longer ACTIVE', async () => {
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);

      await expect(service.exchangeCode('code-1', META)).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_INACTIVE,
      });
      expect(repo.findExchangeRows).toHaveBeenCalledWith({
        sessionId: 'session-1',
        targetUserId: 'tgt-1',
        targetMembershipId: 'mem-1',
        tenantId: 'tenant-1',
      });
    });

    it('rejects when the target lost their active membership', async () => {
      const { service, repo, redis } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(repo.findExchangeRows).mockResolvedValue(exchangeRows({ membership: null }));

      await expect(service.exchangeCode('code-1', META)).rejects.toMatchObject({
        code: ErrorCode.NO_ACTIVE_MEMBERSHIP,
      });
    });

    it.each([
      ['ended or revoked', { endedAt: new Date() }],
      ['past its expiry', { expiresAt: new Date(Date.now() - 1000) }],
    ])('issues no token when the session is %s', async (_label, overrides) => {
      const { service, repo, redis, jwt, authEventService } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(repo.findExchangeRows).mockResolvedValue(
        exchangeRows({ session: liveSession(overrides) }),
      );

      await expect(service.exchangeCode('code-1', META)).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_SESSION_INVALID,
      });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(authEventService.emit).not.toHaveBeenCalled();
    });

    it.each([
      ['a reseller support admin', 'reseller_support_admin'],
      ['a reseller viewer', 'reseller_viewer'],
      ['a reseller user whose membership is gone', null],
    ])('issues a view-only token to %s', async (_who, roleName) => {
      const { service, repo, redis, jwt } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      vi.mocked(repo.findExchangeRows).mockResolvedValue(exchangeRows());
      vi.mocked(repo.findResellerRoleName).mockResolvedValue(roleName);

      await service.exchangeCode('code-1', META);

      expect(repo.findResellerRoleName).toHaveBeenCalledWith('imp-1', 'reseller-1');
      expect(vi.mocked(jwt.sign).mock.calls[0][0]).toMatchObject({ impersonationReadOnly: true });
    });

    async function exchangeAsPlatform(abilities: AbilityRule[] | null) {
      const { service, repo, redis, jwt } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      vi.mocked(repo.findExchangeRows).mockResolvedValue(
        exchangeRows({ session: liveSession({ impersonatorScope: 'platform' }) }),
      );
      vi.mocked(repo.findPlatformRoleAbilities).mockResolvedValue(abilities);
      await service.exchangeCode('code-1', META);
      expect(repo.findPlatformRoleAbilities).toHaveBeenCalledWith('imp-1');
      return vi.mocked(jwt.sign).mock.calls[0][0];
    }

    it('issues a view-only token to platform support, whose role only reads', async () => {
      const claims = await exchangeAsPlatform([
        { action: 'read', subject: 'all' },
        { action: 'impersonate', subject: 'User' },
      ]);
      expect(claims).toMatchObject({ impersonationReadOnly: true });
    });

    it('issues a view-only token when the platform membership is gone', async () => {
      const claims = await exchangeAsPlatform(null);
      expect(claims).toMatchObject({ impersonationReadOnly: true });
    });

    it('lets a platform admin (manage all) write', async () => {
      const claims = await exchangeAsPlatform([{ action: 'manage', subject: 'all' }]);
      expect(claims).not.toHaveProperty('impersonationReadOnly');
    });

    it('never marks an institute-started session view-only', async () => {
      const { service, repo, redis, jwt } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      vi.mocked(repo.findExchangeRows).mockResolvedValue(
        exchangeRows({ session: liveSession({ impersonatorScope: 'institute' }) }),
      );

      await service.exchangeCode('code-1', META);

      expect(vi.mocked(jwt.sign).mock.calls[0][0]).not.toHaveProperty('impersonationReadOnly');
      expect(repo.findResellerRoleName).not.toHaveBeenCalled();
      expect(repo.findPlatformRoleAbilities).not.toHaveBeenCalled();
    });

    it('happy path returns a 15-minute token carrying the impersonation and reseller claims', async () => {
      const { service, repo, redis, jwt, authEventService } = createSubject();
      vi.mocked(redis.getdel).mockResolvedValue(CODE_PAYLOAD);
      vi.mocked(jwt.sign).mockReturnValue('fake-jwt');
      vi.mocked(repo.findExchangeRows).mockResolvedValue(exchangeRows());
      vi.mocked(repo.findResellerRoleName).mockResolvedValue('reseller_full_admin');

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
        type: 'IMPERSONATION_START',
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
      id: 'session-1',
      impersonatorId: 'imp-1',
      impersonatorScope: 'reseller',
      targetUserId: 'tgt-1',
      targetTenantId: 'tenant-1',
      endedAt: null,
      ...overrides,
    });
    const outsider = { userId: 'someone-else', membershipId: 'other-mem', roleId: 'other-role' };

    function withAbility(abilityFactory: AbilityFactory, allowed: boolean) {
      vi.mocked(abilityFactory.createForUser).mockResolvedValue(
        createMock<AppAbility>({ can: vi.fn(() => allowed) }),
      );
    }

    function subjectWithSession(overrides: Record<string, unknown> = {}) {
      const subject = createSubject();
      vi.mocked(subject.repo.findSessionForEnd).mockResolvedValue(session(overrides));
      return subject;
    }

    /** The reason the one close was written with. */
    function endedReason(repo: Repo): string {
      expect(repo.endSession).toHaveBeenCalledTimes(1);
      const [sessionId, endedAt, reason] = vi.mocked(repo.endSession).mock.calls[0];
      expect(sessionId).toBe('session-1');
      expect(endedAt).toBeInstanceOf(Date);
      return reason;
    }

    it('rejects when the session is not found', async () => {
      const { service, repo } = createSubject();
      await expect(
        service.endImpersonation('session-1', platformActor, META),
      ).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_SESSION_INVALID,
      });
      expect(repo.findSessionForEnd).toHaveBeenCalledWith('session-1');
    });

    it('rejects when the session is already ended', async () => {
      const { service, repo } = subjectWithSession({ endedAt: new Date() });
      await expect(
        service.endImpersonation('session-1', platformActor, META),
      ).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_SESSION_INVALID,
      });
      expect(repo.endSession).not.toHaveBeenCalled();
    });

    it('impersonator ends its own session as manual, clears the cache and emits impersonation_end', async () => {
      const { service, repo, redis, authEventService, abilityFactory } = subjectWithSession();

      await service.endImpersonation('session-1', resellerActor, META);

      expect(endedReason(repo)).toBe('manual');
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
        type: 'IMPERSONATION_END',
        scope: 'reseller',
        tenantId: 'tenant-1',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
        metadata: { session_id: 'session-1', ended_reason: 'manual' },
      });
    });

    it('the impersonated user ends the session from the impersonation token as manual', async () => {
      const { service, repo } = subjectWithSession();

      await service.endImpersonation(
        'session-1',
        impersonated({ ...instituteActor, userId: 'tgt-1' }),
        META,
      );

      expect(endedReason(repo)).toBe('manual');
    });

    it('an impersonation token cannot end a session it is not part of', async () => {
      const { service, repo, abilityFactory } = subjectWithSession();

      await expect(
        service.endImpersonation(
          'session-1',
          impersonated({ ...instituteActor, ...outsider }),
          META,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(abilityFactory.createForUser).not.toHaveBeenCalled();
      expect(repo.endSession).not.toHaveBeenCalled();
    });

    it('a platform user with the impersonate ability revokes any session', async () => {
      const { service, repo, abilityFactory, authEventService } = subjectWithSession();
      withAbility(abilityFactory, true);

      await service.endImpersonation('session-1', { ...platformActor, ...outsider }, META);

      expect(endedReason(repo)).toBe('revoked');
      await Promise.resolve();
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'someone-else',
        type: 'IMPERSONATION_END',
        scope: 'platform',
        tenantId: 'tenant-1',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
        metadata: { session_id: 'session-1', ended_reason: 'revoked' },
      });
    });

    it('a third party without the impersonate ability is refused', async () => {
      const { service, repo, abilityFactory } = subjectWithSession();
      withAbility(abilityFactory, false);

      await expect(
        service.endImpersonation('session-1', { ...platformActor, ...outsider }, META),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.endSession).not.toHaveBeenCalled();
    });

    it('a reseller user revokes a session started by a teammate', async () => {
      const { service, repo, abilityFactory } = subjectWithSession();
      withAbility(abilityFactory, true);
      vi.mocked(repo.hasActiveResellerMembershipOf).mockResolvedValue(true);

      await service.endImpersonation('session-1', { ...resellerActor, ...outsider }, META);

      expect(repo.hasActiveResellerMembershipOf).toHaveBeenCalledWith('imp-1', 'reseller-1');
      expect(endedReason(repo)).toBe('revoked');
    });

    it('a reseller user cannot revoke a session started outside their team', async () => {
      const { service, repo, abilityFactory } = subjectWithSession();
      withAbility(abilityFactory, true);

      await expect(
        service.endImpersonation('session-1', { ...resellerActor, ...outsider }, META),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.endSession).not.toHaveBeenCalled();
    });

    it('a reseller user cannot revoke a platform-started session', async () => {
      const { service, repo, abilityFactory } = subjectWithSession({
        impersonatorScope: 'platform',
      });
      withAbility(abilityFactory, true);

      await expect(
        service.endImpersonation('session-1', { ...resellerActor, ...outsider }, META),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.endSession).not.toHaveBeenCalled();
    });

    it('an institute admin revokes a session into their own institute', async () => {
      const { service, repo, abilityFactory } = subjectWithSession();
      withAbility(abilityFactory, true);

      await service.endImpersonation('session-1', { ...instituteActor, ...outsider }, META);

      expect(endedReason(repo)).toBe('revoked');
    });

    it('an institute admin cannot revoke a session into another institute', async () => {
      const { service, repo, abilityFactory } = subjectWithSession({
        targetTenantId: 'tenant-other',
      });
      withAbility(abilityFactory, true);

      await expect(
        service.endImpersonation('session-1', { ...instituteActor, ...outsider }, META),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.endSession).not.toHaveBeenCalled();
    });
  });

  describe('expireOverdueSessions', () => {
    it('closes overdue sessions as expired and records impersonation_end for each', async () => {
      const { service, repo, authEventService } = createSubject();
      vi.mocked(repo.expireOverdueSessions).mockResolvedValue([
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
      ]);

      const count = await service.expireOverdueSessions();

      expect(count).toBe(2);
      expect(repo.expireOverdueSessions).toHaveBeenCalledTimes(1);
      expect(authEventService.emit).toHaveBeenCalledTimes(2);
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'imp-1',
        type: 'IMPERSONATION_END',
        scope: 'reseller',
        tenantId: 'tenant-1',
        metadata: { session_id: 'session-1', ended_reason: 'expired' },
      });
      expect(authEventService.emit).toHaveBeenCalledWith({
        userId: 'imp-2',
        type: 'IMPERSONATION_END',
        scope: 'platform',
        tenantId: undefined,
        metadata: { session_id: 'session-2', ended_reason: 'expired' },
      });
    });

    it('records nothing when no session is overdue', async () => {
      const { service, authEventService } = createSubject();

      expect(await service.expireOverdueSessions()).toBe(0);
      expect(authEventService.emit).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    const baseRow = (
      overrides: Partial<ImpersonationSessionListRow> = {},
    ): ImpersonationSessionListRow => ({
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
      otpVerifiedAt: null,
      otpVerifiedByName: null,
      ...overrides,
    });

    function listing(rows: ImpersonationSessionListRow[], roles = emptyRoles()) {
      const subject = createSubject();
      vi.mocked(subject.repo.listSessions).mockResolvedValue({ rows, roles });
      return subject;
    }

    it('derives ACTIVE / ENDED / EXPIRED status from endedAt and expiresAt', async () => {
      const { service } = listing([
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
      ]);

      const result = await service.listSessions({ limit: 50 });

      expect(result.map((s) => [s.id, s.status])).toEqual([
        ['active', ImpersonationSessionStatus.ACTIVE],
        ['ended', ImpersonationSessionStatus.ENDED],
        ['expired', ImpersonationSessionStatus.EXPIRED],
        ['swept', ImpersonationSessionStatus.EXPIRED],
      ]);
    });

    it('passes through resolved display fields and normalises a null institute name', async () => {
      const { service } = listing([baseRow({ targetTenantName: null })]);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorName).toBe('Admin User');
      expect(session.targetUserName).toBe('Teacher One');
      expect(session.reason).toBe(REASON_VALID);
      expect(session.targetTenantName).toBeNull();
    });

    it('reseller scope with no team members returns []', async () => {
      const { service, repo } = listing([]);

      const result = await service.listSessions({ resellerId: 'reseller-1', limit: 50 });

      expect(result).toEqual([]);
      expect(repo.listSessions).toHaveBeenCalledWith({ resellerId: 'reseller-1', limit: 50 });
    });

    it('reseller scope returns sessions started by the reseller team', async () => {
      const { service, repo } = listing([baseRow({ impersonatorScope: 'reseller' })]);

      const result = await service.listSessions({ resellerId: 'reseller-1', limit: 50 });

      expect(result).toHaveLength(1);
      expect(result[0].impersonatorScope).toBe('reseller');
      expect(repo.listSessions).toHaveBeenCalledWith({ resellerId: 'reseller-1', limit: 50 });
    });

    it('resolves a platform impersonator role from platform_memberships', async () => {
      const roles = emptyRoles();
      roles.platform.set('imp-1', { en: 'Platform Admin' });
      const { service } = listing([baseRow({ impersonatorScope: 'platform' })], roles);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorRole).toEqual({ en: 'Platform Admin' });
    });

    it('resolves an institute impersonator role keyed by (user, target tenant)', async () => {
      const roles = emptyRoles();
      roles.institute.set('imp-1:tenant-1', { en: 'Principal' });
      const { service } = listing(
        [baseRow({ impersonatorScope: 'institute', targetTenantId: 'tenant-1' })],
        roles,
      );

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorRole).toEqual({ en: 'Principal' });
    });

    it('returns a null impersonator role when no matching membership exists', async () => {
      const { service } = listing([baseRow({ impersonatorScope: 'platform' })]);

      const [session] = await service.listSessions({ limit: 50 });

      expect(session.impersonatorRole).toBeNull();
    });
  });
});
