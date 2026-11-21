import '@testing-library/jest-dom/vitest';
import { createMock } from '@roviq/testing';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth-context';
import { ProtectedRoute } from '../protected-route';
import { createScopedTokenStorage } from '../token-storage';
import type { AuthUser } from '../types';

const USER: AuthUser = {
  id: 'user-1',
  username: 'first-admin@institute.test',
  email: 'first-admin@institute.test',
  scope: 'institute',
  tenantId: 'tenant-1',
};

/** An unsigned token the provider accepts as "not expired yet". */
function liveAccessToken(claims: { mustChangePassword?: boolean } = {}): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, ...claims }));
  return `header.${payload}.signature`;
}

function RefuseButton() {
  const { markPasswordChangeRequired } = useAuth();
  return (
    <button type="button" onClick={markPasswordChangeRequired}>
      refused
    </button>
  );
}

function renderGuarded(getPreferredLocale = vi.fn().mockResolvedValue(null)) {
  const unused = vi.fn().mockRejectedValue(new Error('not used in this test'));
  render(
    <AuthProvider
      scope="institute"
      getPreferredLocale={getPreferredLocale}
      savePreferredLocaleMutation={vi.fn().mockResolvedValue(null)}
      loginMutation={unused}
      selectInstituteMutation={unused}
      refreshMutation={unused}
      logoutMutation={vi.fn().mockResolvedValue(undefined)}
    >
      <RefuseButton />
      <ProtectedRoute>
        <p>dashboard</p>
      </ProtectedRoute>
    </AuthProvider>,
  );
  return { getPreferredLocale };
}

describe('ProtectedRoute — forced password change', () => {
  let location: Location;

  beforeEach(() => {
    location = createMock<Location>({ pathname: '/dashboard', search: '', href: '/dashboard' });
    vi.spyOn(window, 'location', 'get').mockReturnValue(location);
  });

  afterEach(() => {
    cleanup();
    createScopedTokenStorage('institute').clear();
    vi.restoreAllMocks();
  });

  function storeSession(mustChangePassword: boolean) {
    const storage = createScopedTokenStorage('institute');
    storage.setTokens({
      accessToken: liveAccessToken({ mustChangePassword }),
      refreshToken: 'refresh-token',
    });
    storage.setUser(USER);
  }

  it('withholds every page and sends a flagged session to the change-password screen', async () => {
    storeSession(true);
    const { getPreferredLocale } = renderGuarded();

    await waitFor(() => expect(location.href).toBe('/change-password'));
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
    // No account query is made for a session the server would refuse.
    expect(getPreferredLocale).not.toHaveBeenCalled();
  });

  it('shows the page to a session that does not need a change', async () => {
    storeSession(false);
    renderGuarded();

    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(location.href).toBe('/dashboard');
  });

  it('withholds the page once the server refuses a request with PASSWORD_CHANGE_REQUIRED', async () => {
    storeSession(false);
    renderGuarded();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();

    await act(() => userEvent.click(screen.getByRole('button', { name: 'refused' })));

    await waitFor(() => expect(location.href).toBe('/change-password'));
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });
});
