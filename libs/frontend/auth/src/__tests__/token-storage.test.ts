import { beforeEach, describe, expect, it } from 'vitest';
import { createScopedTokenStorage, tokenStorage } from '../lib/token-storage';
import type { AuthUser, MembershipInfo } from '../lib/types';

const mockUser: AuthUser = {
  id: 'u1',
  username: 'admin',
  email: 'a@b.com',
  scope: 'institute',
  tenantId: 't1',
  roleId: 'r1',
};

const mockMemberships: MembershipInfo[] = [
  {
    tenantId: 't1',
    roleId: 'r1',
    instituteName: { en: 'Institute 1' },
    instituteSlug: 'institute-1',
    roleName: { en: 'admin' },
  },
  {
    tenantId: 't2',
    roleId: 'r2',
    instituteName: { en: 'Institute 2' },
    instituteSlug: 'institute-2',
    roleName: { en: 'teacher' },
  },
];

describe('tokenStorage (legacy)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  describe('tokens', () => {
    it('stores and retrieves access and refresh tokens', () => {
      tokenStorage.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
      expect(tokenStorage.getAccessToken()).toBe('access-1');
      expect(tokenStorage.getRefreshToken()).toBe('refresh-1');
    });

    it('returns null when no tokens are set', () => {
      expect(tokenStorage.getAccessToken()).toBeNull();
      expect(tokenStorage.getRefreshToken()).toBeNull();
    });
  });

  describe('user', () => {
    it('stores and retrieves user object', () => {
      tokenStorage.setUser(mockUser);
      expect(tokenStorage.getUser()).toEqual(mockUser);
    });

    it('returns null when no user is set', () => {
      expect(tokenStorage.getUser()).toBeNull();
    });

    it('returns null for invalid JSON in storage', () => {
      localStorage.setItem('roviq_user', '{invalid json');
      expect(tokenStorage.getUser()).toBeNull();
    });
  });

  describe('platform token', () => {
    it('stores and retrieves platform token', () => {
      tokenStorage.setPlatformToken('platform-123');
      expect(tokenStorage.getPlatformToken()).toBe('platform-123');
    });

    it('returns null when no platform token is set', () => {
      expect(tokenStorage.getPlatformToken()).toBeNull();
    });
  });

  describe('memberships', () => {
    it('stores and retrieves memberships', () => {
      tokenStorage.setMemberships(mockMemberships);
      expect(tokenStorage.getMemberships()).toEqual(mockMemberships);
    });

    it('returns null when no memberships are set', () => {
      expect(tokenStorage.getMemberships()).toBeNull();
    });

    it('returns null for invalid JSON in storage', () => {
      sessionStorage.setItem('roviq_memberships', 'not-json');
      expect(tokenStorage.getMemberships()).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all stored data', () => {
      tokenStorage.setTokens({ accessToken: 'a', refreshToken: 'r' });
      tokenStorage.setUser(mockUser);
      tokenStorage.setPlatformToken('p');
      tokenStorage.setMemberships(mockMemberships);

      tokenStorage.clear();

      expect(tokenStorage.getAccessToken()).toBeNull();
      expect(tokenStorage.getRefreshToken()).toBeNull();
      expect(tokenStorage.getUser()).toBeNull();
      expect(tokenStorage.getPlatformToken()).toBeNull();
      expect(tokenStorage.getMemberships()).toBeNull();
    });
  });

  describe('clearPlatform', () => {
    it('removes platform token but keeps memberships and access/refresh tokens', () => {
      tokenStorage.setTokens({ accessToken: 'a', refreshToken: 'r' });
      tokenStorage.setPlatformToken('p');
      tokenStorage.setMemberships(mockMemberships);

      tokenStorage.clearPlatform();

      expect(tokenStorage.getPlatformToken()).toBeNull();
      expect(tokenStorage.getMemberships()).toEqual(mockMemberships);
      expect(tokenStorage.getAccessToken()).toBe('a');
      expect(tokenStorage.getRefreshToken()).toBe('r');
    });
  });
});

describe('createScopedTokenStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('isolates tokens by scope', () => {
    const platformStorage = createScopedTokenStorage('platform');
    const instituteStorage = createScopedTokenStorage('institute');

    platformStorage.setTokens({ accessToken: 'platform-access', refreshToken: 'platform-refresh' });
    instituteStorage.setTokens({
      accessToken: 'institute-access',
      refreshToken: 'institute-refresh',
    });

    expect(platformStorage.getAccessToken()).toBe('platform-access');
    expect(platformStorage.getRefreshToken()).toBe('platform-refresh');
    expect(instituteStorage.getAccessToken()).toBe('institute-access');
    expect(instituteStorage.getRefreshToken()).toBe('institute-refresh');
  });

  it('isolates user data by scope', () => {
    const platformStorage = createScopedTokenStorage('platform');
    const resellerStorage = createScopedTokenStorage('reseller');

    const platformUser = { ...mockUser, scope: 'platform' as const };
    const resellerUser = { ...mockUser, scope: 'reseller' as const, id: 'u2' };

    platformStorage.setUser(platformUser);
    resellerStorage.setUser(resellerUser);

    expect(platformStorage.getUser()).toEqual(platformUser);
    expect(resellerStorage.getUser()).toEqual(resellerUser);
  });

  it('clearing one scope does not affect another', () => {
    const platformStorage = createScopedTokenStorage('platform');
    const instituteStorage = createScopedTokenStorage('institute');

    platformStorage.setTokens({ accessToken: 'pa', refreshToken: 'pr' });
    instituteStorage.setTokens({ accessToken: 'ia', refreshToken: 'ir' });

    platformStorage.clear();

    expect(platformStorage.getAccessToken()).toBeNull();
    expect(instituteStorage.getAccessToken()).toBe('ia');
  });

  it('does not collide with legacy storage', () => {
    const scopedStorage = createScopedTokenStorage('institute');

    tokenStorage.setTokens({ accessToken: 'legacy-a', refreshToken: 'legacy-r' });
    scopedStorage.setTokens({ accessToken: 'scoped-a', refreshToken: 'scoped-r' });

    expect(tokenStorage.getAccessToken()).toBe('legacy-a');
    expect(scopedStorage.getAccessToken()).toBe('scoped-a');
  });

  it('stores and retrieves memberships per scope', () => {
    const storage = createScopedTokenStorage('institute');
    storage.setMemberships(mockMemberships);
    expect(storage.getMemberships()).toEqual(mockMemberships);
  });

  it('stores and retrieves platform token per scope', () => {
    const storage = createScopedTokenStorage('institute');
    storage.setPlatformToken('pt-123');
    expect(storage.getPlatformToken()).toBe('pt-123');

    storage.clearPlatform();
    expect(storage.getPlatformToken()).toBeNull();
  });
});
