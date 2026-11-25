import { describe, expect, it } from 'vitest';
import * as enums from '../enums';

// Value sets that are not UPPER_SNAKE on purpose, with the reason.
const EXCEPTIONS: Record<string, string> = {
  // The JWT scope claim, read by every guard and five CHECK constraints (ROV-227).
  AUTH_SCOPE_VALUES: 'auth scope',
  // Lowercase today; not part of ROV-227's decision, open for the owner.
  NOTIFICATION_SKIP_REASON_VALUES: 'notification skip reason',
};

const tuples = Object.entries(enums).filter(
  (entry): entry is [string, readonly string[]] =>
    entry[0].endsWith('_VALUES') && Array.isArray(entry[1]),
);

describe('enum value casing', () => {
  it('finds the value tuples', () => {
    expect(tuples.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'AUTH_EVENT_TYPE_VALUES',
        'REFRESH_TOKEN_REVOKE_REASON_VALUES',
        'CONSENT_PURPOSE_VALUES',
        'CONSENT_VERIFICATION_METHOD_VALUES',
      ]),
    );
  });

  it.each(
    tuples.filter(([name]) => !(name in EXCEPTIONS)),
  )('%s holds only UPPER_SNAKE values', (_name, values) => {
    expect(values.filter((v) => !/^[A-Z][A-Z0-9_]*$/.test(v))).toEqual([]);
  });
});
