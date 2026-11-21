import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectBusinessError } from '../../__tests__/expect-business-error';
import { AuthService } from '../../auth/auth.service';
import { AuthEventService } from '../../auth/auth-event.service';
import { UserRepository } from '../../auth/repositories/user.repository';
import { PasskeyService } from '../passkey.service';
import { AuthProviderRepository } from '../repositories/auth-provider.repository';

// Mock @simplewebauthn/server
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

function createMockRedis() {
  return createMock<Redis>({
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  });
}

function createMockAuthProviderRepo() {
  return createMock<AuthProviderRepository>({
    findPasskeysByUserId: vi.fn(),
    findByActiveUsername: vi.fn(),
    findByCredentialId: vi.fn(),
    create: vi.fn(),
    updateProviderData: vi.fn(),
    countOtherPasskeys: vi.fn(),
    deletePasskey: vi.fn(),
  });
}

function createMockUserRepo() {
  return createMock<UserRepository>({
    findById: vi.fn(),
    findByUsername: vi.fn(),
  });
}

function createMockAuthService() {
  return createMock<AuthService>({
    verifyPassword: vi.fn(),
    instituteLoginByUserId: vi.fn(),
  });
}

const META = { ip: '10.0.0.9', userAgent: 'vitest-agent' };

function createMockAuthEventService() {
  return createMock<AuthEventService>({
    emit: vi.fn().mockResolvedValue(undefined),
  });
}

