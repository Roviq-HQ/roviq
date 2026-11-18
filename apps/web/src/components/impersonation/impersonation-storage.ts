/** Locale code → text, as the API returns tenant-authored names. */
type I18nContent = Record<string, string>;

/** Read by `@roviq/auth` and the Apollo client too; the key is part of their contract. */
export const IMPERSONATION_TOKEN_KEY = 'roviq-impersonation-token';
const IMPERSONATED_USER_KEY = 'roviq-impersonation-user';

export interface ImpersonatedUser {
  username: string;
  firstName: I18nContent | null;
  lastName: I18nContent | null;
}

/**
 * sessionStorage, not localStorage: the session dies with this tab and never touches a
 * session the same browser holds on this portal.
 */
export function storeImpersonation(token: string, user: ImpersonatedUser): void {
  sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
  sessionStorage.setItem(IMPERSONATED_USER_KEY, JSON.stringify(user));
}

export function readImpersonationToken(): string | null {
  return typeof window === 'undefined' ? null : sessionStorage.getItem(IMPERSONATION_TOKEN_KEY);
}

export function readImpersonatedUser(): ImpersonatedUser | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(IMPERSONATED_USER_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isImpersonatedUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearImpersonation(): void {
  sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
  sessionStorage.removeItem(IMPERSONATED_USER_KEY);
}

function isImpersonatedUser(value: unknown): value is ImpersonatedUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    'username' in value &&
    typeof value.username === 'string'
  );
}
