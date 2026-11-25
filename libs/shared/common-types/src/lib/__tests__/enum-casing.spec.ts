import { describe, expect, it } from 'vitest';
import * as enums from '../enums';

const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

// Value sets that are not UPPER_SNAKE, with the reason.
const EXCEPTIONS: Record<string, string> = {
  AUTH_SCOPE_VALUES:
    'the JWT scope claim, read by every guard and five CHECK constraints (ROV-227)',
  NOTIFICATION_SKIP_REASON_VALUES:
    'stored in notification_deliveries.skip_reason as lowercase codes',
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
    expect(values.filter((v) => !UPPER_SNAKE.test(v))).toEqual([]);
  });

  it.each(
    Object.keys(EXCEPTIONS),
  )('exception %s still exists and still needs to be one', (name) => {
    const values = tuples.find(([n]) => n === name)?.[1];
    expect(values).toBeDefined();
    expect(values?.some((v) => !UPPER_SNAKE.test(v))).toBe(true);
  });
});