function createMockConfigService() {
  const envs: Record<string, string> = {
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_RP_NAME: 'Roviq',
    ALLOWED_ORIGINS: 'http://localhost:4200',
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

describe('PasskeyService', () => {
  let service: PasskeyService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockAuthProviderRepo: ReturnType<typeof createMockAuthProviderRepo>;
  let mockUserRepo: ReturnType<typeof createMockUserRepo>;
  let mockAuth: ReturnType<typeof createMockAuthService>;
  let mockAuthEvent: ReturnType<typeof createMockAuthEventService>;
  let mockConfig: ReturnType<typeof createMockConfigService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = createMockRedis();
    mockAuthProviderRepo = createMockAuthProviderRepo();
    mockUserRepo = createMockUserRepo();
    mockAuth = createMockAuthService();
    mockAuthEvent = createMockAuthEventService();
    mockConfig = createMockConfigService();

    service = new PasskeyService(
      mockConfig,
      mockAuth,
      mockAuthEvent,
      mockAuthProviderRepo,
      mockUserRepo,
      mockRedis,
    );
  });

  describe('generateRegistrationOptions', () => {
    it('should reject if password is wrong', async () => {
      mockAuth.verifyPassword.mockResolvedValue(false);

      const failure = await expectBusinessError(
        service.generateRegistrationOptions('user-1', 'wrong-password'),
        ErrorCode.CURRENT_PASSWORD_INCORRECT,
      );
      expect(failure.message).toBe('Invalid password');
    });

    it('should generate options and store challenge in Redis', async () => {
      mockAuth.verifyPassword.mockResolvedValue(true);
      mockAuthProviderRepo.findPasskeysByUserId.mockResolvedValue([]);
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: 'mock-hash',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      const mockOptions = {
        challenge: 'test-challenge',
        user: { id: 'webauthn-user-id', name: 'admin', displayName: 'admin' },
      } as PublicKeyCredentialCreationOptionsJSON;
      vi.mocked(generateRegistrationOptions).mockResolvedValue(mockOptions);

      const result = await service.generateRegistrationOptions('user-1', 'correct-password');

      expect(result).toEqual(mockOptions);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'webauthn:reg:user-1',
        'test-challenge',
        'EX',
        300,
      );
    });

    it('should exclude existing passkeys from registration options', async () => {
      mockAuth.verifyPassword.mockResolvedValue(true);
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: 'mock-hash',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      mockAuthProviderRepo.findPasskeysByUserId.mockResolvedValue([
        {
          id: 'ap-existing',
          userId: 'user-1',
          provider: 'passkey',
          providerUserId: 'existing-cred-id',
          providerData: { transports: ['internal'] },
          createdAt: new Date('2026-01-01'),
        },
      ]);
      vi.mocked(generateRegistrationOptions).mockResolvedValue({
        challenge: 'c',
        user: { id: 'uid', name: 'admin', displayName: 'admin' },
      } as PublicKeyCredentialCreationOptionsJSON);

      await service.generateRegistrationOptions('user-1', 'correct-password');

      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [{ id: 'existing-cred-id', transports: ['internal'] }],
        }),
      );
    });
  });

  describe('verifyRegistration', () => {
    it('should throw if challenge not found in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);

      const failure = await expectBusinessError(
        service.verifyRegistration('user-1', {} as RegistrationResponseJSON, 'My Key'),
        ErrorCode.PASSKEY_CHALLENGE_EXPIRED,
      );
      expect(failure.message).toBe('Challenge expired or not found');
    });

    it('should throw if verification fails', async () => {
      mockRedis.get.mockResolvedValue('stored-challenge');
      vi.mocked(verifyRegistrationResponse).mockResolvedValue({
        verified: false,
      });

      const failure = await expectBusinessError(
        service.verifyRegistration('user-1', {} as RegistrationResponseJSON, 'My Key'),
        ErrorCode.PASSKEY_VERIFICATION_FAILED,
      );
      expect(failure.message).toBe('Verification failed');
    });

    it('should reject with PASSKEY_VERIFICATION_FAILED when the library rejects the response', async () => {
      mockRedis.get.mockResolvedValue('stored-challenge');
      vi.mocked(verifyRegistrationResponse).mockRejectedValue(
        new Error('Unexpected registration response challenge'),
      );

      const failure = await expectBusinessError(
        service.verifyRegistration('user-1', {} as RegistrationResponseJSON, 'My Key'),
        ErrorCode.PASSKEY_VERIFICATION_FAILED,
      );

      expect(failure.message).toBe('Verification failed');
    });

    it('should create AuthProvider row on success', async () => {
      mockRedis.get.mockResolvedValue('stored-challenge');
      vi.mocked(verifyRegistrationResponse).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      } as VerifiedRegistrationResponse);
      mockAuthProviderRepo.create.mockResolvedValue({
        id: 'ap-1',
        userId: 'user-1',
        provider: 'passkey',
        providerUserId: 'cred-id',
        providerData: {
          name: 'My Key',
          deviceType: 'multiDevice',
          backedUp: true,
          registeredAt: '2026-03-10T00:00:00.000Z',
          lastUsedAt: null,
        },
        createdAt: new Date('2026-01-01'),
      });

      const result = await service.verifyRegistration(
        'user-1',
        {} as RegistrationResponseJSON,
        'My Key',
      );

      expect(result.name).toBe('My Key');
      expect(mockRedis.del).toHaveBeenCalledWith('webauthn:reg:user-1');
      expect(mockAuthProviderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          provider: 'passkey',
          providerUserId: 'cred-id',
        }),
      );
      expect(mockAuthEvent.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'passkey_register',
          authMethod: 'passkey',
          metadata: expect.objectContaining({ passkey_id: 'ap-1' }),
        }),
      );
    });
  });

  describe('generateAuthOptions', () => {
    it('should throw generic error when user has no passkeys', async () => {
      mockAuthProviderRepo.findByActiveUsername.mockResolvedValue([]);

      const failure = await expectBusinessError(
        service.generateAuthOptions('nonexistent'),
        ErrorCode.PASSKEY_AUTHENTICATION_FAILED,
      );
      expect(failure.message).toBe('Invalid credentials');
    });

    it('should store challenge with random challengeId and return it', async () => {
      mockAuthProviderRepo.findByActiveUsername.mockResolvedValue([
        {
          id: 'ap-1',
          userId: 'user-1',
          provider: 'passkey',
          providerUserId: 'cred-1',
          providerData: { transports: ['internal'] },
          createdAt: new Date('2026-01-01'),
        },
      ]);
      vi.mocked(generateAuthenticationOptions).mockResolvedValue({
        challenge: 'auth-challenge',
      });

      const result = await service.generateAuthOptions('admin');

      expect(result.challengeId).toBeDefined();
      expect(result.optionsJSON).toEqual({ challenge: 'auth-challenge' });
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^webauthn:auth:/),
        expect.stringContaining('auth-challenge'),
        'EX',
        300,
      );
    });
  });

  describe('verifyAuth', () => {
    const storedPasskey = {
      id: 'ap-1',
      userId: 'user-1',
      provider: 'passkey',
      providerUserId: 'cred-1',
      providerData: {
        publicKey: 'AQID', // base64url of [1,2,3]
        counter: 0,
        transports: ['internal'],
        name: 'My Key',
        deviceType: 'multiDevice',
        backedUp: true,
        webauthnUserID: 'wuid',
        registeredAt: '2026-03-10T00:00:00.000Z',
        lastUsedAt: null,
        aaguid: '00000000-0000-0000-0000-000000000000',
      },
      createdAt: new Date('2026-01-01'),
    };

    it('should throw if challenge not found', async () => {
      mockRedis.get.mockResolvedValue(null);

      const failure = await expectBusinessError(
        service.verifyAuth('challenge-id', {} as AuthenticationResponseJSON, META),
        ErrorCode.PASSKEY_CHALLENGE_EXPIRED,
      );
      expect(failure.message).toBe('Challenge expired or not found');
    });

    it('should throw if passkey not found for credential', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ challenge: 'c' }));
      mockAuthProviderRepo.findByCredentialId.mockResolvedValue(null);

      const failure = await expectBusinessError(
        service.verifyAuth(
          'challenge-id',
          { id: 'unknown-cred' } as AuthenticationResponseJSON,
          META,
        ),
        ErrorCode.PASSKEY_AUTHENTICATION_FAILED,
      );
      expect(failure.message).toBe('Invalid credentials');
      expect(mockAuthEvent.emit).toHaveBeenCalledWith({
        userId: undefined,
        type: 'login_failed',
        portal: 'institute',
        authMethod: 'passkey',
        failureReason: 'PASSKEY_UNKNOWN',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
      });
    });

    it('should update counter and lastUsedAt, then call instituteLoginByUserId', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ challenge: 'stored-challenge' }));
      mockAuthProviderRepo.findByCredentialId.mockResolvedValue(storedPasskey);
      vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as VerifiedAuthenticationResponse);
      mockAuthProviderRepo.updateProviderData.mockResolvedValue(undefined);
      mockAuth.instituteLoginByUserId.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
        user: { id: 'user-1', username: 'admin', email: 'admin@test.com' },
      });

      const result = await service.verifyAuth(
        'challenge-id',
        { id: 'cred-1' } as AuthenticationResponseJSON,
        META,
      );

      expect(result.accessToken).toBe('at');
      expect(mockRedis.del).toHaveBeenCalledWith('webauthn:auth:challenge-id');
      expect(mockAuthProviderRepo.updateProviderData).toHaveBeenCalledWith(
        'ap-1',
        expect.objectContaining({
          counter: 1,
          lastUsedAt: expect.any(String),
        }),
      );
      expect(mockAuth.instituteLoginByUserId).toHaveBeenCalledWith('user-1', META);
    });

    it('should reject with PASSKEY_AUTHENTICATION_FAILED when the library rejects the response', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ challenge: 'stored-challenge' }));
      mockAuthProviderRepo.findByCredentialId.mockResolvedValue(storedPasskey);
      vi.mocked(verifyAuthenticationResponse).mockRejectedValue(
        new Error('Unexpected authentication response origin'),
      );

      const failure = await expectBusinessError(
        service.verifyAuth('challenge-id', { id: 'cred-1' } as AuthenticationResponseJSON, META),
        ErrorCode.PASSKEY_AUTHENTICATION_FAILED,
      );

      expect(failure.message).toBe('Invalid credentials');
      expect(mockAuth.instituteLoginByUserId).not.toHaveBeenCalled();
      expect(mockAuthEvent.emit).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'login_failed',
        portal: 'institute',
        authMethod: 'passkey',
        failureReason: 'PASSKEY_VERIFICATION_FAILED',
        ip: '10.0.0.9',
        userAgent: 'vitest-agent',
      });
    });
  });

  describe('myPasskeys', () => {
    it('should return formatted passkey list', async () => {
      mockAuthProviderRepo.findPasskeysByUserId.mockResolvedValue([
        {
          id: 'ap-1',
          userId: 'user-1',
          provider: 'passkey',
          providerUserId: 'cred-1',
          providerData: {
            name: 'MacBook',
            deviceType: 'multiDevice',
            backedUp: true,
            registeredAt: '2026-03-10T00:00:00.000Z',
            lastUsedAt: null,
          },
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const result = await service.myPasskeys('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('MacBook');
      expect(result[0].id).toBe('ap-1');
    });
  });

  describe('removePasskey', () => {
    it('should throw if passkey is last auth method and user has no password', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: '',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      mockAuthProviderRepo.countOtherPasskeys.mockResolvedValue(0);

      const failure = await expectBusinessError(
        service.removePasskey('user-1', 'ap-1'),
        ErrorCode.PASSKEY_LAST_AUTH_METHOD,
      );
      expect(failure.message).toBe('Cannot remove your only authentication method');
    });

    it('should allow removal if user still has a password', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: '$argon2id$...',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      mockAuthProviderRepo.countOtherPasskeys.mockResolvedValue(0);
      mockAuthProviderRepo.deletePasskey.mockResolvedValue(1);

      await service.removePasskey('user-1', 'ap-1');

      expect(mockAuthProviderRepo.deletePasskey).toHaveBeenCalledWith('ap-1', 'user-1');
    });

    it('should allow removal if user has other passkeys', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: '',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      mockAuthProviderRepo.countOtherPasskeys.mockResolvedValue(1);
      mockAuthProviderRepo.deletePasskey.mockResolvedValue(1);

      await service.removePasskey('user-1', 'ap-1');

      expect(mockAuthProviderRepo.deletePasskey).toHaveBeenCalled();
    });

    it('should throw if passkey does not belong to user', async () => {
      mockUserRepo.findById.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@test.com',
        passwordHash: '$argon2id$...',
        status: 'ACTIVE',
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      mockAuthProviderRepo.countOtherPasskeys.mockResolvedValue(0);
      mockAuthProviderRepo.deletePasskey.mockResolvedValue(0);

      const failure = await expectBusinessError(
        service.removePasskey('user-1', 'other-users-ap'),
        ErrorCode.PASSKEY_NOT_FOUND,
      );
      expect(failure.message).toBe('Passkey not found');
    });
  });
});
