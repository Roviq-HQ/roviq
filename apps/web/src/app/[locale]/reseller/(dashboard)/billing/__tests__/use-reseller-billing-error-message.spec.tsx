import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import billing from '../../../../../../../messages/en/billing.json';
import { useResellerBillingErrorMessage } from '../use-reseller-billing-error-message';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ billing }}>
      {children}
    </NextIntlClientProvider>
  );
}

const graphqlError = (code: string) =>
  new CombinedGraphQLErrors({
    data: null,
    errors: [{ message: 'raw server message', extensions: { code } }],
  });

describe('useResellerBillingErrorMessage', () => {
  it('returns the translated copy for a known code, never the server message', () => {
    const { result } = renderHook(() => useResellerBillingErrorMessage(), { wrapper });

    expect(result.current(graphqlError('PAYMENT_NOT_FOUND'))).toBe(
      billing.errors.PAYMENT_NOT_FOUND,
    );
  });

  it('uses the caller fallback for an unknown code', () => {
    const { result } = renderHook(() => useResellerBillingErrorMessage(), { wrapper });

    expect(result.current(graphqlError('SOMETHING_NEW'), 'Failed to issue refund.')).toBe(
      'Failed to issue refund.',
    );
  });

  it('uses the generic copy when there is no code and no fallback', () => {
    const { result } = renderHook(() => useResellerBillingErrorMessage(), { wrapper });

    expect(result.current(new Error('boom'))).toBe(billing.errors.generic);
  });
});
