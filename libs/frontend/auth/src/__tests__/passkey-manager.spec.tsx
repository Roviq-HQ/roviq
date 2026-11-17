import '@testing-library/jest-dom/vitest';
import { createMock } from '@roviq/testing';
import { startRegistration } from '@simplewebauthn/browser';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/error-utils';
import { PasskeyManager, type PasskeyManagerMutations } from '../lib/passkey-manager';
import type { PasskeyInfo } from '../lib/types';

vi.mock('../lib/auth-context', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: vi.fn() }));

const officeLaptop: PasskeyInfo = {
  id: 'passkey-1',
  name: 'Office laptop',
  deviceType: 'multiDevice',
  backedUp: true,
  registeredAt: '2026-03-10T00:00:00.000Z',
};

function setup(overrides: Partial<PasskeyManagerMutations> = {}) {
  const mutations: PasskeyManagerMutations = {
    myPasskeys: vi.fn().mockResolvedValue([officeLaptop]),
    generateRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
    removePasskey: vi.fn(),
    ...overrides,
  };
  vi.mocked(useAuth).mockReturnValue(
    createMock<ReturnType<typeof useAuth>>({ getAccessToken: () => 'access-token' }),
  );
  render(<PasskeyManager mutations={mutations} formatDate={(date) => date} />);
  return mutations;
}

async function submitAddPasskey() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add passkey' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Confirm your password'), 'CorrectPassword!');
  await user.click(within(dialog).getByRole('button', { name: 'Add passkey' }));
  return dialog;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('PublicKeyCredential', class {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PasskeyManager', () => {
  it('should say the list could not be loaded without leaking the server message', async () => {
    setup({
      myPasskeys: vi.fn().mockRejectedValue(new Error('relation "auth_providers" missing')),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load passkeys');
    expect(screen.queryByText(/auth_providers/)).not.toBeInTheDocument();
  });

  it('should explain why the only sign-in method cannot be removed and keep the passkey listed', async () => {
    const mutations = setup({
      removePasskey: vi
        .fn()
        .mockRejectedValue(
          new AuthRequestError(
            'Cannot remove your only authentication method',
            'PASSKEY_LAST_AUTH_METHOD',
          ),
        ),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Cannot remove your only sign-in method. Add another passkey or a password first.',
    );
    expect(mutations.removePasskey).toHaveBeenCalledWith('passkey-1', 'access-token');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Office laptop')).toBeVisible();
  });

  it('should ask the user to retry when the passkey challenge timed out', async () => {
    vi.mocked(startRegistration).mockResolvedValue(
      createMock<Awaited<ReturnType<typeof startRegistration>>>(),
    );
    setup({
      generateRegistrationOptions: vi.fn().mockResolvedValue({}),
      verifyRegistration: vi
        .fn()
        .mockRejectedValue(
          new AuthRequestError('Challenge expired or not found', 'PASSKEY_CHALLENGE_EXPIRED'),
        ),
    });

    const dialog = await submitAddPasskey();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Passkey verification timed out. Please try again.',
    );
  });

  it('should say the confirmation password is wrong', async () => {
    setup({
      generateRegistrationOptions: vi
        .fn()
        .mockRejectedValue(new AuthRequestError('Invalid password', 'CURRENT_PASSWORD_INCORRECT')),
    });

    const dialog = await submitAddPasskey();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Current password is incorrect.',
    );
    expect(startRegistration).not.toHaveBeenCalled();
  });

  it('should show a calm toast, not an error, when the browser prompt is dismissed', async () => {
    vi.mocked(startRegistration).mockRejectedValue(
      new DOMException('dismissed', 'NotAllowedError'),
    );
    const mutations = setup({ generateRegistrationOptions: vi.fn().mockResolvedValue({}) });

    const dialog = await submitAddPasskey();

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        'Passkey prompt was closed. You can try again or use your password.',
      ),
    );
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(mutations.verifyRegistration).not.toHaveBeenCalled();
  });

  it('should say when this device already holds a passkey for the account', async () => {
    vi.mocked(startRegistration).mockRejectedValue(
      new DOMException('already registered', 'InvalidStateError'),
    );
    setup({ generateRegistrationOptions: vi.fn().mockResolvedValue({}) });

    const dialog = await submitAddPasskey();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This device already has a passkey for your account.',
    );
  });
});
