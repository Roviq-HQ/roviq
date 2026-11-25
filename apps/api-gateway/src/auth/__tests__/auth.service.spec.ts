import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import { AbilityFactory } from '@roviq/casl';
import type { AuthScope, InstituteContext } from '@roviq/common-types';
import { ErrorCode, NEW_PASSWORD_MIN_LENGTH, ResellerStatus } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectBusinessError } from '../../__tests__/expect-business-error';
import { AuthService } from '../auth.service';
import { AuthEventService } from '../auth-event.service';
import { LoginLockoutService } from '../login-lockout.service';
import { MembershipRepository } from '../repositories/membership.repository';
import { PlatformMembershipRepository } from '../repositories/platform-membership.repository';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { ResellerMembershipRepository } from '../repositories/reseller-membership.repository';
import type {
  MembershipWithInstituteAndRole,
  RefreshTokenWithRelations,
  ResellerMembershipWithResellerAndRole,
  UserRecord,
} from '../repositories/types';
import { UserRepository } from '../repositories/user.repository';

function createMockUserRepo() {
  return createMock<UserRepository>({
    findById: vi.fn(),
    findByUsername: vi.fn(),
    updatePasswordHash: vi.fn(),
    updatePassword: vi.fn(),
  });
}

function createMockLockoutService() {
  return createMock<LoginLockoutService>({
    isLocked: vi.fn().mockResolvedValue(false),
    recordFailure: vi.fn().mockResolvedValue({ locked: false, remainingAttempts: 4 }),
    clearOnSuccess: vi.fn().mockResolvedValue(undefined),
  });
}

function createMockMembershipRepo() {
  return createMock<MembershipRepository>({
    findActiveByUserId: vi.fn(),
    hasMembershipInUnusableInstitute: vi.fn(),
    findManyByUserAndTenant: vi.fn(),
    findByIdAndUser: vi.fn(),
  });
}

function createMockPlatformMembershipRepo() {
  return createMock<PlatformMembershipRepository>({
    findByUserId: vi.fn(),
  });
}

function createMockResellerMembershipRepo() {
  return createMock<ResellerMembershipRepository>({
    findByUserId: vi.fn(),
    findByUserAndReseller: vi.fn(),
  });
}

function createMockRefreshTokenRepo() {
  return createMock<RefreshTokenRepository>({
    create: vi.fn(),
    findByIdWithRelations: vi.fn(),
    findByHash: vi.fn(),
    findActiveByUserId: vi.fn(),
    hasMembershipInUnusableInstitute: vi.fn(),
    revoke: vi.fn(),
    revokeAllForUser: vi.fn(),
    revokeAllOtherForUser: vi.fn(),
  });
}

function createMockJwtService() {
  return createMock<JwtService>({
    sign: vi.fn().mockReturnValue('mock-token'),
    verify: vi.fn(),
  });
}

function createMockAuthEventService() {
  return createMock<AuthEventService>({
    emit: vi.fn().mockResolvedValue(undefined),
  });
}

function createMockConfigService() {
  const envs: Record<string, string> = {
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
  };
  return createMock<ConfigService>({
    get: vi.fn((key: string) => envs[key]),
    getOrThrow: vi.fn((key: string) => {
      const val = envs[key];
      if (!val) throw new Error(`${key} not set`);
      return val;
    }),
  });
}

const REFRESH_TOKEN = 'mock-token';
const RESELLER_ID = '00000000-0000-7000-a000-000000000011';

function activeUser(): UserRecord {
  return {
    id: 'user-1',
    username: 'admin',
    email: 'admin@test.com',
    passwordHash: 'mock-hash',
    status: 'ACTIVE',
    passwordChangedAt: null,
    mustChangePassword: false,
    emailVerifiedAt: null,
    tokenVersion: 0,
  };
}

function activeMembership(
  overrides: Partial<MembershipWithInstituteAndRole> = {},
): MembershipWithInstituteAndRole {
  return {
    id: 'membership-1',
    tenantId: 'tenant-1',
    roleId: 'role-1',
    status: 'ACTIVE',
    abilities: null,
    role: { id: 'role-1', name: { en: 'Admin' }, abilities: [] },
    institute: {
      id: 'tenant-1',
      name: { en: 'Test Institute' },
      slug: 'test-institute',
      logoUrl: null,
      resellerId: RESELLER_ID,
    },
    ...overrides,
  };
}

function storedRefreshToken(membershipScope: AuthScope): RefreshTokenWithRelations {
  return {
    id: 'token-id-1',
    tokenHash: createHash('sha256').update(REFRESH_TOKEN).digest('hex'),
    userId: 'user-1',
    membershipScope,
    revokedAt: null,
    revokedReason: null,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-11-16T00:00:00.000Z'),
    deviceInfo: null,
    ipAddress: null,
    userAgent: null,
    lastUsedAt: null,
    user: {
      id: 'user-1',
      username: 'admin',
      email: 'admin@test.com',
      status: 'ACTIVE',
      passwordChangedAt: null,
      mustChangePassword: false,
      emailVerifiedAt: null,
      tokenVersion: 0,
    },
    membership: null,
  };
}

function resellerMembership(
  id: string,
  resellerId: string,
  status: ResellerStatus = ResellerStatus.ACTIVE,
): ResellerMembershipWithResellerAndRole {
  return {
    id,
    userId: 'user-1',
    resellerId,
    roleId: 'role-1',
    isActive: true,
    abilities: null,
    reseller: { id: resellerId, name: 'Reseller', slug: 'reseller', isActive: true, status },
    role: { id: 'role-1', abilities: [] },
  };
}

const instituteCaller: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  userId: 'user-1',
  membershipId: 'membership-1',
  roleId: 'role-1',
  type: 'access',
  tenantId: 'tenant-1',
};

