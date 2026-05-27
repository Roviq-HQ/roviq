/**
 * ROV-144 — Component tests for the reseller impersonation sessions page.
 *
 * The data hooks are mocked so this spec focuses on rendering: status badges
 * per session and the Terminate action only being offered for ACTIVE sessions.
 * Real Apollo wiring is covered by e2e.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const SESSIONS = [
  {
    id: 'sess-active',
    impersonatorName: 'Reseller Staff',
    impersonatorScope: 'reseller',
    targetUserName: 'Institute Admin',
    targetTenantId: 'tenant-1',
    targetTenantName: { en: 'Greenfield Institute' },
    reason: 'support request',
    ipAddress: '10.0.0.2',
    startedAt: '2026-01-01T10:00:00Z',
    expiresAt: '2999-01-01T10:00:00Z',
    endedAt: null,
    endedReason: null,
    otpVerified: null,
    status: 'ACTIVE',
  },
  {
    id: 'sess-ended',
    impersonatorName: 'Reseller Staff',
    impersonatorScope: 'reseller',
    targetUserName: 'Teacher',
    targetTenantId: 'tenant-1',
    targetTenantName: { en: 'Greenfield Institute' },
    reason: 'debugging',
    ipAddress: '10.0.0.3',
    startedAt: '2026-01-01T09:00:00Z',
    expiresAt: '2026-01-01T10:00:00Z',
    endedAt: '2026-01-01T09:30:00Z',
    endedReason: 'manual',
    otpVerified: null,
    status: 'ENDED',
  },
];

vi.mock('../use-reseller-impersonation-sessions', () => ({
  useResellerImpersonationSessions: () => ({
    sessions: SESSIONS,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useTerminateImpersonationSession: () => [vi.fn(), { loading: false }],
}));

vi.mock('../../../institutes/use-reseller-institutes', () => ({
  useResellerInstitutes: () => ({ institutes: [], totalCount: 0, loading: false }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { testIds } from '@roviq/ui/testing/testid-registry';
import ResellerImpersonationSessionsPage from '../page';

describe('ResellerImpersonationSessionsPage', () => {
  it('lists sessions with a status badge each', () => {
    renderWithProviders(<ResellerImpersonationSessionsPage />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getAllByText('Reseller Staff')).toHaveLength(2);
  });

  it('offers Terminate only for the active session', () => {
    renderWithProviders(<ResellerImpersonationSessionsPage />);

    expect(
      screen.getByTestId(testIds.resellerImpersonation.terminateBtn('sess-active')),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(testIds.resellerImpersonation.terminateBtn('sess-ended')),
    ).not.toBeInTheDocument();
  });
});
