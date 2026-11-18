import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import {
  type ImpersonationSessionRow,
  ImpersonationSessionsTable,
  sessionDisplayStatus,
} from '../impersonation-sessions-table';

const ids = testIds.adminImpersonationSessions;

function session(overrides: Partial<ImpersonationSessionRow>): ImpersonationSessionRow {
  return {
    id: 's-1',
    impersonatorName: 'priya.support',
    impersonatorScope: 'reseller',
    targetUserName: 'teacher1',
    targetTenantName: { en: 'Saraswati Vidya Mandir', hi: 'सरस्वती विद्या मंदिर' },
    reason: 'Parent complaint about attendance marking',
    startedAt: '2026-03-06T09:00:00.000Z',
    expiresAt: '2026-03-06T10:00:00.000Z',
    endedReason: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function renderTable(
  sessions: ImpersonationSessionRow[],
  onTerminate?: (s: ImpersonationSessionRow) => Promise<void>,
) {
  return renderWithProviders(
    <ImpersonationSessionsTable
      sessions={sessions}
      ids={ids}
      showScope
      impersonatorLabel="Started by"
      onTerminate={onTerminate}
      terminateDescription={(s) => `${s.impersonatorName} will be signed out`}
    />,
  );
}

describe('sessionDisplayStatus', () => {
  it.each([
    ['ACTIVE', null, 'ACTIVE'],
    ['ENDED', 'manual', 'ENDED'],
    ['ENDED', 'revoked', 'REVOKED'],
    ['EXPIRED', 'expired', 'EXPIRED'],
  ] as const)('%s ended by %s reads as %s', (status, endedReason, expected) => {
    expect(sessionDisplayStatus({ status, endedReason })).toBe(expected);
  });
});

describe('ImpersonationSessionsTable', () => {
  it('shows who, as whom, where, why, when and the scope they acted from', () => {
    renderTable([session({})], vi.fn());

    const row = screen.getByTestId(ids.row('s-1'));
    expect(row).toHaveTextContent('priya.support');
    expect(row).toHaveTextContent('Reseller');
    expect(row).toHaveTextContent('teacher1');
    expect(row).toHaveTextContent('Saraswati Vidya Mandir');
    expect(row).toHaveTextContent('Parent complaint about attendance marking');
    expect(row).toHaveTextContent('06/03/2026');
    expect(screen.getByTestId(ids.statusBadge('s-1'))).toHaveTextContent('Active');
    expect(screen.getByRole('columnheader', { name: 'Started by' })).toBeInTheDocument();
  });

  it('labels a session someone else cut short as Revoked', () => {
    renderTable([
      session({ id: 's-2', status: 'ENDED', endedReason: 'revoked' }),
      session({ id: 's-3', status: 'ENDED', endedReason: 'manual' }),
      session({ id: 's-4', status: 'EXPIRED', endedReason: 'expired' }),
    ]);

    expect(screen.getByTestId(ids.statusBadge('s-2'))).toHaveTextContent('Revoked');
    expect(screen.getByTestId(ids.statusBadge('s-3'))).toHaveTextContent('Ended');
    expect(screen.getByTestId(ids.statusBadge('s-4'))).toHaveTextContent('Expired');
  });

  it('offers Terminate on active sessions only', () => {
    renderTable(
      [session({}), session({ id: 's-2', status: 'ENDED', endedReason: 'manual' })],
      vi.fn(),
    );

    expect(screen.getByTestId(ids.terminateBtn('s-1'))).toBeInTheDocument();
    expect(screen.queryByTestId(ids.terminateBtn('s-2'))).not.toBeInTheDocument();
  });

  it('has no Terminate at all for a viewer who may not end sessions', () => {
    renderTable([session({})]);

    expect(screen.queryByTestId(ids.terminateBtn('s-1'))).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('asks first, naming the session, then terminates and closes', async () => {
    const user = userEvent.setup();
    const onTerminate = vi.fn().mockResolvedValue(undefined);
    renderTable([session({})], onTerminate);

    await user.click(screen.getByTestId(ids.terminateBtn('s-1')));
    const dialog = screen.getByTestId(ids.terminateDialog);
    expect(dialog).toHaveTextContent('priya.support will be signed out');
    expect(onTerminate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByTestId(ids.terminateConfirm));

    await waitFor(() => expect(onTerminate).toHaveBeenCalledWith(session({})));
    await waitFor(() => expect(screen.queryByTestId(ids.terminateDialog)).not.toBeInTheDocument());
  });

  it('keeps the confirmation open when terminating fails', async () => {
    const user = userEvent.setup();
    const onTerminate = vi.fn().mockRejectedValue(new Error('refused'));
    renderTable([session({})], onTerminate);

    await user.click(screen.getByTestId(ids.terminateBtn('s-1')));
    await user.click(screen.getByTestId(ids.terminateConfirm));

    await waitFor(() => expect(onTerminate).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId(ids.terminateDialog)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(ids.terminateConfirm)).toBeEnabled());
  });

  it('cancels without terminating', async () => {
    const user = userEvent.setup();
    const onTerminate = vi.fn();
    renderTable([session({})], onTerminate);

    await user.click(screen.getByTestId(ids.terminateBtn('s-1')));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onTerminate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId(ids.terminateDialog)).not.toBeInTheDocument());
  });
});
