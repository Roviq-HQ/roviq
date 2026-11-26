import type { ErrorCode } from '@roviq/common-types';

/** A GraphQL error from the auth fetch client, keeping the server's `extensions.code`. */
export class AuthRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'AuthRequestError';
    this.code = code;
  }
}

/** Failures that happen in the browser and never reach the API. */
export type ClientErrorKind =
  | 'network'
  | 'passkeyCancelled'
  | 'passkeyAlreadyRegistered'
  | 'passkeyNotSupported';

function readFirstGraphQLErrorCode(error: object): string | null {
  if (!('errors' in error) || !Array.isArray(error.errors)) return null;
  const first: unknown = error.errors[0];
  if (typeof first !== 'object' || first === null || !('extensions' in first)) return null;
  const { extensions } = first;
  if (typeof extensions !== 'object' || extensions === null || !('code' in extensions)) return null;
  return typeof extensions.code === 'string' ? extensions.code : null;
}

/** `extensions.code` of an auth request error or an Apollo `CombinedGraphQLErrors`. */
export function extractErrorCode(error: unknown): string | null {
  if (error instanceof AuthRequestError) return error.code;
  if (typeof error !== 'object' || error === null) return null;
  return readFirstGraphQLErrorCode(error);
}

export function isAppError(error: unknown, code: ErrorCode): boolean {
  return extractErrorCode(error) === code;
}

export function classifyClientError(error: unknown): ClientErrorKind | null {
  if (!(error instanceof Error) || error instanceof AuthRequestError) return null;
  switch (error.name) {
    // WebAuthn reports dismissal, timeout and "no matching passkey" identically.
    case 'NotAllowedError':
    case 'AbortError':
      return 'passkeyCancelled';
    case 'InvalidStateError':
      return 'passkeyAlreadyRegistered';
    case 'NotSupportedError':
    case 'SecurityError':
      return 'passkeyNotSupported';
    default:
      // fetch() rejects with a TypeError when the request never completes.
      return error instanceof TypeError ? 'network' : null;
  }
}

/** Server answers to a token refresh that mean the session is over, not that the try failed. */
const REFRESH_REFUSED_CODES: readonly string[] = [
  'SESSION_EXPIRED',
  'UNAUTHENTICATED',
  'ACCOUNT_INACTIVE',
  'PASSWORD_CHANGED',
  'NO_ACTIVE_MEMBERSHIP',
  'INSTITUTE_NOT_ACTIVE',
];

/**
 * True when a refresh failed because the server refused the session. A network failure or a
 * server error is false: the session may be fine, so the caller should try again later.
 */
export function isRefreshRefused(error: unknown): boolean {
  const code = extractErrorCode(error);
  return code !== null && REFRESH_REFUSED_CODES.includes(code);
}

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

/** Codes the auth UI has dedicated copy for; anything else falls back to `generic`. */
export const AUTH_ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_INACTIVE',
  'SESSION_EXPIRED',
  'PASSWORD_CHANGED',
  'PASSWORD_CHANGE_REQUIRED',
  'CURRENT_PASSWORD_INCORRECT',
  'PASSWORD_UNCHANGED',
  'NO_ACTIVE_MEMBERSHIP',
  'INSTITUTE_NOT_ACTIVE',
  'PASSKEY_CHALLENGE_EXPIRED',
  'PASSKEY_VERIFICATION_FAILED',
  'PASSKEY_AUTHENTICATION_FAILED',
  'PASSKEY_NOT_FOUND',
  'PASSKEY_LAST_AUTH_METHOD',
  'VALIDATION_FAILED',
  'TOO_MANY_REQUESTS',
] as const satisfies readonly ErrorCode[];

export const AUTH_CLIENT_ERROR_KINDS = [
  'network',
  'passkeyCancelled',
  'passkeyAlreadyRegistered',
  'passkeyNotSupported',
] as const satisfies readonly ClientErrorKind[];

export type AuthErrorKey =
  | (typeof AUTH_ERROR_CODES)[number]
  | ClientErrorKind
  | 'generic'
  | 'retry';

export type AuthErrorLabels = Partial<Record<AuthErrorKey, string>>;

export const DEFAULT_AUTH_ERROR_LABELS: Record<AuthErrorKey, string> = {
  INVALID_CREDENTIALS: 'Invalid Roviq ID or password',
  ACCOUNT_LOCKED: 'Too many failed attempts. Try again in 30 minutes.',
  ACCOUNT_NOT_FOUND: 'No account found for this portal.',
  ACCOUNT_INACTIVE: 'This account is no longer active.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  PASSWORD_CHANGED: 'Your password was changed. Please sign in again.',
  PASSWORD_CHANGE_REQUIRED: 'You must change your password before continuing.',
  CURRENT_PASSWORD_INCORRECT: 'Current password is incorrect.',
  PASSWORD_UNCHANGED: 'New password must differ from the current password.',
  NO_ACTIVE_MEMBERSHIP: 'You no longer have access to this institute.',
  INSTITUTE_NOT_ACTIVE:
    'Your institute is not active right now. Please contact your institute or Roviq support.',
  PASSKEY_CHALLENGE_EXPIRED: 'Passkey verification timed out. Please try again.',
  PASSKEY_VERIFICATION_FAILED: 'Passkey could not be verified. Please try again.',
  PASSKEY_AUTHENTICATION_FAILED: 'Passkey sign-in failed. Try again or use your password.',
  PASSKEY_NOT_FOUND: 'Passkey not found.',
  PASSKEY_LAST_AUTH_METHOD:
    'Cannot remove your only sign-in method. Add another passkey or a password first.',
  VALIDATION_FAILED: 'Please check your input and try again.',
  TOO_MANY_REQUESTS: 'Too many requests. Please wait a moment and try again.',
  network: 'Could not reach the server. Check your connection and try again.',
  passkeyCancelled: 'Passkey prompt was closed. You can try again or use your password.',
  passkeyAlreadyRegistered: 'This device already has a passkey for your account.',
  passkeyNotSupported: 'Passkeys are not supported on this browser or device.',
  generic: 'Something went wrong. Please try again.',
  retry: 'Retry',
};

function isAuthErrorKey(key: string): key is AuthErrorKey {
  return key in DEFAULT_AUTH_ERROR_LABELS;
}

/** Translated copy for an auth failure — never the raw server message. */
export function resolveAuthErrorMessage(error: unknown, labels?: AuthErrorLabels): string {
  const merged = { ...DEFAULT_AUTH_ERROR_LABELS, ...labels };
  const key = classifyClientError(error) ?? extractErrorCode(error);
  return key && isAuthErrorKey(key) ? merged[key] : merged.generic;
}
