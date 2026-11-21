import '@testing-library/jest-dom/vitest';
import { AuthProvider, AuthRequestError, createScopedTokenStorage } from '@roviq/auth';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../messages/en/auth.json';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { ForcedPasswordChange } from '../forced-password-change';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/change-password',
  useSearchParams: () => new URLSearchParams(),
}));

const copy = messagesEn.forcedPasswordChange;
const ids = testIds.forcedPasswordChange;

function liveAccessToken(mustChangePassword: boolean): string {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, mustChangePassword }),
  );
  return `header.${payload}.signature`;
}

function renderScreen(changePassword = vi.fn().mockResolvedValue(true)) {
  const logout = vi.fn().mockResolvedValue(undefined);
  const unused = vi.fn().mockRejectedValue(new Error('not used in this test'));
  renderWithProviders(
    <AuthProvider
      scope="institute"
      getPreferredLocale={vi.fn().mockResolvedValue(null)}
      savePreferredLocaleMutation={vi.fn().mockResolvedValue(null)}
      loginMutation={unused}
      selectInstituteMutation={unused}
      refreshMutation={unused}
      changePasswordMutation={changePassword}
      logoutMutation={logout}
    >
      <ForcedPasswordChange />
    </AuthProvider>,
  );
  return { changePassword, logout };
}

function storeSession(mustChangePassword: boolean): string {
  const storage = createScopedTokenStorage('institute');
  const accessToken = liveAccessToken(mustChangePassword);
  storage.setTokens({ accessToken, refreshToken: 'r-1' });
  storage.setUser({
    id: 'u-1',
    username: 'admin@x.test',
    email: 'admin@x.test',
    scope: 'institute',
  });
  return accessToken;
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(copy.currentPassword), 'Temp-Password-1');
  await userEvent.type(screen.getByLabelText(messagesEn.passwordChange.newPassword), 'New-Pass-2x');
  await userEvent.type(
    screen.getByLabelText(messagesEn.passwordChange.confirmPassword),
    'New-Pass-2x',
  );
  await userEvent.click(screen.getByRole('button', { name: messagesEn.passwordChange.submit }));
}

describe('ForcedPasswordChange', () => {
  beforeEach(() => {
    replace.mockReset();
  });

  afterEach(() => {
    cleanup();
    createScopedTokenStorage('institute').clear();
    vi.useRealTimers();
  });

  it('asks a flagged session for the temporary and the new password', async () => {
    storeSession(true);
    renderScreen();

    expect(await screen.findByTestId(ids.title)).toHaveTextContent(copy.title);
    expect(screen.getByLabelText(copy.currentPassword)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps submit disabled and names the missing rule for a password without a digit', async () => {
    storeSession(true);
    const { changePassword } = renderScreen();
    await screen.findByTestId(ids.title);

    await userEvent.type(screen.getByLabelText(copy.currentPassword), 'Temp-Password-1');
    await userEvent.type(
      screen.getByLabelText(messagesEn.passwordChange.newPassword),
      'abcdefghIJ',
    );
    await userEvent.type(
      screen.getByLabelText(messagesEn.passwordChange.confirmPassword),
      'abcdefghIJ',
    );

    const submit = screen.getByRole('button', { name: messagesEn.passwordChange.submit });
    await waitFor(() => expect(submit).toBeDisabled());
    expect(screen.getByText(messagesEn.passwordChange.numberError)).toBeInTheDocument();
    expect(screen.getByText(messagesEn.passwordChange.reqNumber).closest('li')).toHaveAttribute(
      'data-met',
      'false',
    );
    expect(screen.getByText(messagesEn.passwordChange.reqMinLength).closest('li')).toHaveAttribute(
      'data-met',
      'true',
    );
    await userEvent.click(submit);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('changes the password, confirms, and then sends the user to sign in', async () => {
    const accessToken = storeSession(true);
    const { changePassword } = renderScreen();
    await screen.findByTestId(ids.title);

    await fillAndSubmit();

    expect(changePassword).toHaveBeenCalledWith('Temp-Password-1', 'New-Pass-2x', accessToken);
    expect(await screen.findByTestId(ids.success)).toHaveTextContent(copy.successTitle);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'), { timeout: 6000 });
  });

  it.each([
    ['CURRENT_PASSWORD_INCORRECT', messagesEn.errors.CURRENT_PASSWORD_INCORRECT],
    ['PASSWORD_UNCHANGED', messagesEn.errors.PASSWORD_UNCHANGED],
    ['VALIDATION_FAILED', messagesEn.errors.VALIDATION_FAILED],
  ])('shows translated copy for %s and stays on the screen', async (code, message) => {
    storeSession(true);
    renderScreen(vi.fn().mockRejectedValue(new AuthRequestError('refused', code)));
    await screen.findByTestId(ids.title);

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByTestId(ids.success)).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('signs out and goes to sign in without showing the confirmation', async () => {
    const accessToken = storeSession(true);
    const { logout } = renderScreen();
    await screen.findByTestId(ids.title);

    await act(() => userEvent.click(screen.getByTestId(ids.signOutBtn)));

    expect(logout).toHaveBeenCalledWith(accessToken, 'r-1');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId(ids.success)).not.toBeInTheDocument();
  });

  it('sends a session that does not need a change to the dashboard', async () => {
    storeSession(false);
    renderScreen();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByTestId(ids.title)).not.toBeInTheDocument();
  });

  it('sends a visitor without a session to sign in', async () => {
    renderScreen();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
