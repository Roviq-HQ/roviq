import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import type { AuditColumnKey } from '../audit-log-columns';
import { AuditLogTable, type AuditLogTableProps } from '../audit-log-table';
import type { AuditLogRow } from '../audit-utils';

const { auditLogs } = testIds;

const STUDENT_ID = '019a0000-0000-7000-8000-0000000000aa';
// A prefix no other id of the fixture shares, so a shortened id would be found only as the actor.
const OUTSIDER_ID = '7c1e0000-0000-7000-8000-0000000000bb';

function makeLog(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: 'log-1',
    userId: '019a0000-0000-7000-8000-000000000001',
    actorId: '019a0000-0000-7000-8000-000000000002',
    impersonatorId: null,
    action: 'updateStudent',
    actionType: 'UPDATE',
    entityType: 'Student',
    entityId: STUDENT_ID,
    changes: { firstName: { old: 'Raj', new: 'Rajesh' } },
    metadata: null,
    correlationId: '019a0000-0000-7000-8000-000000000003',
    ipAddress: null,
    userAgent: null,
    source: 'GATEWAY',
    createdAt: '2026-01-05T10:00:00.000Z',
    actorName: 'Asha Verma',
    userName: 'Ravi Kumar',
    ...overrides,
  };
}

const INSTITUTE_COLUMNS: readonly AuditColumnKey[] = [
  'createdAt',
  'actorId',
  'action',
  'actionType',
  'entityType',
  'entityId',
  'changes',
];

function renderTable(overrides: Partial<AuditLogTableProps> = {}, locale: 'en' | 'hi' = 'en') {
  const props: AuditLogTableProps = {
    scope: 'institute',
    columns: INSTITUTE_COLUMNS,
    logs: [makeLog()],
    loading: false,
    totalCount: 1,
    hasNextPage: false,
    loadMore: vi.fn(),
    hasFilters: false,
    onClearFilters: vi.fn(),
    ...overrides,
  };
  renderWithProviders(
    <NuqsTestingAdapter>
      <AuditLogTable {...props} />
    </NuqsTestingAdapter>,
    { locale },
  );
  return props;
}

