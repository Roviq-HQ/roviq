import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminImpersonationSessionsPage from '../page';

const hooks = vi.hoisted(() => ({
  useAdminImpersonationSessions: vi.fn(),
  endSession: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('../use-admin-impersonation-sessions', () => ({
  useAdminImpersonationSessions: hooks.useAdminImpersonationSessions,
  useAdminEndImpersonation: () => [hooks.endSession],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ids = testIds.adminImpersonationSessions;

const ACTIVE = {
  id: 's-1',
  impersonatorName: 'admin',
  impersonatorScope: 'platform',
  targetUserName: 'teacher1',
  targetTenantId: 'inst-1',
  targetTenantName: { en: 'Saraswati Vidya Mandir' },
  reason: 'Checking the timetable issue',
  startedAt: '2026-03-06T09:00:00.000Z',
  expiresAt: '2026-03-06T10:00:00.000Z',
  endedAt: null,
  endedReason: null,
  status: 'ACTIVE' as const,
};

const PLATFORM_ADMIN = [{ action: 'manage' as const, subject: 'all' as const }];
const PLATFORM_READER = [{ action: 'read' as const, subject: 'all' as const }];

function mockSessions(sessions: unknown[], extra: { loading?: boolean; error?: Error } = {}) {
  hooks.useAdminImpersonationSessions.mockReturnValue({
    sessions,
    loading: extra.loading ?? false,
    error: extra.error,
    refetch: hooks.refetch,
  });
}

function renderPage(
  options: {
    abilityRules?: typeof PLATFORM_ADMIN | typeof PLATFORM_READER | [];
    search?: string;
  } = {},
) {
  return renderWithProviders(
    <NuqsTestingAdapter searchParams={options.search}>
      <AdminImpersonationSessionsPage />
    </NuqsTestingAdapter>,
    { abilityRules: options.abilityRules ?? PLATFORM_ADMIN },
  );
}

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({ errors: [{ message: 'raw', extensions: { code } }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.refetch.mockResolvedValue(undefined);
});

describe('AdminImpersonationSessionsPage', () => {
  it('asks for active sessions by default and lists them with the scope', () => {
    mockSessions([ACTIVE]);
    renderPage();

    expect(hooks.useAdminImpersonationSessions).toHaveBeenLastCalledWith(true, true);
    const row = screen.getByTestId(ids.row('s-1'));
    expect(row).toHaveTextContent('admin');
    expect(row).toHaveTextContent('Platform');
    expect(row).toHaveTextContent('teacher1');
    expect(screen.getByTestId(ids.statusBadge('s-1'))).toHaveTextContent('Active');
  });

  it('asks for every session when the URL says all', () => {
    mockSessions([{ ...ACTIVE, status: 'ENDED', endedReason: 'revoked' }]);
    renderPage({ search: '?show=all' });

    expect(hooks.useAdminImpersonationSessions).toHaveBeenLastCalledWith(false, true);
    expect(screen.getByTestId(ids.statusBadge('s-1'))).toHaveTextContent('Revoked');
  });

  it('says nobody is viewing as anyone when no session is active', () => {
    mockSessions([]);
    renderPage();

    expect(screen.getByTestId(ids.empty)).toHaveTextContent('No active sessions');
  });

  it('says the load failed instead of showing an empty list', () => {
    mockSessions([], { error: new Error('network down') });
    renderPage();

    expect(screen.getByTestId(ids.loadError)).toHaveTextContent('Could not load the sessions.');
    expect(screen.queryByTestId(ids.empty)).not.toBeInTheDocument();
  });

  it('refuses a role without read AuditLog and does not query', () => {
    mockSessions([]);
    renderPage({ abilityRules: [] });

    expect(screen.getByTestId(ids.accessDenied)).toBeInTheDocument();
    expect(hooks.useAdminImpersonationSessions).toHaveBeenLastCalledWith(true, false);
    expect(screen.queryByTestId(ids.showFilter)).not.toBeInTheDocument();
  });

  it('shows sessions to a read-only platform role without Terminate', () => {
    mockSessions([ACTIVE]);
    renderPage({ abilityRules: PLATFORM_READER });

    expect(screen.getByTestId(ids.row('s-1'))).toBeInTheDocument();
    expect(screen.queryByTestId(ids.terminateBtn('s-1'))).not.toBeInTheDocument();
  });

  it('terminates after confirmation, names both people, and re-reads the list', async () => {
    const user = userEvent.setup();
    hooks.endSession.mockResolvedValue({ data: { adminEndImpersonation: true } });
    mockSessions([ACTIVE]);
    renderPage();

    await user.click(screen.getByTestId(ids.terminateBtn('s-1')));
    expect(screen.getByTestId(ids.terminateDialog)).toHaveTextContent(
      "admin will be signed out of teacher1's account immediately.",
    );
    await user.click(screen.getByTestId(ids.terminateConfirm));

    await waitFor(() =>
      expect(hooks.endSession).toHaveBeenCalledWith({ variables: { sessionId: 's-1' } }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Impersonation session terminated.'),
    );
    expect(hooks.refetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId(ids.terminateDialog)).not.toBeInTheDocument());
  });

  it('treats a session that already ended as done, not as a failure', async () => {
    const user = userEvent.setup();
    hooks.endSession.mockRejectedValue(graphQLError('IMPERSONATION_SESSION_INVALID'));
    mockSessions([ACTIVE]);
    renderPage();

    await user.click(screen.getByTestId(ids.terminateBtn('s-1')));
    await user.click(screen.getByTestId(ids.terminateConfirm));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('This session has already ended.'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(hooks.refetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId(ids.terminateDialog)).not.toBeInTheDocument());
  });

  it('keeps the dialog open and explains when the server refuses', async () => {
    const user = userEvent.setup();
    hooks.endSession.mockRejectedValue(graphQLError('FORBIDDEN'));
    mockSessions([ACTIVE]);
    renderPage();

    await user.click(screen.getByTestId(ids.terminateBtn('s-1')));
    await user.click(screen.getByTestId(ids.terminateConfirm));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('You are not allowed to terminate this session.'),
    );
    expect(screen.getByTestId(ids.terminateDialog)).toBeInTheDocument();
  });
});
