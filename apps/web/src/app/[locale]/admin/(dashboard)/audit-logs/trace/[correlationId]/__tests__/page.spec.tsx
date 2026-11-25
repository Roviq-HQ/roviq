import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../../__test-utils__/render-with-providers';

const CORRELATION_ID = '01a2b3c4-0000-7000-8000-0000000000c0';
const ACTOR_ID = '7c1e0000-0000-7000-8000-0000000000bb';
const ENTITY_ID = '5e5e0000-0000-7000-8000-0000000000ee';

vi.mock('next/navigation', () => ({
  useParams: () => ({ correlationId: CORRELATION_ID, locale: 'en' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/en/admin/audit-logs/trace/${CORRELATION_ID}`,
}));

const baseLog = {
  id: 'log-1',
  actionType: 'UPDATE',
  action: 'updateInstitute',
  entityType: 'Unmapped',
  entityId: ENTITY_ID,
  actorId: ACTOR_ID,
  actorName: null as string | null,
  impersonatorId: null,
  source: 'GATEWAY',
  createdAt: '2026-05-04T09:00:00.000Z',
};
const state = { logs: [baseLog] };

vi.mock('../../../use-audit-logs', () => ({
  useAuditLogs: () => ({ logs: state.logs, totalCount: state.logs.length, loading: false }),
}));

import CorrelationTracePage from '../page';

describe('CorrelationTracePage ids (ROV-360)', () => {
  it('shows full ids to copy and "Unknown user" for an unnamed actor, never a shortened id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CorrelationTracePage />, { locale: 'hi' });

    expect(screen.getByText('अज्ञात उपयोगकर्ता')).toBeInTheDocument();
    expect(screen.getByText(ENTITY_ID)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(ACTOR_ID.slice(0, 8));

    await user.click(screen.getByTestId(testIds.copyId.button(ACTOR_ID)));
    expect(await navigator.clipboard.readText()).toBe(ACTOR_ID);
    await user.click(screen.getByTestId(testIds.copyId.button(CORRELATION_ID)));
    expect(await navigator.clipboard.readText()).toBe(CORRELATION_ID);
    await user.click(screen.getByTestId(testIds.copyId.button(ENTITY_ID)));
    expect(await navigator.clipboard.readText()).toBe(ENTITY_ID);
  });

  it('shows a named actor by name alone', () => {
    state.logs = [{ ...baseLog, actorName: 'Asha Verma' }];
    renderWithProviders(<CorrelationTracePage />);

    expect(screen.getByText('Asha Verma')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.copyId.button(ACTOR_ID))).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown user')).not.toBeInTheDocument();
  });

  it('links the entity id when the admin portal has a page for it', () => {
    state.logs = [{ ...baseLog, entityType: 'Institute' }];
    renderWithProviders(<CorrelationTracePage />);

    expect(screen.getByTestId(testIds.auditLogs.traceEntityLink(ENTITY_ID))).toHaveAttribute(
      'href',
      `/admin/institutes/${ENTITY_ID}`,
    );
  });
});
