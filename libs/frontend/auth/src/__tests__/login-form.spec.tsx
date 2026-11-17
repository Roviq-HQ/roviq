import '@testing-library/jest-dom/vitest';
import { createMock } from '@roviq/testing';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/error-utils';
import { LoginForm, type LoginFormProps } from '../lib/login-form';

vi.mock('../lib/auth-context', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

function setup(loading = false, labels?: LoginFormProps['labels']) {
  const login = vi.fn().mockResolvedValue(undefined);
  const loginWithPasskey = vi.fn().mockResolvedValue(undefined);
  const onSuccess = vi.fn();
  vi.mocked(useAuth).mockReturnValue(
    createMock<ReturnType<typeof useAuth>>({
      login,
      loginWithPasskey,
      isLoading: loading,
    }),
  );
  render(<LoginForm onSuccess={onSuccess} labels={labels} />);
  return { login, loginWithPasskey, onSuccess };
}

async function submitCredentials() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Username'), 'review-user');
  await user.type(screen.getByLabelText('Password'), 'WrongPassword!');
  await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('PublicKeyCredential', class {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginForm submission', () => {
  it.each(['button', 'enter'])('should authenticate via %s submission', async (method) => {
    const { login, onSuccess } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'review-user');
    await user.type(screen.getByLabelText('Password'), 'ReviewPassword!');

    if (method === 'button')
      await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    else await user.keyboard('{Enter}');

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledExactlyOnceWith({
      username: 'review-user',
      password: 'ReviewPassword!',
    });
  });

  it('should keep the user on the form and explain a rejected login by its error code', async () => {
    const { login, onSuccess } = setup();
    login.mockRejectedValueOnce(new AuthRequestError('Invalid credentials', 'INVALID_CREDENTIALS'));

    await submitCredentials();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Roviq ID or password');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('should show the translated copy supplied for the error code', async () => {
    const { login } = setup(false, { errors: { ACCOUNT_LOCKED: 'खाता 30 मिनट के लिए लॉक है' } });
    login.mockRejectedValueOnce(new AuthRequestError('Too many attempts', 'ACCOUNT_LOCKED'));

    await submitCredentials();

    expect(await screen.findByRole('alert')).toHaveTextContent('खाता 30 मिनट के लिए लॉक है');
  });

  it('should hide raw server messages behind the generic login failure copy', async () => {
    const { login } = setup();
    login.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    await submitCredentials();

    expect(await screen.findByRole('alert')).toHaveTextContent('Login failed. Please try again.');
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
  });

  it('should offer a retry toast instead of an inline error when the network is down', async () => {
    const { login } = setup();
    login.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await submitCredentials();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Could not reach the server. Check your connection and try again.',
        { action: { label: 'Retry', onClick: expect.any(Function) } },
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should validate required fields before calling login', async () => {
    const { login } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));

    expect(await screen.findByText('Username is required')).toBeVisible();
    expect(await screen.findByText('Password is required')).toBeVisible();
    expect(login).not.toHaveBeenCalled();
  });

  it('should disable credential entry and submission while auth is restoring', () => {
    setup(true);

    expect(screen.getByLabelText('Username')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with passkey' })).toBeDisabled();
  });
});

describe('LoginForm passkey sign-in', () => {
  it('should show a calm toast, not an error, when the passkey prompt is dismissed', async () => {
    const { loginWithPasskey, onSuccess } = setup();
    loginWithPasskey.mockRejectedValueOnce(new DOMException('dismissed', 'NotAllowedError'));

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with passkey' }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        'Passkey prompt was closed. You can try again or use your password.',
      ),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('should explain a passkey the server rejected', async () => {
    const { loginWithPasskey } = setup();
    loginWithPasskey.mockRejectedValueOnce(
      new AuthRequestError('Invalid credentials', 'PASSKEY_AUTHENTICATION_FAILED'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with passkey' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Passkey sign-in failed. Try again or use your password.',
    );
  });

  it('should tell the user when the browser has no passkey support', async () => {
    const { loginWithPasskey } = setup();
    vi.stubGlobal('PublicKeyCredential', undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with passkey' }));

    expect(toast.error).toHaveBeenCalledWith(
      'Passkeys are not supported on this browser or device.',
    );
    expect(loginWithPasskey).not.toHaveBeenCalled();
  });
});