describe('AuthService', () => {
  let authService: AuthService;
  let mockUserRepo: ReturnType<typeof createMockUserRepo>;
  let mockMembershipRepo: ReturnType<typeof createMockMembershipRepo>;
  let mockPlatformMembershipRepo: ReturnType<typeof createMockPlatformMembershipRepo>;
  let mockResellerMembershipRepo: ReturnType<typeof createMockResellerMembershipRepo>;
  let mockRefreshTokenRepo: ReturnType<typeof createMockRefreshTokenRepo>;
  let mockJwt: ReturnType<typeof createMockJwtService>;
  let mockConfig: ReturnType<typeof createMockConfigService>;
  let mockAuthEventService: ReturnType<typeof createMockAuthEventService>;
  let mockLockout: ReturnType<typeof createMockLockoutService>;
  let mockEventBus: EventBusService;
  let mockRedis: Redis;

  beforeEach(() => {
    mockUserRepo = createMockUserRepo();
    mockMembershipRepo = createMockMembershipRepo();
    mockPlatformMembershipRepo = createMockPlatformMembershipRepo();
    mockResellerMembershipRepo = createMockResellerMembershipRepo();
    mockRefreshTokenRepo = createMockRefreshTokenRepo();
    mockJwt = createMockJwtService();
    mockConfig = createMockConfigService();
    mockAuthEventService = createMockAuthEventService();
    mockLockout = createMockLockoutService();

    const mockAbilityFactory = createMock<AbilityFactory>({
      createForUser: vi.fn().mockResolvedValue({ rules: [] }),
    });
    mockEventBus = createMock<EventBusService>({ emit: vi.fn() });
    mockRedis = createMock<Redis>({ set: vi.fn(() => Promise.resolve('OK')) });

    authService = new AuthService(
      mockConfig,
      mockJwt,
      mockUserRepo,
      mockMembershipRepo,
      mockPlatformMembershipRepo,
      mockResellerMembershipRepo,
      mockRefreshTokenRepo,
      mockAuthEventService,
      mockAbilityFactory,
      mockLockout,
      mockEventBus,
      mockRedis,
    );
  });

  describe('account language', () => {
    it('should read the authenticated account preference', async () => {
      mockUserRepo.getPreferredLocale.mockResolvedValue('hi');
      expect(await authService.getPreferredLocale('user-1')).toBe('hi');
      expect(mockUserRepo.getPreferredLocale).toHaveBeenCalledWith('user-1');
    });

    it.each([
      'en',
      'hi',
      null,
    ])('should save %s without changing identity fields', async (locale) => {
      expect(await authService.updatePreferredLocale('user-1', locale)).toBe(locale);
      expect(mockUserRepo.updatePreferredLocale).toHaveBeenCalledWith('user-1', locale);
    });
  });

  describe('instituteLogin', () => {
    const mockUser = {
      id: 'user-1',
      username: 'admin',
      email: 'admin@test.com',
      passwordHash: '',
      status: 'ACTIVE' as const,
      passwordChangedAt: null,
      mustChangePassword: false,
      emailVerifiedAt: null,
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockMembership = {
      id: 'membership-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      roleId: 'role-1',
      abilities: null,
      status: 'ACTIVE' as const,
      institute: {
        id: 'tenant-1',
        name: { en: 'Test Institute' },
        slug: 'test-institute',
        logoUrl: null,
        resellerId: '00000000-0000-7000-a000-000000000011',
      },
      role: { id: 'role-1', name: { en: 'Admin' }, abilities: [] },
    };

    beforeEach(async () => {
      mockUser.passwordHash = await hash('correct-password');
    });

    it('should return tenant-scoped JWT when user has single membership', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([mockMembership]);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);
      mockJwt.sign.mockReturnValue('jwt-token');

      const result = await authService.instituteLogin('admin', 'correct-password');

      expect(result.accessToken).toBe('jwt-token');
      expect(result.refreshToken).toBe('jwt-token');
      expect(result.user?.id).toBe('user-1');
      expect(result.user?.username).toBe('admin');
      expect(result.user?.tenantId).toBe('tenant-1');
      expect(result.requiresInstituteSelection).toBeUndefined();
    });

    it('signs the access token with resellerId in the payload (ROV-261)', async () => {
      // The access token MUST carry `resellerId` so EE billing operations
      // gated by `assertInstituteWithReseller` succeed for institute users.
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([mockMembership]);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);
      mockJwt.sign.mockReturnValue('jwt-token');

      await authService.instituteLogin('admin', 'correct-password');

      // issueTokens signs access then refresh — locking call ordering so a
      // future refactor that swaps them doesn't silently invalidate the
      // [0] index used below.
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
      const [accessPayload] = mockJwt.sign.mock.calls[0];
      expect(accessPayload).toMatchObject({
        scope: 'institute',
        tenantId: 'tenant-1',
        resellerId: '00000000-0000-7000-a000-000000000011',
      });
    });

    it('should return membership list when user has multiple memberships', async () => {
      const secondMembership = {
        ...mockMembership,
        id: 'membership-2',
        tenantId: 'tenant-2',
        institute: {
          id: 'tenant-2',
          name: { en: 'Other Institute' },
          slug: 'other-institute',
          logoUrl: null,
          resellerId: '00000000-0000-7000-a000-000000000011',
        },
        role: { id: 'role-2', name: { en: 'Teacher' }, abilities: [] },
      };

      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([mockMembership, secondMembership]);
      mockJwt.sign.mockReturnValue('mock-selection-token');

      const result = await authService.instituteLogin('admin', 'correct-password');

      expect(result.requiresInstituteSelection).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.selectionToken).toBe('mock-selection-token');
      expect(result.memberships).toHaveLength(2);
      expect(result.memberships?.[0]?.instituteName).toEqual({ en: 'Test Institute' });
      expect(result.memberships?.[1]?.instituteName).toEqual({ en: 'Other Institute' });
      expect(result.accessToken).toBeUndefined();
    });

    it('should reject invalid password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);

      await expectBusinessError(
        authService.instituteLogin('admin', 'wrong-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
    });

    it('should reject inactive user', async () => {
      mockUserRepo.findByUsername.mockResolvedValue({ ...mockUser, status: 'SUSPENDED' as const });

      await expectBusinessError(
        authService.instituteLogin('admin', 'correct-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
    });

    it('should reject a non-existent user with INVALID_CREDENTIALS', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(null);

      await expectBusinessError(
        authService.instituteLogin('nonexistent', 'password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
    });

    it('should say the institute is not active when every institute of the user is unusable', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([]);
      mockMembershipRepo.hasMembershipInUnusableInstitute.mockResolvedValue(true);

      const failure = await expectBusinessError(
        authService.instituteLogin('admin', 'correct-password', { ip: '10.0.0.1' }),
        ErrorCode.INSTITUTE_NOT_ACTIVE,
      );
      expect(failure.message).toBe('Your institute is not active');
      expect(mockMembershipRepo.hasMembershipInUnusableInstitute).toHaveBeenCalledWith('user-1');
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'login_failed',
        portal: 'institute',
        authMethod: 'password',
        failureReason: 'NO_PORTAL_ACCESS',
        ip: '10.0.0.1',
        userAgent: undefined,
        deviceInfo: undefined,
        metadata: undefined,
      });
    });

    it('should answer a correct password with no institute membership like a wrong password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([]);
      mockMembershipRepo.hasMembershipInUnusableInstitute.mockResolvedValue(false);

      const failure = await expectBusinessError(
        authService.instituteLogin('admin', 'correct-password', { ip: '10.0.0.1' }),
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(failure.message).toBe('Invalid credentials');
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'login_failed',
        portal: 'institute',
        authMethod: 'password',
        failureReason: 'NO_PORTAL_ACCESS',
        ip: '10.0.0.1',
        userAgent: undefined,
        deviceInfo: undefined,
        metadata: undefined,
      });
    });

    it('should use the same error message for user-not-found and wrong-password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(null);
      const err1 = await authService.instituteLogin('admin', 'pass').catch((e: Error) => e);

      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      const err2 = await authService.instituteLogin('admin', 'wrong').catch((e: Error) => e);

      expect((err1 as Error).message).toBe((err2 as Error).message);
    });

    it('should find user by username', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(null);

      await authService.instituteLogin('admin', 'pass').catch(() => {});

      expect(mockUserRepo.findByUsername).toHaveBeenCalledWith('admin');
    });

    it('should store refresh token in DB with membershipId and membershipScope', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([mockMembership]);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);

      await authService.instituteLogin('admin', 'correct-password');

      expect(mockRefreshTokenRepo.create).toHaveBeenCalledTimes(1);
      const createCall = mockRefreshTokenRepo.create.mock.calls[0][0];
      expect(createCall.tokenHash).toBeDefined();
      expect(createCall.tokenHash.length).toBe(64);
      expect(createCall.userId).toBe('user-1');
      expect(createCall.tenantId).toBe('tenant-1');
      expect(createCall.membershipId).toBe('membership-1');
      expect(createCall.membershipScope).toBe('institute');
    });
  });

  describe('adminLogin', () => {
    const mockUser = {
      id: 'user-1',
      username: 'platformadmin',
      email: 'admin@platform.com',
      passwordHash: '',
      status: 'ACTIVE' as const,
      passwordChangedAt: null,
      mustChangePassword: false,
      emailVerifiedAt: null,
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockPlatformMembership = {
      id: 'pm-1',
      userId: 'user-1',
      roleId: 'platform-role-1',
      isActive: true,
      abilities: null,
      role: { id: 'platform-role-1', name: 'PlatformAdmin', abilities: [] },
    };

    beforeEach(async () => {
      mockUser.passwordHash = await hash('correct-password');
    });

    it('should return platform-scoped JWT for valid platform admin', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockPlatformMembershipRepo.findByUserId.mockResolvedValue(mockPlatformMembership);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);
      mockJwt.sign.mockReturnValue('platform-jwt');

      const result = await authService.adminLogin('platformadmin', 'correct-password');

      expect(result.accessToken).toBe('platform-jwt');
      expect(result.refreshToken).toBe('platform-jwt');
      expect(result.user?.id).toBe('user-1');
      expect(result.user?.scope).toBe('platform');
    });

    it('should answer a correct password with no platform membership like a wrong password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockPlatformMembershipRepo.findByUserId.mockResolvedValue(null);

      const failure = await expectBusinessError(
        authService.adminLogin('platformadmin', 'correct-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(failure.message).toBe('Invalid credentials');
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should answer an inactive platform membership like a wrong password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockPlatformMembershipRepo.findByUserId.mockResolvedValue({
        ...mockPlatformMembership,
        isActive: false,
      });

      const failure = await expectBusinessError(
        authService.adminLogin('platformadmin', 'correct-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(failure.message).toBe('Invalid credentials');
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should answer a reseller login with no reseller membership like a wrong password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockResellerMembershipRepo.findByUserId.mockResolvedValue([]);

      const failure = await expectBusinessError(
        authService.resellerLogin('platformadmin', 'correct-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(failure.message).toBe('Invalid credentials');
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should answer a reseller login for a suspended reseller like a wrong password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockResellerMembershipRepo.findByUserId.mockResolvedValue([
        resellerMembership('reseller-membership-1', 'reseller-1', ResellerStatus.SUSPENDED),
      ]);

      const failure = await expectBusinessError(
        authService.resellerLogin('platformadmin', 'correct-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(failure.message).toBe('Invalid credentials');
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should reject invalid password', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);

      await expectBusinessError(
        authService.adminLogin('platformadmin', 'wrong-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );
    });
  });

  describe('instituteLoginByUserId', () => {
    const mockUser = {
      id: 'user-1',
      username: 'admin',
      email: 'admin@test.com',
      passwordHash: '',
      status: 'ACTIVE' as const,
      passwordChangedAt: null,
      mustChangePassword: false,
      emailVerifiedAt: null,
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockMembership = {
      id: 'membership-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      roleId: 'role-1',
      abilities: null,
      status: 'ACTIVE' as const,
      institute: {
        id: 'tenant-1',
        name: { en: 'Test Institute' },
        slug: 'test-institute',
        logoUrl: null,
        resellerId: '00000000-0000-7000-a000-000000000011',
      },
      role: { id: 'role-1', name: { en: 'Admin' }, abilities: [] },
    };

    it('should return tenant-scoped JWT for single membership without password', async () => {
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([mockMembership]);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);
      mockJwt.sign.mockReturnValue('jwt-token');

      const result = await authService.instituteLoginByUserId('user-1', {
        ip: '10.0.0.1',
        userAgent: 'vitest',
      });

      expect(result.accessToken).toBe('jwt-token');
      expect(result.user?.tenantId).toBe('tenant-1');
      expect(result.requiresInstituteSelection).toBeUndefined();
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'login_success',
        portal: 'institute',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        authMethod: 'passkey',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: undefined,
      });
      // Same new-login notification a password sign-in sends.
      expect(mockEventBus.emit).toHaveBeenCalledWith('NOTIFICATION.auth.security', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        eventType: 'LOGIN',
        metadata: { ip: '10.0.0.1', userAgent: 'vitest' },
        scope: 'institute',
        resellerId: null,
      });
    });

    it('should return membership list for multi-institute user', async () => {
      const secondMembership = {
        ...mockMembership,
        id: 'membership-2',
        tenantId: 'tenant-2',
        institute: {
          id: 'tenant-2',
          name: { en: 'Other Institute' },
          slug: 'other-institute',
          logoUrl: null,
          resellerId: '00000000-0000-7000-a000-000000000011',
        },
        role: { id: 'role-2', name: { en: 'Teacher' }, abilities: [] },
      };

      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([mockMembership, secondMembership]);
      mockJwt.sign.mockReturnValue('mock-selection-token');

      const result = await authService.instituteLoginByUserId('user-1');

      expect(result.requiresInstituteSelection).toBe(true);
      expect(result.selectionToken).toBe('mock-selection-token');
      expect(result.memberships).toHaveLength(2);
    });

    it('should reject with INVALID_CREDENTIALS when user not found', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expectBusinessError(
        authService.instituteLoginByUserId('nonexistent', { ip: '10.0.0.1' }),
        ErrorCode.INVALID_CREDENTIALS,
      );
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: undefined,
        type: 'login_failed',
        portal: 'institute',
        authMethod: 'passkey',
        failureReason: 'ACCOUNT_INACTIVE',
        ip: '10.0.0.1',
        userAgent: undefined,
        deviceInfo: undefined,
        metadata: undefined,
      });
    });

    it('should say the institute is not active on a passkey login into an unusable institute', async () => {
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([]);
      mockMembershipRepo.hasMembershipInUnusableInstitute.mockResolvedValue(true);

      await expectBusinessError(
        authService.instituteLoginByUserId('user-1'),
        ErrorCode.INSTITUTE_NOT_ACTIVE,
      );
    });

    it('should throw when user has no active memberships', async () => {
      mockUserRepo.findById.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([]);
      mockMembershipRepo.hasMembershipInUnusableInstitute.mockResolvedValue(false);

      const failure = await expectBusinessError(
        authService.instituteLoginByUserId('user-1'),
        ErrorCode.ACCOUNT_NOT_FOUND,
      );
      expect(failure.message).toBe('No account found');
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const passwordHash = await hash('correct-password');
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash,
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      });

      const result = await authService.verifyPassword('user-1', 'correct-password');
      expect(result).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const passwordHash = await hash('correct-password');
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash,
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      });

      const result = await authService.verifyPassword('user-1', 'wrong-password');
      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      const result = await authService.verifyPassword('missing', 'password');
      expect(result).toBe(false);
    });
  });

  describe('selectInstitute', () => {
    beforeEach(() => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        purpose: 'institute-selection',
        authMethod: 'passkey',
      });
    });

    it('should issue tenant-scoped JWT for valid membership', async () => {
      const membership = {
        id: 'membership-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        roleId: 'role-1',
        abilities: null,
        status: 'ACTIVE' as const,
        institute: {
          id: 'tenant-1',
          name: { en: 'Test Institute' },
          slug: 'test-institute',
          logoUrl: null,
          resellerId: '00000000-0000-7000-a000-000000000011',
        },
        role: { id: 'role-1', name: { en: 'Admin' }, abilities: [] },
      };
      const user = {
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: 'mock-hash',
        status: 'ACTIVE' as const,
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      };

      mockMembershipRepo.findByIdAndUser.mockResolvedValue(membership);
      mockUserRepo.findById.mockResolvedValue(user);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);
      mockJwt.sign.mockReturnValue('access-jwt');

      const result = await authService.selectInstitute('mock-selection-token', 'membership-1', {
        ip: '10.0.0.1',
        userAgent: 'vitest',
      });

      expect(result.accessToken).toBe('access-jwt');
      expect(result.user?.tenantId).toBe('tenant-1');
      expect(result.user?.roleId).toBe('role-1');
      // The method that opened the selection, not a hardcoded 'password'.
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'login_success',
        portal: 'institute',
        scope: 'institute',
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        authMethod: 'passkey',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: undefined,
      });
    });

    it('should reject if no active membership found', async () => {
      mockMembershipRepo.findByIdAndUser.mockResolvedValue(null);

      await expectBusinessError(
        authService.selectInstitute('mock-selection-token', 'membership-999'),
        ErrorCode.NO_ACTIVE_MEMBERSHIP,
      );
    });

    it('should reject inactive membership', async () => {
      mockMembershipRepo.findByIdAndUser.mockResolvedValue({
        id: 'membership-1',
        tenantId: 'tenant-1',
        roleId: 'role-1',
        abilities: null,
        status: 'SUSPENDED',
        institute: {
          id: 'tenant-1',
          name: { en: 'Test Institute' },
          slug: 'test-institute',
          logoUrl: null,
          resellerId: '00000000-0000-7000-a000-000000000011',
        },
        role: { id: 'role-1', name: { en: 'Admin' }, abilities: [] },
      });

      await expectBusinessError(
        authService.selectInstitute('mock-selection-token', 'membership-1'),
        ErrorCode.NO_ACTIVE_MEMBERSHIP,
      );
    });

    it('should reject invalid selection token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      const failure = await expectBusinessError(
        authService.selectInstitute('bad-token', 'membership-1'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Invalid or expired selection token');
    });

    it('should reject token with wrong purpose', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', purpose: 'other' });

      const failure = await expectBusinessError(
        authService.selectInstitute('wrong-purpose-token', 'membership-1'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Invalid or expired selection token');
    });
  });

  describe('refreshToken', () => {
    it('should issue new tokens on valid refresh', async () => {
      const tokenId = 'token-id-1';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const fakeToken = 'mock-token';
      const expectedHash = createHash('sha256').update(fakeToken).digest('hex');
      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash: expectedHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: null,
        revokedReason: null,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'admin@test.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: {
          id: 'membership-1',
          tenantId: 'tenant-1',
          roleId: 'role-1',
          abilities: null,
          role: { id: 'role-1', abilities: [] },
          institute: {
            id: 'tenant-1',
            name: { en: 'Test Institute' },
            slug: 'test-institute',
            resellerId: '00000000-0000-7000-a000-000000000011',
          },
        },
      });

      mockMembershipRepo.findByIdAndUser.mockResolvedValue(activeMembership());
      mockRefreshTokenRepo.revoke.mockResolvedValue(undefined);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);
      mockJwt.sign.mockReturnValue('new-jwt');
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: 'mock-hash',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      });

      const result = await authService.refreshToken(fakeToken, {
        ip: '10.0.0.1',
        userAgent: 'vitest',
      });

      expect(result.accessToken).toBe('new-jwt');
      expect(result.user?.id).toBe('user-1');
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'token_refresh',
        scope: 'institute',
        tenantId: 'tenant-1',
        resellerId: undefined,
        membershipId: 'membership-1',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: undefined,
      });
      // Every successful refresh rotates — old token gets tagged `rotation`
      // so any subsequent use triggers the reuse-cascade.
      expect(mockRefreshTokenRepo.revoke).toHaveBeenCalledWith(tokenId, 'rotation');
    });

    it('should throw on invalid JWT', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expectBusinessError(authService.refreshToken('bad-token'), ErrorCode.SESSION_EXPIRED);
    });

    it('should throw when token type is not refresh', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', type: 'access' });

      const failure = await expectBusinessError(
        authService.refreshToken('access-token'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Invalid token type');
    });

    it('should revoke all tokens on reuse detection', async () => {
      const tokenId = 'token-reused';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update('mock-token').digest('hex');

      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: new Date(),
        // `rotation` (or null) triggers the family-kill cascade — the
        // attacker-replayed-after-rotation scenario this test guards.
        revokedReason: 'rotation',
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'a@b.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('mock-token', { ip: '10.0.0.1', userAgent: 'vitest' }),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Refresh token reuse detected');

      expect(mockRefreshTokenRepo.revokeAllForUser).toHaveBeenCalledWith('user-1', 'rotation');
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'all_sessions_revoked',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: undefined,
        metadata: { reason: 'token_reuse' },
      });
    });

    it('does NOT cascade-revoke when the token was revoked via user-initiated action', async () => {
      // Regression guard for #20 (revokeAllOtherSessions). Previously, any
      // revoked refresh token tripped the reuse-cascade and killed the
      // caller's own keep-alive session on the next refresh attempt.
      const tokenId = 'token-user-revoked';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update('stale-but-legit').digest('hex');

      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: new Date(),
        revokedReason: 'user_initiated',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'a@b.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('stale-but-legit'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Refresh token revoked');
      // Critical assertion: NO family kill.
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('does NOT cascade-revoke when revoked via password_change', async () => {
      // Password-change revocation is a deliberate, user-scoped action. The
      // old token showing up afterwards is a stale client, not an attacker —
      // must not fire the family-kill cascade.
      const tokenId = 'token-password-change';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update('stale-but-legit').digest('hex');

      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: new Date(),
        revokedReason: 'password_change',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'a@b.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('stale-but-legit'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toMatch(/revoked/i);
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('does NOT cascade-revoke when revoked via admin_revoked', async () => {
      // Admin-initiated revocation is a deliberate, operator-scoped action.
      // Same reasoning as password_change — no family kill on re-presentation.
      const tokenId = 'token-admin-revoked';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update('stale-but-legit').digest('hex');

      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: new Date(),
        revokedReason: 'admin_revoked',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'a@b.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('stale-but-legit'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toMatch(/revoked/i);
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('DOES cascade-revoke on legacy row with null revokedReason', async () => {
      // Rows written before the `revokedReason` column existed have NULL
      // reasons. Without a positive "this was deliberate" signal, the safest
      // default is to treat a replayed revoked token as rotation reuse — the
      // cascade fires and the whole family dies.
      const tokenId = 'token-legacy-null';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update('stale-but-legit').digest('hex');

      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: new Date(),
        revokedReason: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'a@b.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('stale-but-legit'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toMatch(/reuse detected/i);
      expect(mockRefreshTokenRepo.revokeAllForUser).toHaveBeenCalledWith('user-1', 'rotation');
    });

    it('should throw when token not found in DB', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId: 'missing',
        membershipId: 'membership-1',
        type: 'refresh',
      });
      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(null);

      const failure = await expectBusinessError(
        authService.refreshToken('mock-token'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Invalid refresh token');
    });

    it('should throw when token hash does not match', async () => {
      const tokenId = 'token-mismatch';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });
      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash: 'wrong-hash-value',
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: null,
        revokedReason: null,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'admin@test.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('mock-token'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Invalid refresh token');
    });

    it('should throw on expired refresh token', async () => {
      const tokenId = 'expired-token';
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        tokenId,
        membershipId: 'membership-1',
        type: 'refresh',
      });

      const { createHash } = await import('node:crypto');
      const tokenHash = createHash('sha256').update('mock-token').digest('hex');

      mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue({
        id: tokenId,
        tokenHash,
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: null,
        revokedReason: null,
        expiresAt: new Date(Date.now() - 86400000),
        createdAt: new Date(),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'admin',
          email: 'admin@test.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      });

      const failure = await expectBusinessError(
        authService.refreshToken('mock-token'),
        ErrorCode.SESSION_EXPIRED,
      );
      expect(failure.message).toBe('Refresh token expired');
    });

    describe('membership re-validation', () => {
      beforeEach(() => {
        mockJwt.verify.mockReturnValue({
          sub: 'user-1',
          tokenId: 'token-id-1',
          membershipId: 'membership-1',
          type: 'refresh',
        });
        mockJwt.sign.mockReturnValue('new-jwt');
        mockUserRepo.findById.mockResolvedValue(activeUser());
      });

      it('should issue institute tokens from the re-read membership, not the token row', async () => {
        const roleAbilities = [{ action: 'manage', subject: 'all' }];
        const memberAbilities = [{ action: 'read', subject: 'Profile' }];
        mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(
          storedRefreshToken('institute'),
        );
        mockMembershipRepo.findByIdAndUser.mockResolvedValue(
          activeMembership({
            abilities: memberAbilities,
            role: { id: 'role-1', name: { en: 'Admin' }, abilities: roleAbilities },
          }),
        );

        const result = await authService.refreshToken(REFRESH_TOKEN);

        expect(mockMembershipRepo.findByIdAndUser).toHaveBeenCalledWith('membership-1', 'user-1');
        expect(result.user?.tenantId).toBe('tenant-1');
        expect(result.user?.abilityRules).toEqual([...roleAbilities, ...memberAbilities]);
      });

      it('should reject when the institute membership is no longer active and keep the token unrotated', async () => {
        mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(
          storedRefreshToken('institute'),
        );
        mockMembershipRepo.findByIdAndUser.mockResolvedValue(null);

        await expectBusinessError(
          authService.refreshToken(REFRESH_TOKEN),
          ErrorCode.SESSION_EXPIRED,
        );

        expect(mockMembershipRepo.findActiveByUserId).not.toHaveBeenCalled();
        expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
        expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
      });

      it('should reject an inactive user with ACCOUNT_INACTIVE', async () => {
        mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(
          storedRefreshToken('institute'),
        );
        mockUserRepo.findById.mockResolvedValue({ ...activeUser(), status: 'SUSPENDED' });

        await expectBusinessError(
          authService.refreshToken(REFRESH_TOKEN),
          ErrorCode.ACCOUNT_INACTIVE,
        );

        expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
        expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
      });

      it('should refresh into the reseller membership the token was issued for', async () => {
        mockJwt.verify.mockReturnValue({
          sub: 'user-1',
          tokenId: 'token-id-1',
          membershipId: 'reseller-membership-2',
          type: 'refresh',
        });
        mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(
          storedRefreshToken('reseller'),
        );
        mockResellerMembershipRepo.findByUserId.mockResolvedValue([
          resellerMembership('reseller-membership-1', 'reseller-1'),
          resellerMembership('reseller-membership-2', 'reseller-2'),
        ]);

        const result = await authService.refreshToken(REFRESH_TOKEN);

        expect(result.user?.resellerId).toBe('reseller-2');
        expect(result.user?.membershipId).toBe('reseller-membership-2');
      });

      it('should reject when the reseller of the token membership is suspended', async () => {
        mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(
          storedRefreshToken('reseller'),
        );
        mockResellerMembershipRepo.findByUserId.mockResolvedValue([
          resellerMembership('membership-1', 'reseller-1', ResellerStatus.SUSPENDED),
        ]);

        await expectBusinessError(
          authService.refreshToken(REFRESH_TOKEN),
          ErrorCode.SESSION_EXPIRED,
        );

        expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      });

      it('should reject a platform token whose membership is gone', async () => {
        mockRefreshTokenRepo.findByIdWithRelations.mockResolvedValue(
          storedRefreshToken('platform'),
        );
        mockPlatformMembershipRepo.findByUserId.mockResolvedValue(null);

        await expectBusinessError(
          authService.refreshToken(REFRESH_TOKEN),
          ErrorCode.SESSION_EXPIRED,
        );

        expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      });
    });
  });

  describe('switchInstitute', () => {
    const tokenHash = createHash('sha256').update(REFRESH_TOKEN).digest('hex');
    const target = activeMembership({
      id: 'membership-2',
      tenantId: 'tenant-2',
      institute: {
        id: 'tenant-2',
        name: { en: 'Second Institute' },
        slug: 'second-institute',
        logoUrl: null,
        resellerId: RESELLER_ID,
      },
    });

    beforeEach(() => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'token-id-1', userId: 'user-1' });
      mockMembershipRepo.findByIdAndUser.mockResolvedValue(target);
      mockUserRepo.findById.mockResolvedValue(activeUser());
      mockJwt.sign.mockReturnValue('new-jwt');
    });

    it('should revoke only the presented refresh token and issue tokens for the target institute', async () => {
      const result = await authService.switchInstitute(
        instituteCaller,
        'membership-2',
        REFRESH_TOKEN,
      );

      expect(mockRefreshTokenRepo.findByHash).toHaveBeenCalledWith(tokenHash);
      expect(mockMembershipRepo.findByIdAndUser).toHaveBeenCalledWith('membership-2', 'user-1');
      expect(mockRefreshTokenRepo.revoke).toHaveBeenCalledTimes(1);
      expect(mockRefreshTokenRepo.revoke).toHaveBeenCalledWith('token-id-1', 'user_initiated');
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('new-jwt');
      expect(result.user?.tenantId).toBe('tenant-2');
      expect(result.user?.membershipId).toBe('membership-2');
    });

    it('should record the institute the caller switched from and to', async () => {
      await authService.switchInstitute(instituteCaller, 'membership-2', REFRESH_TOKEN, {
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: 'laptop',
      });

      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'institute_switch',
        scope: 'institute',
        tenantId: 'tenant-2',
        membershipId: 'membership-2',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: 'laptop',
        metadata: { from_tenant_id: 'tenant-1', to_tenant_id: 'tenant-2' },
      });
    });

    it('should keep the session when the target membership is not active', async () => {
      mockMembershipRepo.findByIdAndUser.mockResolvedValue(null);

      await expectBusinessError(
        authService.switchInstitute(instituteCaller, 'membership-2', REFRESH_TOKEN),
        ErrorCode.NO_ACTIVE_MEMBERSHIP,
      );

      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should reject an unknown refresh token without issuing tokens', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue(null);

      await expectBusinessError(
        authService.switchInstitute(instituteCaller, 'membership-2', 'unknown-token'),
        ErrorCode.SESSION_EXPIRED,
      );

      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a refresh token that belongs to another user', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'foreign', userId: 'other-user' });

      await expectBusinessError(
        authService.switchInstitute(instituteCaller, 'membership-2', REFRESH_TOKEN),
        ErrorCode.SESSION_EXPIRED,
      );

      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should refuse to switch during impersonation', async () => {
      await expectBusinessError(
        authService.switchInstitute(
          {
            ...instituteCaller,
            isImpersonated: true,
            impersonatorId: 'admin-1',
            impersonationSessionId: 'session-1',
          },
          'membership-2',
          REFRESH_TOKEN,
        ),
        ErrorCode.FORBIDDEN,
      );

      expect(mockRefreshTokenRepo.findByHash).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it('should reject an inactive user and keep the session', async () => {
      mockUserRepo.findById.mockResolvedValue({ ...activeUser(), status: 'SUSPENDED' });

      await expectBusinessError(
        authService.switchInstitute(instituteCaller, 'membership-2', REFRESH_TOKEN),
        ErrorCode.ACCOUNT_INACTIVE,
      );

      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    const tokenHash = createHash('sha256').update(REFRESH_TOKEN).digest('hex');

    it('should revoke only the session of the presented refresh token', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'token-id-1', userId: 'user-1' });

      await authService.logout(instituteCaller, REFRESH_TOKEN);

      expect(mockRefreshTokenRepo.findByHash).toHaveBeenCalledWith(tokenHash);
      expect(mockRefreshTokenRepo.revoke).toHaveBeenCalledTimes(1);
      // Not `rotation`: replaying the token later must not trigger the reuse cascade.
      expect(mockRefreshTokenRepo.revoke).toHaveBeenCalledWith('token-id-1', 'user_initiated');
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('should record the logout with the caller scope and request metadata', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'token-id-1', userId: 'user-1' });

      await authService.logout(instituteCaller, REFRESH_TOKEN, {
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: 'laptop',
      });

      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'logout',
        scope: 'institute',
        tenantId: 'tenant-1',
        resellerId: undefined,
        membershipId: 'membership-1',
        ip: '10.0.0.1',
        userAgent: 'vitest',
        deviceInfo: 'laptop',
      });
    });

    it('should succeed without revoking when the session is already gone', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue(null);

      await authService.logout(instituteCaller, REFRESH_TOKEN);

      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('should reject a refresh token that belongs to another user', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'foreign', userId: 'other-user' });

      await expectBusinessError(
        authService.logout(instituteCaller, REFRESH_TOKEN),
        ErrorCode.SESSION_EXPIRED,
      );

      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      expect(mockAuthEventService.emit).not.toHaveBeenCalled();
    });

    it('should refuse to log out the impersonated account', async () => {
      await expectBusinessError(
        authService.logout(
          {
            ...instituteCaller,
            isImpersonated: true,
            impersonatorId: 'admin-1',
            impersonationSessionId: 'session-1',
          },
          REFRESH_TOKEN,
        ),
        ErrorCode.FORBIDDEN,
      );

      expect(mockRefreshTokenRepo.findByHash).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.revoke).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('getUserById', () => {
    it('should return user when found', async () => {
      const user = {
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: 'mock-hash',
        status: 'ACTIVE' as const,
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      };
      mockUserRepo.findById.mockResolvedValue(user);

      const result = await authService.getUserById('user-1');
      expect(result).toEqual(user);
    });

    it('should return null when not found', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      const result = await authService.getUserById('missing');
      expect(result).toBeNull();
    });
  });

  describe('changePassword', () => {
    // ROV-96 — new contract:
    //   changePassword(userId, currentPassword, newPassword, meta?) → Promise<void>
    //   Rules come from failedPasswordRules. Server revokes ALL refresh tokens; caller must re-login.
    const CURRENT = 'current-password-123';
    const NEW_TOKEN_VERSION = 4;
    const NEW = 'NewPassword12!';
    const userId = 'user-1';

    let storedUser: NonNullable<Awaited<ReturnType<UserRepository['findById']>>>;

    beforeEach(async () => {
      storedUser = {
        id: userId,
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: await hash(CURRENT),
        status: 'ACTIVE' as const,
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      };
      mockUserRepo.findById.mockResolvedValue(storedUser);
      mockUserRepo.updatePassword.mockResolvedValue(NEW_TOKEN_VERSION);
      mockRefreshTokenRepo.revokeAllForUser.mockResolvedValue(undefined);
    });

    it('hashes new password, persists via updatePassword, and revokes all refresh tokens', async () => {
      const result = await authService.changePassword(userId, CURRENT, NEW);

      // New contract returns void/undefined — no token blob.
      expect(result).toBeUndefined();

      expect(mockUserRepo.updatePassword).toHaveBeenCalledTimes(1);
      const [updatedId, updatedHash] = mockUserRepo.updatePassword.mock.calls[0];
      expect(updatedId).toBe(userId);
      expect(typeof updatedHash).toBe('string');
      expect(updatedHash).not.toBe(storedUser.passwordHash);
      expect(updatedHash.startsWith('$argon2id$')).toBe(true);

      expect(mockRefreshTokenRepo.revokeAllForUser).toHaveBeenCalledWith(userId, 'password_change');
    });

    it('publishes the new token version so older access tokens are refused at once', async () => {
      await authService.changePassword(userId, CURRENT, NEW);

      const key = `auth:token-version:${userId}`;
      expect(mockRedis.set).toHaveBeenCalledWith(key, String(NEW_TOKEN_VERSION), 'EX', 60);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `${key}:floor`,
        String(NEW_TOKEN_VERSION),
        'EX',
        70,
      );
    });

    it('revokes refresh tokens AFTER persisting the new password hash', async () => {
      await authService.changePassword(userId, CURRENT, NEW);

      const updateOrder = mockUserRepo.updatePassword.mock.invocationCallOrder[0];
      const revokeOrder = mockRefreshTokenRepo.revokeAllForUser.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(revokeOrder);
    });

    it('emits both password_change and all_sessions_revoked auth events', async () => {
      await authService.changePassword(userId, CURRENT, NEW, {
        ip: '127.0.0.1',
        userAgent: 'jest',
      });

      expect(mockAuthEventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'password_change',
          ip: '127.0.0.1',
          userAgent: 'jest',
        }),
      );
      expect(mockAuthEventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'all_sessions_revoked',
          metadata: expect.objectContaining({ reason: 'password_change' }),
        }),
      );
    });

    it('rejects wrong current password with CURRENT_PASSWORD_INCORRECT', async () => {
      const failure = await expectBusinessError(
        authService.changePassword(userId, 'not-the-current-password', NEW),
        ErrorCode.CURRENT_PASSWORD_INCORRECT,
      );

      expect(failure.message).toBe('Current password is incorrect');

      expect(mockUserRepo.updatePassword).not.toHaveBeenCalled();
      expect(mockRefreshTokenRepo.revokeAllForUser).not.toHaveBeenCalled();
    });

    it.each([
      ['shorter than NEW_PASSWORD_MIN_LENGTH', `Aa1${'x'.repeat(NEW_PASSWORD_MIN_LENGTH - 4)}`],
      ['lower case only', 'lowercase-only-1'],
      ['without a digit', 'abcdefghIJ'],
    ])('rejects a new password %s with VALIDATION_FAILED', async (_case, rejected) => {
      await expectBusinessError(
        authService.changePassword(userId, CURRENT, rejected),
        ErrorCode.VALIDATION_FAILED,
      );
      expect(mockUserRepo.updatePassword).not.toHaveBeenCalled();
    });

    it('rejects when new password equals current with PASSWORD_UNCHANGED', async () => {
      await expectBusinessError(
        authService.changePassword(userId, CURRENT, CURRENT),
        ErrorCode.PASSWORD_UNCHANGED,
      );
      expect(mockUserRepo.updatePassword).not.toHaveBeenCalled();
    });

    // The remaining drift items (scope-specific behaviour, must_change_password
    // clearing, JWT mustChangePassword claim) are covered by integration / e2e
    // tests and don't belong on the unit boundary anymore. Marking explicitly
    // for review during the next AuthService spec sweep.
    it.todo('asserts JWT claim mustChangePassword=false on subsequent login after change');
    it.todo('verifies must_change_password column is cleared on success (integration scope)');
  });

  describe('verifyCredentials (lockout integration)', () => {
    // verifyCredentials is private, so we exercise it through instituteLogin —
    // the public surface that funnels through the same lockout path.
    const correctPassword = 'correct-password-12';
    let mockUser: NonNullable<Awaited<ReturnType<UserRepository['findByUsername']>>>;

    beforeEach(async () => {
      mockUser = {
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: await hash(correctPassword),
        status: 'ACTIVE' as const,
        passwordChangedAt: null,
        mustChangePassword: false,
        emailVerifiedAt: null,
        tokenVersion: 0,
      };
    });

    it('throws ACCOUNT_LOCKED when lockout is active', async () => {
      mockLockout.isLocked.mockResolvedValue(true);

      await expectBusinessError(
        authService.instituteLogin('admin', correctPassword),
        ErrorCode.ACCOUNT_LOCKED,
      );
      expect(mockUserRepo.findByUsername).not.toHaveBeenCalled();
      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId: undefined,
        type: 'login_failed',
        portal: 'institute',
        authMethod: 'password',
        failureReason: 'ACCOUNT_LOCKED',
        ip: undefined,
        userAgent: undefined,
        deviceInfo: undefined,
        metadata: { username_lower: 'admin' },
      });
    });

    it.each([
      ['an unknown username', null, 'UNKNOWN_USER', undefined, { username_lower: 'admin' }],
      ['an inactive account', 'SUSPENDED', 'ACCOUNT_INACTIVE', 'user-1', undefined],
      ['a wrong password', 'ACTIVE', 'INVALID_PASSWORD', 'user-1', undefined],
    ] as const)('records %s on the portal it was tried on, with no scope', async (_label, status, failureReason, userId, metadata) => {
      mockUserRepo.findByUsername.mockResolvedValue(status ? { ...mockUser, status } : null);

      await expectBusinessError(
        authService.adminLogin('admin', 'wrong-password', { ip: '10.0.0.1' }),
        ErrorCode.INVALID_CREDENTIALS,
      );

      expect(mockAuthEventService.emit).toHaveBeenCalledWith({
        userId,
        type: 'login_failed',
        portal: 'platform',
        authMethod: 'password',
        failureReason,
        ip: '10.0.0.1',
        userAgent: undefined,
        deviceInfo: undefined,
        metadata,
      });
      expect(mockLockout.recordFailure).toHaveBeenCalledWith('admin', 'platform', {
        ip: '10.0.0.1',
      });
    });

    it('calls clearOnSuccess after a successful login', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockMembershipRepo.findActiveByUserId.mockResolvedValue([
        {
          id: 'membership-1',
          tenantId: 'tenant-1',
          roleId: 'role-1',
          abilities: null,
          status: 'ACTIVE' as const,
          institute: {
            id: 'tenant-1',
            name: { en: 'Test' },
            slug: 'test',
            logoUrl: null,
            resellerId: '00000000-0000-7000-a000-000000000011',
          },
          role: { id: 'role-1', name: { en: 'Admin' }, abilities: [] },
        },
      ]);
      mockRefreshTokenRepo.create.mockResolvedValue(undefined);

      await authService.instituteLogin('admin', correctPassword);

      expect(mockLockout.clearOnSuccess).toHaveBeenCalledWith('admin');
      expect(mockLockout.recordFailure).not.toHaveBeenCalled();
    });

    it('calls recordFailure on a failed login and surfaces INVALID_CREDENTIALS', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);

      await expectBusinessError(
        authService.instituteLogin('admin', 'wrong-password'),
        ErrorCode.INVALID_CREDENTIALS,
      );

      expect(mockLockout.recordFailure).toHaveBeenCalledWith('admin', 'institute', undefined);
      expect(mockLockout.clearOnSuccess).not.toHaveBeenCalled();
    });

    it('promotes the lockout to ACCOUNT_LOCKED when recordFailure crosses the threshold', async () => {
      mockUserRepo.findByUsername.mockResolvedValue(mockUser);
      mockLockout.recordFailure.mockResolvedValue({ locked: true, remainingAttempts: 0 });

      await expectBusinessError(
        authService.instituteLogin('admin', 'wrong-password'),
        ErrorCode.ACCOUNT_LOCKED,
      );
    });
  });
  describe('session management', () => {
    function session(id: string, token: string): RefreshTokenWithRelations {
      return {
        id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        userId: 'user-1',
        membershipScope: 'institute',
        revokedAt: null,
        revokedReason: null,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-11-16T00:00:00.000Z'),
        deviceInfo: null,
        ipAddress: null,
        userAgent: null,
        lastUsedAt: null,
        user: {
          id: 'user-1',
          username: 'session-user',
          email: 'session@example.com',
          status: 'ACTIVE',
          passwordChangedAt: null,
          mustChangePassword: false,
          emailVerifiedAt: null,
          tokenVersion: 0,
        },
        membership: null,
      };
    }

    it('should mark only the matching active session as current', async () => {
      const current = session('current', 'refresh');
      const other = session('other', 'other-refresh');
      mockRefreshTokenRepo.findActiveByUserId.mockResolvedValue([current, other]);

      expect(await authService.getActiveSessions('user-1', 'refresh')).toEqual([
        { ...current, isCurrent: true },
        { ...other, isCurrent: false },
      ]);
      expect(mockRefreshTokenRepo.findActiveByUserId).toHaveBeenCalledWith('user-1');
    });

    it('should reject a refresh token outside the active sessions', async () => {
      mockRefreshTokenRepo.findActiveByUserId.mockResolvedValue([session('current', 'refresh')]);

      await expectBusinessError(
        authService.getActiveSessions('user-1', 'foreign-token'),
        ErrorCode.SESSION_EXPIRED,
      );
    });

    it('should preserve the matching session when revoking other sessions', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'current', userId: 'user-1' });

      await authService.revokeAllOtherSessions('user-1', 'refresh');

      expect(mockRefreshTokenRepo.findByHash).toHaveBeenCalledWith(
        createHash('sha256').update('refresh').digest('hex'),
      );
      expect(mockRefreshTokenRepo.revokeAllOtherForUser).toHaveBeenCalledWith(
        'user-1',
        'current',
        'user_initiated',
      );
    });

    it('should reject another user refresh token before revoking anything', async () => {
      mockRefreshTokenRepo.findByHash.mockResolvedValue({ id: 'foreign', userId: 'other-user' });

      await expectBusinessError(
        authService.revokeAllOtherSessions('user-1', 'foreign-token'),
        ErrorCode.SESSION_EXPIRED,
      );

      expect(mockRefreshTokenRepo.revokeAllOtherForUser).not.toHaveBeenCalled();
      expect(mockAuthEventService.emit).not.toHaveBeenCalled();
    });
  });
});
