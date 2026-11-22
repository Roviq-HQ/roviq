import { useAuth } from '@roviq/auth';
import { createMock } from '@roviq/testing';
import { renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import account from '../../../messages/en/account.json';
import { useLocaleChange } from '../use-locale-change';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@roviq/auth', () => ({ useAuth: vi.fn() }));
vi.mock('@roviq/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/i18n')>()),
  useRouter: () => ({ replace }),
  usePathname: () => '/institute/dashboard',
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => account.language[key as keyof typeof account.language],
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function setup(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const save = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useAuth).mockReturnValue(
    createMock<ReturnType<typeof useAuth>>({
      user: { id: 'user-1', username: 'test', email: 'test@example.com', scope: 'institute' },
      isImpersonated: false,
      savePreferredLocale: save,
      ...overrides,
    }),
  );
  return { save, ...renderHook(() => useLocaleChange()) };
}

describe('useLocaleChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/en/institute/dashboard?tab=a#b');
  });

  it('should save the account preference and then navigate for a signed-in user', async () => {
    const { save, result } = setup();

    await result.current('hi');

    expect(save).toHaveBeenCalledWith('hi');
    expect(replace).toHaveBeenCalledWith('/institute/dashboard?tab=a#b', { locale: 'hi' });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]);
  });

  it('should navigate without saving while impersonating', async () => {
    const { save, result } = setup({ isImpersonated: true });

    await result.current('hi');

    expect(save).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/institute/dashboard?tab=a#b', { locale: 'hi' });
  });

  it('should navigate without saving when signed out', async () => {
    const { save, result } = setup({ user: null });

    await result.current('hi');

    expect(save).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('should show the failure toast and not navigate when saving fails', async () => {
    const { result } = setup({ savePreferredLocale: vi.fn().mockRejectedValue(new Error('x')) });

    await result.current('hi');

    expect(toast.error).toHaveBeenCalledWith(account.language.saveFailed);
    expect(replace).not.toHaveBeenCalled();
  });
});
