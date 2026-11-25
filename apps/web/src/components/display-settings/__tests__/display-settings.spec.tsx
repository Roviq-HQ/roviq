import type { MockedProviderProps } from '@apollo/client/testing/react';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@roviq/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/auth')>()),
  useAuth: () => useAuthMock(),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { DisplaySettingsProvider } from '../display-settings-context';
import {
  MyFormHelpModeDocument,
  UpdateMyFormHelpModeDocument,
} from '../display-settings-context.generated';
import { DisplaySettingsCard } from '../display-settings-dialog';

const { displaySettings } = testIds;

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  return store;
}

const readMode = (mode: string, delay = 0) => ({
  request: { query: MyFormHelpModeDocument },
  result: { data: { myFormHelpMode: mode } },
  delay,
});

const signedIn = (id: string, isImpersonated = false) => ({
  user: { id, username: id, email: `${id}@roviq.test`, scope: 'institute' },
  isImpersonated,
  mustChangePassword: false,
});

const option = (mode: string) => screen.getByTestId(displaySettings.modeOption(mode));

function renderCard(mocks: MockedProviderProps['mocks']) {
  return renderWithProviders(
    <DisplaySettingsProvider>
      <DisplaySettingsCard />
    </DisplaySettingsProvider>,
    { apolloMocks: mocks },
  );
}

describe('Display settings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('shows the cached mode while loading, then the server value, and keeps it per account', async () => {
    const store = stubStorage({ 'roviq:form-help-mode:user-a': 'ICON_ONLY' });
    useAuthMock.mockReturnValue(signedIn('user-a'));
    renderCard([readMode('ICON_AND_HINT', 30)]);

    expect(option('ICON_ONLY')).toHaveAttribute('data-state', 'checked');
    await waitFor(() => expect(option('ICON_AND_HINT')).toHaveAttribute('data-state', 'checked'));
    expect(store.get('roviq:form-help-mode:user-a')).toBe('ICON_AND_HINT');
  });

  it('saves a new mode for the signed-in account and updates the preview', async () => {
    const store = stubStorage();
    useAuthMock.mockReturnValue(signedIn('user-a'));
    renderCard([
      readMode('ICON_AND_HINT'),
      {
        request: { query: UpdateMyFormHelpModeDocument, variables: { mode: 'ICON_ONLY' } },
        result: { data: { updateMyFormHelpMode: 'ICON_ONLY' } },
      },
    ]);
    await waitFor(() => expect(option('ICON_AND_HINT')).not.toBeDisabled());
    expect(
      screen.getByText('Leave it blank to get the next number automatically.'),
    ).toBeInTheDocument();

    await userEvent.click(option('ICON_ONLY'));

    await waitFor(() => expect(option('ICON_ONLY')).toHaveAttribute('data-state', 'checked'));
    expect(store.get('roviq:form-help-mode:user-a')).toBe('ICON_ONLY');
    expect(toastMock.success).toHaveBeenCalledWith('Display settings saved');
    expect(
      screen.queryByText('Leave it blank to get the next number automatically.'),
    ).not.toBeInTheDocument();
  });

  it('keeps the last saved choice and offers Retry when saving fails', async () => {
    const store = stubStorage();
    useAuthMock.mockReturnValue(signedIn('user-a'));
    renderCard([
      readMode('ICON_AND_HINT'),
      {
        request: { query: UpdateMyFormHelpModeDocument, variables: { mode: 'ICON_ONLY' } },
        error: new Error('offline'),
      },
    ]);
    await waitFor(() => expect(option('ICON_AND_HINT')).not.toBeDisabled());

    await userEvent.click(option('ICON_ONLY'));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.error.mock.calls[0]?.[1]).toMatchObject({ action: { label: 'Retry' } });
    expect(option('ICON_AND_HINT')).toHaveAttribute('data-state', 'checked');
    expect(store.get('roviq:form-help-mode:user-a')).toBe('ICON_AND_HINT');
  });

  it('ignores a slow answer for the previous account after an account switch', async () => {
    const store = stubStorage();
    useAuthMock.mockReturnValue(signedIn('user-a'));
    const view = renderCard([readMode('ICON_ONLY', 80), readMode('ICON_AND_HINT')]);

    useAuthMock.mockReturnValue(signedIn('user-b'));
    view.rerender(
      <DisplaySettingsProvider>
        <DisplaySettingsCard />
      </DisplaySettingsProvider>,
    );

    await waitFor(() => expect(store.get('roviq:form-help-mode:user-b')).toBe('ICON_AND_HINT'));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(option('ICON_AND_HINT')).toHaveAttribute('data-state', 'checked');
    expect(store.has('roviq:form-help-mode:user-a')).toBe(false);
  });

  it('cannot be changed while impersonating and leaves the account’s browser copy alone', async () => {
    const store = stubStorage({ 'roviq:form-help-mode:user-a': 'ICON_ONLY' });
    useAuthMock.mockReturnValue(signedIn('user-a', true));
    renderCard([readMode('ICON_AND_HINT')]);

    expect(await screen.findByText(/viewing as another person/i)).toBeInTheDocument();
    await waitFor(() => expect(option('ICON_AND_HINT')).toHaveAttribute('data-state', 'checked'));
    expect(option('ICON_ONLY')).toBeDisabled();
    expect(store.get('roviq:form-help-mode:user-a')).toBe('ICON_ONLY');
  });
});
