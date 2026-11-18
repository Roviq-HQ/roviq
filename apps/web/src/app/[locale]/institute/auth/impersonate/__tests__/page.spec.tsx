import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import {
  IMPERSONATION_TOKEN_KEY,
  readImpersonatedUser,
} from '@web/components/impersonation/impersonation-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImpersonatePage from '../page';
import { ExchangeImpersonationCodeDocument } from '../page.generated';

const nav = vi.hoisted(() => ({ code: 'one-time-code' as string | null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.code ? { code: nav.code } : {}),
}));

const exchanged = {
  request: { query: ExchangeImpersonationCodeDocument, variables: { code: 'one-time-code' } },
  result: {
    data: {
      exchangeImpersonationCode: {
        __typename: 'ImpersonationAuthPayload',
        accessToken: 'impersonation-token',
        user: {
          __typename: 'ImpersonationUserInfo',
          id: 'user-1',
          username: 'teacher1',
          firstName: { en: 'Rajesh' },
          lastName: { en: 'Sharma' },
        },
      },
    },
  },
};

let replaceSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nav.code = 'one-time-code';
  sessionStorage.clear();
  replaceSpy = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace: replaceSpy });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Impersonation code exchange page', () => {
  it('stores the session in this tab and reloads into the dashboard', async () => {
    renderWithProviders(<ImpersonatePage />, { apolloMocks: [exchanged] });

    // A full load, so the tab drops whatever session it restored before the exchange.
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/en/dashboard'));
    expect(sessionStorage.getItem(IMPERSONATION_TOKEN_KEY)).toBe('impersonation-token');
    expect(readImpersonatedUser()).toEqual({
      username: 'teacher1',
      firstName: { en: 'Rajesh' },
      lastName: { en: 'Sharma' },
    });
  });

  it('says the code is spent when it was already used, without the server text', async () => {
    renderWithProviders(<ImpersonatePage />, {
      apolloMocks: [
        {
          request: exchanged.request,
          error: new CombinedGraphQLErrors({
            errors: [
              { message: 'raw server text', extensions: { code: 'IMPERSONATION_CODE_EXPIRED' } },
            ],
          }),
        },
      ],
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Code expired or invalid.');
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(IMPERSONATION_TOKEN_KEY)).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('explains a missing code', async () => {
    nav.code = null;
    renderWithProviders(<ImpersonatePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('No impersonation code provided.');
  });
});
