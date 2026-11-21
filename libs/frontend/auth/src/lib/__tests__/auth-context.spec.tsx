import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth-context';
import { AuthRequestError } from '../error-utils';
import { createScopedTokenStorage } from '../token-storage';
import type { AuthUser } from '../types';

type ProviderProps = ComponentProps<typeof AuthProvider>;

const USER: AuthUser = {
  id: 'user-1',
  username: 'reseller-admin',
  email: 'reseller-admin@roviq.test',
  scope: 'reseller',
};

/** An unsigned token the provider accepts as "not expired yet". */
function liveAccessToken(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }));
  return `header.${payload}.signature`;
}

function RefreshButton() {
  const { refreshSession } = useAuth();
  return (
    <button type="button" onClick={() => refreshSession().catch(() => undefined)}>
      refresh
    </button>
  );
}

function renderProvider(refreshMutation: ProviderProps['refreshMutation']) {
  const unused = vi.fn().mockRejectedValue(new Error('not used in this test'));
  return render(
    <AuthProvider
      scope="reseller"
      getPreferredLocale={vi.fn().mockResolvedValue(null)}
      savePreferredLocaleMutation={vi.fn().mockResolvedValue(null)}
      loginMutation={unused}
      selectInstituteMutation={unused}
      refreshMutation={refreshMutation}
      logoutMutation={vi.fn().mockResolvedValue(undefined)}
    >
      <RefreshButton />
    </AuthProvider>,
  );
}

describe('AuthProvider — refreshSession', () => {
  beforeEach(() => {
    const storage = createScopedTokenStorage('reseller');
    storage.setTokens({ accessToken: liveAccessToken(), refreshToken: 'refresh-token' });
    storage.setUser(USER);
  });

  afterEach(() => {
    cleanup();
    createScopedTokenStorage('reseller').clear();
  });

  it('opens the session-expired dialog when the server rejects the session', async () => {
    renderProvider(
      vi.fn().mockRejectedValue(new AuthRequestError('Refresh token revoked', 'SESSION_EXPIRED')),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Session Expired');
  });

  it('does not open the dialog when the request never reached the server', async () => {
    const refreshMutation = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    renderProvider(refreshMutation);

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => expect(refreshMutation).toHaveBeenCalledWith('refresh-token'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function SessionProbe() {
  const { isAuthenticated, sessionRestores, verifySession, refreshSession } = useAuth();
  const [verified, setVerified] = React.useState<string>('pending');
  return (
    <>
      <p data-testid="authenticated">{String(isAuthenticated)}</p>
      <p data-testid="restores">{sessionRestores}</p>
      <p data-testid="verified">{verified}</p>
      <button type="button" onClick={() => verifySession().then((ok) => setVerified(String(ok)))}>
        verify
      </button>
      <button type="button" onClick={() => refreshSession().catch(() => undefined)}>
        refresh
      </button>
    </>
  );
}

function renderProbe(props: Partial<ProviderProps>) {
  const unused = vi.fn().mockRejectedValue(new Error('not used in this test'));
  const getPreferredLocale = vi.fn().mockResolvedValue(null);
  render(
    <AuthProvider
      scope="reseller"
      getPreferredLocale={getPreferredLocale}
      savePreferredLocaleMutation={vi.fn().mockResolvedValue(null)}
      loginMutation={unused}
      selectInstituteMutation={unused}
      refreshMutation={unused}
      logoutMutation={vi.fn().mockResolvedValue(undefined)}
      {...props}
    >
      <SessionProbe />
    </AuthProvider>,
  );
  return { getPreferredLocale };
}

const REVOKED = new AuthRequestError('Refresh token revoked', 'SESSION_EXPIRED');

describe('AuthProvider — verifySession', () => {
  beforeEach(() => {
    const storage = createScopedTokenStorage('reseller');
    storage.setTokens({ accessToken: liveAccessToken(), refreshToken: 'refresh-token' });
    storage.setUser(USER);
  });

  afterEach(() => {
    cleanup();
    createScopedTokenStorage('reseller').clear();
  });

  it('clears a stored session the server no longer accepts, without the dialog', async () => {
    renderProbe({ refreshMutation: vi.fn().mockRejectedValue(REVOKED) });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');

    await userEvent.click(screen.getByRole('button', { name: 'verify' }));

    await waitFor(() => expect(screen.getByTestId('verified')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(createScopedTokenStorage('reseller').getAccessToken()).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps and rotates a stored session the server accepts', async () => {
    const refreshMutation = vi.fn().mockResolvedValue({
      accessToken: liveAccessToken(),
      refreshToken: 'rotated',
      user: USER,
    });
    renderProbe({ refreshMutation });

    await userEvent.click(screen.getByRole('button', { name: 'verify' }));

    await waitFor(() => expect(screen.getByTestId('verified')).toHaveTextContent('true'));
    expect(refreshMutation).toHaveBeenCalledWith('refresh-token');
    expect(createScopedTokenStorage('reseller').getRefreshToken()).toBe('rotated');
  });

  it('does not ask the server again for a session it has just verified', async () => {
    const refreshMutation = vi.fn().mockResolvedValue({
      accessToken: liveAccessToken(),
      refreshToken: 'rotated',
      user: USER,
    });
    renderProbe({ refreshMutation });

    await userEvent.click(screen.getByRole('button', { name: 'verify' }));
    await waitFor(() => expect(screen.getByTestId('verified')).toHaveTextContent('true'));
    await userEvent.click(screen.getByRole('button', { name: 'verify' }));

    expect(refreshMutation).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider — signing back in from the session-expired dialog', () => {
  beforeEach(() => {
    const storage = createScopedTokenStorage('reseller');
    storage.setTokens({ accessToken: liveAccessToken(), refreshToken: 'refresh-token' });
    storage.setUser(USER);
  });

  afterEach(() => {
    cleanup();
    createScopedTokenStorage('reseller').clear();
  });

  it('counts the restore and loads the account preferences again', async () => {
    const loginMutation = vi.fn().mockResolvedValue({
      accessToken: liveAccessToken(),
      refreshToken: 'new-refresh',
      user: USER,
    });
    const { getPreferredLocale } = renderProbe({
      refreshMutation: vi.fn().mockRejectedValue(REVOKED),
      loginMutation,
    });
    await waitFor(() => expect(getPreferredLocale).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Password'), 'Secret-123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('restores')).toHaveTextContent('1'));
    expect(loginMutation).toHaveBeenCalledWith({ username: USER.username, password: 'Secret-123' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(getPreferredLocale).toHaveBeenCalledTimes(2));
  });
});
