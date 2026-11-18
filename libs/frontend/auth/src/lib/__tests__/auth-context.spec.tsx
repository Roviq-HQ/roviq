import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
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
