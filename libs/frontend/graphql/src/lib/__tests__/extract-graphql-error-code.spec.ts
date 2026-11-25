import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { describe, expect, it } from 'vitest';
import { extractGraphQLErrorCode, isNetworkError } from '../extract-graphql-error';
import { NetworkFetchError } from '../network-fetch';

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

describe('isNetworkError', () => {
  it('is true for a tagged fetch failure and a server error response', () => {
    expect(isNetworkError(new NetworkFetchError(new TypeError('Load failed')))).toBe(true);
    expect(
      isNetworkError(
        new ServerError('Bad gateway', {
          response: new Response(null, { status: 502 }),
          bodyText: '',
        }),
      ),
    ).toBe(true);
  });

  it('is false for any plain TypeError, even one worded like a fetch failure', () => {
    expect(
      isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')")),
    ).toBe(false);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('is false for a GraphQL error and a plain error', () => {
    const error = new CombinedGraphQLErrors({ errors: [{ message: 'denied' }] });
    expect(isNetworkError(error)).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });
});
