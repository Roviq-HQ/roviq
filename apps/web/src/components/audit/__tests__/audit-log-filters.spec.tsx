import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { AuditLogFilters, type AuditLogFiltersProps } from '../audit-log-filters';

const { auditLogs } = testIds;

const INSTITUTES = [
  { id: 'inst-1', name: { en: 'Greenfield Institute' } },
  { id: 'inst-2', name: { en: 'Riverside Academy' } },
];

function renderFilters(
  props: AuditLogFiltersProps,
  search = '',
  onUrlUpdate?: (e: UrlUpdateEvent) => void,
): void {
  renderWithProviders(
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate}>
      <AuditLogFilters {...props} />
    </NuqsTestingAdapter>,
  );
}

function lastQuery(onUrlUpdate: ReturnType<typeof vi.fn>): string {
  const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
  return decodeURIComponent(last?.queryString ?? '');
}

describe('AuditLogFilters — action type multi-select', () => {
  it('writes every selected action type to the URL', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderFilters({ scope: 'institute' }, '?actionType=DELETE', onUrlUpdate);

    await user.click(screen.getByTestId(auditLogs.actionTypeFilter));
    await user.click(await screen.findByRole('checkbox', { name: 'Suspend' }));

    await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('actionType=DELETE,SUSPEND'));
  });

  it('shows how many action types are selected', () => {
    renderFilters({ scope: 'institute' }, '?actionType=DELETE,SUSPEND');

    expect(screen.getByTestId(auditLogs.actionTypeFilter)).toHaveTextContent('2 types selected');
  });

  it('removes the URL param when the last action type is unchecked', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderFilters({ scope: 'institute' }, '?actionType=DELETE', onUrlUpdate);

    await user.click(screen.getByTestId(auditLogs.actionTypeFilter));
    await user.click(await screen.findByRole('checkbox', { name: 'Delete' }));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(lastQuery(onUrlUpdate)).not.toContain('actionType');
  });
});

describe('AuditLogFilters — entity ID search', () => {
  it('rejects a value that is not a UUID', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderFilters({ scope: 'admin' }, '', onUrlUpdate);

    await user.type(screen.getByTestId(auditLogs.entityIdSearch), 'not-a-uuid{Enter}');

    expect(screen.getByText('Please enter a valid UUID')).toBeInTheDocument();
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });
});

describe('AuditLogFilters — institute filter', () => {
  it('is hidden when the portal passes no institutes', () => {
    renderFilters({ scope: 'institute' });

    expect(screen.queryByTestId(auditLogs.instituteFilter)).not.toBeInTheDocument();
  });

  it('writes tenantId to the URL when an institute is selected', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderFilters({ scope: 'reseller', institutes: INSTITUTES }, '', onUrlUpdate);

    await user.click(screen.getByTestId(auditLogs.instituteFilter));
    await user.click(await screen.findByRole('option', { name: 'Greenfield Institute' }));

    await waitFor(() => expect(lastQuery(onUrlUpdate)).toContain('tenantId=inst-1'));
  });

  it('clears the selected institute', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderFilters({ scope: 'reseller', institutes: INSTITUTES }, '?tenantId=inst-2', onUrlUpdate);

    await user.click(screen.getByTestId(auditLogs.instituteFilterClear));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(lastQuery(onUrlUpdate)).not.toContain('tenantId');
  });
});
