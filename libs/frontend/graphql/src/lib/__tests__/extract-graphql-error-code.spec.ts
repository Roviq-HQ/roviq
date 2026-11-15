import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { describe, expect, it } from 'vitest';
import { extractGraphQLErrorCode } from '../extract-graphql-error';

describe('extractGraphQLErrorCode', () => {
  it('should return the first error code', () => {
    const error = new CombinedGraphQLErrors({
      errors: [{ message: 'denied', extensions: { code: 'ATTENDANCE_OVERRIDE_FORBIDDEN' } }],
    });

    expect(extractGraphQLErrorCode(error)).toBe('ATTENDANCE_OVERRIDE_FORBIDDEN');
  });

  it('should return null without a string code', () => {
    const error = new CombinedGraphQLErrors({ errors: [{ message: 'denied' }] });

    expect(extractGraphQLErrorCode(error)).toBeNull();
    expect(extractGraphQLErrorCode(new Error('network'))).toBeNull();
  });
});
