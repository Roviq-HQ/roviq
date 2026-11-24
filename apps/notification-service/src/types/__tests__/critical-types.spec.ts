import { CRITICAL_NOTIFICATION_TYPES } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { REGULAR_TYPES, type RegularTypeKey, SECRET_TYPES, type SecretTypeKey } from '../registry';

describe('CRITICAL_NOTIFICATION_TYPES', () => {
  it("should list exactly the registry's critical types and every secret type", () => {
    const regularKeys = Object.keys(REGULAR_TYPES) as RegularTypeKey[];
    const secretKeys = Object.keys(SECRET_TYPES) as SecretTypeKey[];
    const fromRegistry = [
      ...regularKeys.filter((key) => REGULAR_TYPES[key].critical),
      ...secretKeys,
    ].sort();

    expect([...CRITICAL_NOTIFICATION_TYPES].sort()).toEqual(fromRegistry);
  });
});
