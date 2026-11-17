import { describe, expect, it } from 'vitest';
import {
  AUTH_CLIENT_ERROR_KINDS,
  AUTH_ERROR_CODES,
  AuthRequestError,
  classifyClientError,
  DEFAULT_AUTH_ERROR_LABELS,
  extractErrorCode,
  isAppError,
  resolveAuthErrorMessage,
} from '../lib/error-utils';

function domError(name: string): Error {
  return new DOMException('browser failure', name);
}

describe('extractErrorCode', () => {
  it('should read the code carried by an auth request error', () => {
    expect(
      extractErrorCode(new AuthRequestError('Invalid credentials', 'INVALID_CREDENTIALS')),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('should read extensions.code from an Apollo-style error', () => {
    const apolloError = { errors: [{ message: 'nope', extensions: { code: 'FORBIDDEN' } }] };

    expect(extractErrorCode(apolloError)).toBe('FORBIDDEN');
  });

  it('should return null when no code is available', () => {
    expect(extractErrorCode(new AuthRequestError('boom', null))).toBeNull();
    expect(extractErrorCode(new Error('Invalid credentials'))).toBeNull();
    expect(extractErrorCode({ errors: [{ message: 'no extensions' }] })).toBeNull();
    expect(extractErrorCode({ errors: [{ extensions: { code: 42 } }] })).toBeNull();
    expect(extractErrorCode('INVALID_CREDENTIALS')).toBeNull();
    expect(extractErrorCode(null)).toBeNull();
  });
});

describe('isAppError', () => {
  it('should match only the given code', () => {
    const error = new AuthRequestError('Password changed', 'PASSWORD_CHANGED');

    expect(isAppError(error, 'PASSWORD_CHANGED')).toBe(true);
    expect(isAppError(error, 'SESSION_EXPIRED')).toBe(false);
  });

  it('should not match on message text', () => {
    expect(isAppError(new Error('PASSWORD_CHANGED'), 'PASSWORD_CHANGED')).toBe(false);
  });
});

describe('classifyClientError', () => {
  it.each([
    ['NotAllowedError', 'passkeyCancelled'],
    ['AbortError', 'passkeyCancelled'],
    ['InvalidStateError', 'passkeyAlreadyRegistered'],
    ['NotSupportedError', 'passkeyNotSupported'],
    ['SecurityError', 'passkeyNotSupported'],
  ])('should classify a %s as %s', (name, kind) => {
    expect(classifyClientError(domError(name))).toBe(kind);
  });

  it('should classify a failed fetch as a network error', () => {
    expect(classifyClientError(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('should not classify server errors or unknown failures', () => {
    expect(classifyClientError(new AuthRequestError('x', 'INVALID_CREDENTIALS'))).toBeNull();
    expect(classifyClientError(new Error('anything'))).toBeNull();
    expect(classifyClientError('NotAllowedError')).toBeNull();
  });
});

describe('resolveAuthErrorMessage', () => {
  it('should prefer the translated label for the error code', () => {
    const error = new AuthRequestError('Invalid credentials', 'INVALID_CREDENTIALS');

    expect(
      resolveAuthErrorMessage(error, { INVALID_CREDENTIALS: 'Roviq ID या पासवर्ड गलत है' }),
    ).toBe('Roviq ID या पासवर्ड गलत है');
  });

  it('should fall back to the built-in copy when no label is supplied', () => {
    const error = new AuthRequestError(
      'Challenge expired or not found',
      'PASSKEY_CHALLENGE_EXPIRED',
    );

    expect(resolveAuthErrorMessage(error)).toBe(
      DEFAULT_AUTH_ERROR_LABELS.PASSKEY_CHALLENGE_EXPIRED,
    );
  });

  it('should use the client failure copy for browser errors', () => {
    expect(
      resolveAuthErrorMessage(domError('NotAllowedError'), { passkeyCancelled: 'Closed' }),
    ).toBe('Closed');
  });

  it('should never surface the raw server message for an unknown code', () => {
    const error = new AuthRequestError('relation "users" does not exist', 'SOMETHING_NEW');

    expect(resolveAuthErrorMessage(error, { generic: 'Login failed' })).toBe('Login failed');
    expect(resolveAuthErrorMessage(new Error('stack trace here'))).toBe(
      DEFAULT_AUTH_ERROR_LABELS.generic,
    );
  });

  it('should have built-in copy for every advertised key', () => {
    for (const key of [...AUTH_ERROR_CODES, ...AUTH_CLIENT_ERROR_KINDS]) {
      expect(DEFAULT_AUTH_ERROR_LABELS[key]).not.toBe('');
    }
  });
});
