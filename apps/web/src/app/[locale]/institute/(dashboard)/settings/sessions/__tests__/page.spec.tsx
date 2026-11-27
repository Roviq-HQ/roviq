import '@testing-library/jest-dom/vitest';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ isImpersonated: false }));
const useSessionsMock = vi.hoisted(() => vi.fn());
vi.mock('@roviq/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/auth')>()),
  useAuth: () => authState,
  useSessions: useSessionsMock,
  createAuthMutations: () => ({ mySessions: {}, revokeSession: {}, revokeAllOtherSessions: {} }),
}));

import accountMessages from '../../../../../../../../messages/en/account.json';
import sessionsMessages from '../../../../../../../../messages/en/sessions.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import InstituteSessionsPage from '../page';

const messages = { account: accountMessages, sessions: sessionsMessages };

describe('InstituteSessionsPage', () => {
  beforeEach(() => {
    authState.isImpersonated = false;
    useSessionsMock.mockReset().mockReturnValue({
      sessions: [
        {
          id: 'session-1',
          deviceInfo: 'Laptop',
          ipAddress: '203.0.113.7',
          createdAt: '2026-11-27T08:00:00.000Z',
          isCurrent: true,
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllOtherSessions: vi.fn(),
    });
  });

  it('lists the signed-in devices for the account owner', () => {
    renderWithProviders(<InstituteSessionsPage />, { messages });

    expect(screen.getByTestId(testIds.sessions.item)).toHaveTextContent('203.0.113.7');
    expect(screen.queryByTestId(testIds.ownAccountNotice.notice)).not.toBeInTheDocument();
  });

  it('shows the owner-only notice in a support session and asks for no sessions', () => {
    authState.isImpersonated = true;
    renderWithProviders(<InstituteSessionsPage />, { messages });

    const notice = screen.getByTestId(testIds.ownAccountNotice.notice);
    expect(notice).toHaveTextContent(accountMessages.ownAccountNotice.title);
    expect(notice).toHaveTextContent(accountMessages.ownAccountNotice.nextStep);
    expect(screen.queryByTestId(testIds.sessions.item)).not.toBeInTheDocument();
    expect(useSessionsMock).not.toHaveBeenCalled();
  });
});
