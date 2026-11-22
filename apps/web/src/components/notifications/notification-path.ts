import type { AuthScope } from '@roviq/common-types';

const PORTAL_PREFIX: Record<AuthScope, string> = {
  platform: 'admin',
  reseller: 'reseller',
  institute: 'institute',
};

// Letters, digits and URL-safe punctuation only: no scheme, host, backslash, `..` or query.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * The in-app route a notification links to, or null. Only a relative path inside the
 * portal of the current scope is accepted; `data` comes from the server but is never
 * trusted as a URL.
 */
export function notificationPath(
  data: Record<string, unknown> | null | undefined,
  scope: AuthScope,
): string | null {
  const path = data?.path;
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const [empty, portal, ...rest] = path.split('/');
  if (empty !== '' || portal !== PORTAL_PREFIX[scope]) return null;
  if (!rest.every((segment) => SAFE_SEGMENT.test(segment))) return null;
  return path;
}
