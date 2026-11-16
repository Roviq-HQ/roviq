import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { testIds } from '../../testing/testid-registry';
import { SessionsPage, type SessionsPageLabels } from '../sessions-page';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const labels: SessionsPageLabels = {
  title: 'Active sessions',
  description: 'Manage sessions',
  revokeAll: 'Revoke other sessions',
  revoking: 'Revoking',
  revoke: 'Revoke',
  loading: 'Loading sessions',
  noSessions: 'No sessions',
  unknownDevice: 'Unknown device',
  unknownIp: 'Unknown IP',
  current: 'Current',
  created: 'Created',
  device: 'Device',
  ip: 'IP address',
  lastUsed: 'Last active',
  unknownLastUsed: 'Not recorded',
  loadError: 'Unable to load sessions',
  revokeError: 'Unable to revoke sessions',
  revoked: 'Session revoked',
  revokedOthers: 'Other sessions revoked',
  retry: 'Retry',
};
const current = {
  id: 'current',
  deviceInfo: 'Current device',
  ipAddress: '127.0.0.1',
  createdAt: '2026-11-16T00:00:00.000Z',
  lastUsedAt: '2026-11-16T01:00:00.000Z',
  isCurrent: true,
};
const other = { ...current, id: 'other', deviceInfo: 'Other device', isCurrent: false };

function setup(overrides: Partial<React.ComponentProps<typeof SessionsPage>> = {}) {
  const props = {
    sessions: [current, other],
    loading: false,
    error: false,
    labels,
    formatDate: (date: string) => date,
    onRevoke: vi.fn().mockResolvedValue(undefined),
    onRevokeAllOther: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<SessionsPage {...props} />);
  return props;
}

describe('SessionsPage', () => {
  it('should identify the current session and offer revocation only for other sessions', () => {
    setup();

    const row = screen.getByRole('row', { name: /Current device/ });
    expect(within(row).getByText('Current')).toBeVisible();
    expect(within(row).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
    expect(within(row).getByText(current.lastUsedAt)).toBeVisible();
    expect(screen.getByTestId(testIds.sessions.revoke(other.id))).toBeEnabled();
  });

  it('should revoke another session and show success feedback', async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId(testIds.sessions.revoke(other.id)));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.revoked));
    expect(props.onRevoke).toHaveBeenCalledWith(other.id);
  });

  it('should handle a rejected revocation and allow retry', async () => {
    const onRevokeAllOther = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(undefined);
    setup({ onRevokeAllOther });
    const button = screen.getByRole('button', { name: labels.revokeAll });

    await userEvent.click(button);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(labels.revokeError, { duration: Infinity }),
    );
    expect(button).toBeEnabled();
    await userEvent.click(button);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.revokedOthers));
    expect(onRevokeAllOther).toHaveBeenCalledTimes(2);
  });

  it('should show a retryable load error instead of the empty state', async () => {
    const props = setup({ error: true, sessions: [] });

    expect(screen.getByRole('alert')).toHaveTextContent(labels.loadError);
    expect(screen.queryByText(labels.noSessions)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.revokeAll })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: labels.retry }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('should disable bulk revocation when only the current session remains', () => {
    setup({ sessions: [current] });

    expect(screen.getByRole('button', { name: labels.revokeAll })).toBeDisabled();
  });
});
