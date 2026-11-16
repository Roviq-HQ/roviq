import { useAuth } from '@roviq/auth';
import { createMock } from '@roviq/testing';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountLocaleSync } from '../account-locale-sync';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@roviq/auth', () => ({ useAuth: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@roviq/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/i18n')>()),
  useRouter: () => ({ replace }),
  usePathname: () => '/institute/account',
}));

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue(makeAuth({ user: null, isLoading: false }));
  const reset = render(<AccountLocaleSync />);
  reset.unmount();
  vi.clearAllMocks();
});

function makeAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  return createMock<ReturnType<typeof useAuth>>({
    user: { id: 'user-1', username: 'test', email: 'test@example.com', scope: 'institute' },
    isLoading: false,
    preferredLocale: 'hi',
    isLocaleLoading: false,
    localePreferenceError: false,
    ...overrides,
  });
}

describe('AccountLocaleSync', () => {
  it('should apply the loaded account language once and preserve route state', async () => {
    window.history.replaceState(null, '', '/en/institute/account?tab=profile#language');
    vi.mocked(useAuth).mockReturnValue(makeAuth());
    const { rerender } = render(<AccountLocaleSync />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/institute/account?tab=profile#language', {
        locale: 'hi',
      }),
    );
    rerender(<AccountLocaleSync />);
    expect(replace).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, '', '/');
  });

  it('should wait for the saved preference and skip a failed load', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuth({ isLocaleLoading: true }));
    const { rerender } = render(<AccountLocaleSync />);
    expect(replace).not.toHaveBeenCalled();
    vi.mocked(useAuth).mockReturnValue(makeAuth({ localePreferenceError: true }));
    rerender(<AccountLocaleSync />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('should apply a different account preference after switching accounts', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuth());
    const { rerender } = render(<AccountLocaleSync />);
    vi.mocked(useAuth).mockReturnValue(
      makeAuth({
        user: { id: 'user-2', username: 'other', email: 'other@example.com', scope: 'institute' },
      }),
    );
    rerender(<AccountLocaleSync />);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it('should preserve a temporary locale selection when locale navigation remounts the provider', () => {
    vi.mocked(useAuth).mockReturnValue(makeAuth());
    const first = render(<AccountLocaleSync />);
    expect(replace).toHaveBeenCalledTimes(1);
    first.unmount();
    vi.mocked(useAuth).mockReturnValue(makeAuth({ user: null, isLoading: true }));
    const second = render(<AccountLocaleSync />);
    vi.mocked(useAuth).mockReturnValue(makeAuth());
    second.rerender(<AccountLocaleSync />);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