describe('AuditLogTable', () => {
  it('expands a row to show its old → new diff without opening the detail sheet', async () => {
    const user = userEvent.setup();
    renderTable();

    expect(screen.queryByText('Rajesh')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show changes' }));

    expect(screen.getByText('Raj')).toBeInTheDocument();
    expect(screen.getByText('Rajesh')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no expansion for an entry without changes', () => {
    renderTable({ logs: [makeLog({ changes: null })] });

    expect(screen.queryByRole('button', { name: 'Show changes' })).not.toBeInTheDocument();
  });

  it('links the entity id to its detail page when the portal has one', () => {
    renderTable();

    expect(screen.getByTestId(auditLogs.entityLink('log-1'))).toHaveAttribute(
      'href',
      `/institute/people/students/${STUDENT_ID}`,
    );
  });

  it('shows the full entity id with a copy button when the portal has no page for it', async () => {
    const user = userEvent.setup();
    renderTable({ scope: 'admin' });

    expect(screen.queryByTestId(auditLogs.entityLink('log-1'))).not.toBeInTheDocument();
    expect(screen.getByText(STUDENT_ID)).toBeInTheDocument();
    expect(screen.queryByText(STUDENT_ID.slice(0, 8))).not.toBeInTheDocument();

    await user.click(screen.getByTestId(testIds.copyId.button('log-1', STUDENT_ID)));
    expect(await navigator.clipboard.readText()).toBe(STUDENT_ID);
    // Copying must not open the row's detail sheet.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open the detail sheet when the entity link is clicked', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByTestId(auditLogs.entityLink('log-1')));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the detail sheet with the diff and an entity link on row click', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByText('updateStudent'));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Rajesh')).toBeInTheDocument();
    expect(within(sheet).getByTestId(auditLogs.detailEntityLink)).toHaveAttribute(
      'href',
      `/institute/people/students/${STUDENT_ID}`,
    );
  });

  it("marks a platform action in an institute's own log", () => {
    const log = makeLog({ scope: 'platform' });
    renderTable({ logs: [log] });

    expect(screen.getByTestId(testIds.auditLogs.outsideActorBadge(log.id))).toHaveTextContent(
      'Roviq platform',
    );
  });

  it('marks a reseller action in Hindi too', () => {
    const log = makeLog({ scope: 'reseller' });
    renderTable({ logs: [log] }, 'hi');

    expect(screen.getByTestId(testIds.auditLogs.outsideActorBadge(log.id))).toHaveTextContent(
      'रीसेलर',
    );
  });

  it("puts no marker on the institute's own actions, nor on the platform's own log", () => {
    const own = makeLog({ scope: 'institute' });
    renderTable({ logs: [own] });
    expect(
      screen.queryByTestId(testIds.auditLogs.outsideActorBadge(own.id)),
    ).not.toBeInTheDocument();
  });

  it('names an unnamed platform actor by its side, without repeating the badge', () => {
    const log = makeLog({ scope: 'platform', actorName: null, actorId: OUTSIDER_ID });
    renderTable({ logs: [log] });

    expect(screen.getByText('Roviq platform')).toBeInTheDocument();
    expect(screen.queryByText(OUTSIDER_ID.slice(0, 8))).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(testIds.auditLogs.outsideActorBadge(log.id)),
    ).not.toBeInTheDocument();
  });

  it('names an unnamed reseller actor by its side in a reseller log too, in Hindi', () => {
    renderTable(
      { scope: 'reseller', logs: [makeLog({ scope: 'reseller', actorName: null })] },
      'hi',
    );

    expect(screen.getByText('रीसेलर')).toBeInTheDocument();
  });

  it('calls an unnamed actor in the platform log "Unknown user", with the id to copy', () => {
    const log = makeLog({ scope: 'platform', actorName: null, actorId: OUTSIDER_ID });
    renderTable({ scope: 'admin', logs: [log] }, 'hi');

    expect(screen.getByText('अज्ञात यूज़र')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.copyId.button(log.id, OUTSIDER_ID))).toBeInTheDocument();
    expect(screen.queryByText(OUTSIDER_ID.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.queryByText('Roviq platform')).not.toBeInTheDocument();
  });

  it('gives each row its own copy button when two rows share an unnamed actor', async () => {
    const user = userEvent.setup();
    const first = makeLog({
      id: 'log-1',
      scope: 'platform',
      actorName: null,
      actorId: OUTSIDER_ID,
    });
    const second = makeLog({
      id: 'log-2',
      scope: 'platform',
      actorName: null,
      actorId: OUTSIDER_ID,
    });
    renderTable({ scope: 'admin', logs: [first, second], totalCount: 2 });

    await user.click(screen.getByTestId(testIds.copyId.button(second.id, OUTSIDER_ID)));
    expect(await navigator.clipboard.readText()).toBe(OUTSIDER_ID);
    expect(screen.getByTestId(testIds.copyId.button(first.id, OUTSIDER_ID))).toBeInTheDocument();
  });

  it('translates the impersonation badge', () => {
    renderTable({ logs: [makeLog({ impersonatorId: 'imp-1' })] }, 'hi');

    expect(screen.getByText('Asha Verma ने इम्पर्सोनेट किया')).toBeInTheDocument();
    expect(screen.queryByText(/Impersonated by/)).not.toBeInTheDocument();
  });

  it('translates the collapsed summary of a deleted record', async () => {
    const user = userEvent.setup();
    renderTable(
      {
        logs: [
          makeLog({
            actionType: 'DELETE',
            changes: { firstName: { old: 'Raj', new: null }, lastName: { old: 'K', new: null } },
          }),
        ],
      },
      'hi',
    );

    await user.click(screen.getByRole('button', { name: 'बदलाव दिखाएं' }));

    expect(screen.getByText('2 फ़ील्ड हटाए गए')).toBeInTheDocument();
  });

  it('adds reseller name and tier columns only when asked for', () => {
    const log = makeLog({ resellerName: 'Northstar Partners', resellerTier: 'READ_ONLY' });
    renderTable({
      scope: 'admin',
      columns: ['createdAt', 'actorId', 'resellerName', 'resellerTier', 'action'],
      logs: [log],
    });

    expect(screen.getByText('Northstar Partners')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('omits reseller columns by default', () => {
    renderTable({ logs: [makeLog({ resellerName: 'Northstar Partners' })] });

    expect(screen.queryByText('Northstar Partners')).not.toBeInTheDocument();
  });

  it('offers to clear filters when filters leave the list empty', async () => {
    const user = userEvent.setup();
    const props = renderTable({ logs: [], totalCount: 0, hasFilters: true });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(props.onClearFilters).toHaveBeenCalledTimes(1);
  });
});
