import { describe, expect, it } from 'vitest';
import { coerceRevokedReason } from '../repositories/refresh-token.drizzle-repository';

describe('coerceRevokedReason', () => {
  it.each([
    'ROTATION',
    'USER_INITIATED',
    'PASSWORD_CHANGE',
    'ADMIN_REVOKED',
  ] as const)('keeps the known reason %s', (reason) => {
    expect(coerceRevokedReason(reason)).toBe(reason);
  });

  it('keeps a missing reason missing', () => {
    expect(coerceRevokedReason(null)).toBeNull();
  });

  // The refresh flow cascades on null, so an unclassifiable reason ends every session.
  it.each([
    'user_initiated',
    'rotation',
    'SOMETHING_ELSE',
    '',
  ])('reads the unknown stored value %j as no reason, so the refresh flow cascades', (raw) => {
    expect(coerceRevokedReason(raw)).toBeNull();
  });
});
