import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImpersonationBanner } from '../impersonation-banner';
import {
  IMPERSONATION_TOKEN_KEY,
  readImpersonatedUser,
  storeImpersonation,
} from '../impersonation-storage';
import { EndOwnImpersonationDocument } from '../use-impersonation-session.generated';

const auth = vi.hoisted(() => ({ impersonationEnded: false }));
vi.mock('@roviq/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/auth')>()),
  useAuth: () => ({ impersonationEnded: auth.impersonationEnded }),
}));

const SESSION_ID = 'session-1';

function token(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, ...claims }));
  return `header.${payload}.signature`;
}

const endMock = (onCall: () => void) => ({
  request: { query: EndOwnImpersonationDocument, variables: { sessionId: SESSION_ID } },
  result: () => {
    onCall();
    return { data: { endImpersonation: true } };
  },
});

let closeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  auth.impersonationEnded = false;
  sessionStorage.clear();
  closeSpy = vi.fn();
  vi.stubGlobal('close', closeSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImpersonationBanner', () => {
  it('renders nothing in a normal session', () => {
    renderWithProviders(<ImpersonationBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names the impersonated person in the current language', () => {
    storeImpersonation(token({ isImpersonated: true }), {
      username: 'teacher1',
      firstName: { en: 'Rajesh', hi: 'राजेश' },
      lastName: { en: 'Sharma', hi: 'शर्मा' },
    });

    renderWithProviders(<ImpersonationBanner />, { locale: 'hi' });

    expect(screen.getByRole('status')).toHaveTextContent('राजेश शर्मा');
  });

  it('falls back to the username when the person has no profile name', () => {
    storeImpersonation(token({ isImpersonated: true }), {
      username: 'teacher1',
      firstName: null,
      lastName: null,
    });

    renderWithProviders(<ImpersonationBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('You are viewing as teacher1');
  });

  it('marks a view-only session and says what that means', () => {
    storeImpersonation(token({ isImpersonated: true, impersonationReadOnly: true }), {
      username: 'teacher1',
      firstName: null,
      lastName: null,
    });

    renderWithProviders(<ImpersonationBanner />);

    const badge = screen.getByTestId('impersonation-view-only-badge');
    expect(badge).toHaveTextContent('View only');
    expect(badge).toHaveAttribute(
      'title',
      'You can look around as this user, but this session cannot change anything.',
    );
  });

  it('shows no view-only mark on a session that may write', () => {
    storeImpersonation(token({ isImpersonated: true }), {
      username: 'teacher1',
      firstName: null,
      lastName: null,
    });

    renderWithProviders(<ImpersonationBanner />);

    expect(screen.queryByTestId('impersonation-view-only-badge')).not.toBeInTheDocument();
  });

  it('ends the session on the server before leaving, then drops the token', async () => {
    sessionStorage.setItem(
      IMPERSONATION_TOKEN_KEY,
      token({ isImpersonated: true, impersonationSessionId: SESSION_ID }),
    );
    const ended = vi.fn();
    renderWithProviders(<ImpersonationBanner />, { apolloMocks: [endMock(ended)] });

    await userEvent.click(screen.getByRole('button', { name: 'Exit Impersonation' }));

    await waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Impersonation session ended.',
    );
    expect(sessionStorage.getItem(IMPERSONATION_TOKEN_KEY)).toBeNull();
    expect(readImpersonatedUser()).toBeNull();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('shows the ended notice when the server has ended the session', () => {
    sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token({ isImpersonated: true }));
    auth.impersonationEnded = true;

    renderWithProviders(<ImpersonationBanner />);

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Impersonation session ended.');
    expect(sessionStorage.getItem(IMPERSONATION_TOKEN_KEY)).toBeNull();
  });
});
