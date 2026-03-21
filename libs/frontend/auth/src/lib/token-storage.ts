import type { AuthScope, AuthTokens, AuthUser, MembershipInfo } from './types';

function scopeKey(scope: AuthScope, suffix: string): string {
  return `roviq-${scope}-${suffix}`;
}

// Legacy keys for backward compatibility
const LEGACY_ACCESS_TOKEN_KEY = 'roviq_access_token';
const LEGACY_REFRESH_TOKEN_KEY = 'roviq_refresh_token';
const LEGACY_USER_KEY = 'roviq_user';
const LEGACY_PLATFORM_TOKEN_KEY = 'roviq_platform_token';
const LEGACY_MEMBERSHIPS_KEY = 'roviq_memberships';

function createScopedTokenStorage(scope: AuthScope) {
  const ACCESS_TOKEN_KEY = scopeKey(scope, 'access-token');
  const REFRESH_TOKEN_KEY = scopeKey(scope, 'refresh-token');
  const USER_KEY = scopeKey(scope, 'user');
  const PLATFORM_TOKEN_KEY = scopeKey(scope, 'platform-token');
  const MEMBERSHIPS_KEY = scopeKey(scope, 'memberships');

  return {
    getAccessToken(): string | null {
      if (typeof window === 'undefined') return null;
      return sessionStorage.getItem(ACCESS_TOKEN_KEY);
    },

    getRefreshToken(): string | null {
      if (typeof window === 'undefined') return null;
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    },

    setTokens(tokens: AuthTokens): void {
      if (typeof window === 'undefined') return;
      sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    },

    getUser(): AuthUser | null {
      if (typeof window === 'undefined') return null;
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AuthUser;
      } catch {
        return null;
      }
    },

    setUser(user: AuthUser): void {
      if (typeof window === 'undefined') return;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },

    getPlatformToken(): string | null {
      if (typeof window === 'undefined') return null;
      return sessionStorage.getItem(PLATFORM_TOKEN_KEY);
    },

    setPlatformToken(token: string): void {
      if (typeof window === 'undefined') return;
      sessionStorage.setItem(PLATFORM_TOKEN_KEY, token);
    },

    getMemberships(): MembershipInfo[] | null {
      if (typeof window === 'undefined') return null;
      const raw = sessionStorage.getItem(MEMBERSHIPS_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as MembershipInfo[];
      } catch {
        return null;
      }
    },

    setMemberships(memberships: MembershipInfo[]): void {
      if (typeof window === 'undefined') return;
      sessionStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(memberships));
    },

    clearPlatform(): void {
      if (typeof window === 'undefined') return;
      sessionStorage.removeItem(PLATFORM_TOKEN_KEY);
    },

    clear(): void {
      if (typeof window === 'undefined') return;
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(PLATFORM_TOKEN_KEY);
      sessionStorage.removeItem(MEMBERSHIPS_KEY);
    },
  };
}

/**
 * Default (legacy) token storage using unscoped keys.
 * Kept for backward compatibility — new code should use `createScopedTokenStorage`.
 */
export const tokenStorage = {
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(LEGACY_ACCESS_TOKEN_KEY);
  },

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY);
  },

  setTokens(tokens: AuthTokens): void {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(LEGACY_REFRESH_TOKEN_KEY, tokens.refreshToken);
  },

  getUser(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(LEGACY_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },

  setUser(user: AuthUser): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(user));
  },

  getPlatformToken(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(LEGACY_PLATFORM_TOKEN_KEY);
  },

  setPlatformToken(token: string): void {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(LEGACY_PLATFORM_TOKEN_KEY, token);
  },

  getMemberships(): MembershipInfo[] | null {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(LEGACY_MEMBERSHIPS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MembershipInfo[];
    } catch {
      return null;
    }
  },

  setMemberships(memberships: MembershipInfo[]): void {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(LEGACY_MEMBERSHIPS_KEY, JSON.stringify(memberships));
  },

  clearPlatform(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(LEGACY_PLATFORM_TOKEN_KEY);
  },

  clear(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
    sessionStorage.removeItem(LEGACY_PLATFORM_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_MEMBERSHIPS_KEY);
  },
};

export { createScopedTokenStorage };
