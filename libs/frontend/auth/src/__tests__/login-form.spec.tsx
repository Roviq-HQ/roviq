import '@testing-library/jest-dom/vitest';
import { createMock } from '@roviq/testing';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../lib/auth-context';
import { LoginForm } from '../lib/login-form';

vi.mock('../lib/auth-context', () => ({ useAuth: vi.fn() }));

function setup(loading = false) {
  const login = vi.fn().mockResolvedValue(undefined);
  const onSuccess = vi.fn();
  vi.mocked(useAuth).mockReturnValue(
    createMock<ReturnType<typeof useAuth>>({
      login,
      loginWithPasskey: vi.fn(),
      isLoading: loading,
    }),
  );
  render(<LoginForm onSuccess={onSuccess} />);
  return { login, onSuccess };
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

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

  it('should keep the user on the form and display a rejected login', async () => {
    const { login, onSuccess } = setup();
    login.mockRejectedValueOnce(new Error('Invalid credentials'));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'review-user');
    await user.type(screen.getByLabelText('Password'), 'WrongPassword!');
    await user.click(screen.getByRole('button', { name: 'Sign in', exact: true }));

    expect(await screen.findByText('Invalid credentials')).toBeVisible();
    expect(onSuccess).not.toHaveBeenCalled();
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
