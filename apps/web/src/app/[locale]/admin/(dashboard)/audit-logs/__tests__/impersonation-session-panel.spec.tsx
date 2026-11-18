import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import { ImpersonationSessionPanel } from '../impersonation-session-panel';

vi.mock('../use-impersonation-sessions', () => ({
  useImpersonationSessions: () => ({
    loading: false,
    sessions: [
      {
        id: 'session-1',
        status: 'ENDED',
        impersonatorScope: 'platform',
        impersonatorName: 'Admin Roviq',
        impersonatorRole: { en: 'institute_admin' },
        targetUserName: 'Rajesh Sharma',
        targetTenantName: { en: 'Saraswati Vidya Mandir' },
        reason: 'Checking the attendance report',
        ipAddress: null,
        startedAt: '2026-11-18T08:00:00.000Z',
        expiresAt: '2026-11-18T09:00:00.000Z',
        endedAt: '2026-11-18T08:10:00.000Z',
        endedReason: 'manual',
        otpVerified: null,
      },
    ],
  }),
}));

vi.mock('../use-audit-logs', () => ({
  useAuditLogs: () => ({ logs: [], loading: false }),
}));

describe('ImpersonationSessionPanel', () => {
  it('shows the impersonator’s role as a readable name, not the stored key', () => {
    renderWithProviders(
      <ImpersonationSessionPanel sessionId="session-1" open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText('Institute admin')).toBeInTheDocument();
    expect(screen.queryByText('institute_admin')).not.toBeInTheDocument();
  });
});
