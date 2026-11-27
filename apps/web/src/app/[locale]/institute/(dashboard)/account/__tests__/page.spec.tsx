import '@testing-library/jest-dom/vitest';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ isImpersonated: false }));
vi.mock('@roviq/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/auth')>()),
  useAuth: () => authState,
  createAuthMutations: () => ({
    myPasskeys: {},
    generatePasskeyRegistrationOptions: {},
    verifyPasskeyRegistration: {},
    removePasskey: {},
  }),
  PasskeyManager: () => <p>passkeys of the owner</p>,
  PasswordChangeForm: () => <p>password of the owner</p>,
}));
vi.mock('@web/components/account/email-verification', () => ({
  EmailVerification: () => <p>email of the owner</p>,
}));
vi.mock('@web/components/account/language-preference', () => ({
  LanguagePreference: () => <p>language</p>,
}));
vi.mock('@web/components/display-settings/display-settings-dialog', () => ({
  DisplaySettingsCard: () => <p>display settings</p>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import accountMessages from '../../../../../../../messages/en/account.json';
import authMessages from '../../../../../../../messages/en/auth.json';
import commonMessages from '../../../../../../../messages/en/common.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import AccountPage from '../page';

const messages = { account: accountMessages, auth: authMessages, common: commonMessages };

describe('AccountPage (institute)', () => {
  beforeEach(() => {
    authState.isImpersonated = false;
  });

  it('shows email, passkeys and password to the account owner', () => {
    renderWithProviders(<AccountPage />, { messages });

    expect(screen.getByText('email of the owner')).toBeInTheDocument();
    expect(screen.getByText('passkeys of the owner')).toBeInTheDocument();
    expect(screen.getByText('password of the owner')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.ownAccountNotice.notice)).not.toBeInTheDocument();
  });

  it('replaces them with the owner-only notice in a support session', () => {
    authState.isImpersonated = true;
    renderWithProviders(<AccountPage />, { messages });

    expect(screen.getByTestId(testIds.ownAccountNotice.notice)).toHaveTextContent(
      accountMessages.ownAccountNotice.body,
    );
    expect(screen.queryByText('email of the owner')).not.toBeInTheDocument();
    expect(screen.queryByText('passkeys of the owner')).not.toBeInTheDocument();
    expect(screen.queryByText('password of the owner')).not.toBeInTheDocument();
    // Language and display settings handle a support session themselves.
    expect(screen.getByText('language')).toBeInTheDocument();
    expect(screen.getByText('display settings')).toBeInTheDocument();
  });
});
