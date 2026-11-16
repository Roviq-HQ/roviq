import { useAuth } from '@roviq/auth';
import { createMock } from '@roviq/testing';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import account from '../../../../messages/en/account.json';
import { LanguagePreference } from '../language-preference';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@roviq/auth', () => ({ useAuth: vi.fn() }));
vi.mock('@roviq/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/i18n')>()),
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/account',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function setup(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const auth = createMock<ReturnType<typeof useAuth>>({
    user: { id: 'user-1', username: 'test', email: 'test@example.com', scope: 'platform' },
    preferredLocale: 'en',
    isLocaleLoading: false,
    localePreferenceError: false,
    isImpersonated: false,
    savePreferredLocale: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  vi.mocked(useAuth).mockReturnValue(auth);
  render(
    <NextIntlClientProvider locale="en" messages={{ account }}>
      <LanguagePreference />
    </NextIntlClientProvider>,
  );
  return auth;
}

beforeEach(() => vi.clearAllMocks());

describe('LanguagePreference', () => {
  it('should save Hindi and change the current route locale after success', async () => {
    const auth = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId(testIds.accountLocale.select));
    await user.click(screen.getByTestId(testIds.accountLocale.option('hi')));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(account.language.saved));
    expect(auth.savePreferredLocale).toHaveBeenCalledWith('hi');
    expect(replace).toHaveBeenCalledWith('/admin/account', { locale: 'hi' });
  });

  it('should keep the route and saved value when a save fails', async () => {
    setup({ savePreferredLocale: vi.fn().mockRejectedValue(new Error('offline')) });
    const user = userEvent.setup();
    await user.click(screen.getByTestId(testIds.accountLocale.select));
    await user.click(screen.getByTestId(testIds.accountLocale.option('hi')));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(account.language.saveFailed));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId(testIds.accountLocale.select)).toHaveTextContent('English');
  });

  it('should expose a retry when loading fails', async () => {
    const auth = setup({ localePreferenceError: true });
    expect(screen.getByTestId(testIds.accountLocale.select)).toBeDisabled();
    await userEvent.click(screen.getByTestId(testIds.accountLocale.retry));
    expect(auth.reloadPreferredLocale).toHaveBeenCalledTimes(1);
  });

  it('should forbid editing an impersonated account', () => {
    setup({ isImpersonated: true });
    expect(screen.getByTestId(testIds.accountLocale.select)).toBeDisabled();
    expect(screen.getByText(account.language.impersonating)).toBeInTheDocument();
  });
});
