/**
 * ROV-144 GAP 2 — institute dropdown on the reseller audit-log filters.
 *
 * Uses real nuqs state via NuqsTestingAdapter so selecting an institute actually
 * writes the tenantId URL param. Institutes come from a mocked useResellerInstitutes.
 * Translations come from the full en bundle (renderWithProviders throws on any
 * missing key, which also asserts the new auditLogs.filters.institute key exists).
 */

import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

vi.mock('../../institutes/use-reseller-institutes', () => ({
  useResellerInstitutes: () => ({
    institutes: [
      { id: 'inst-1', name: { en: 'Greenfield Institute' } },
      { id: 'inst-2', name: { en: 'Riverside Academy' } },
    ],
  }),
}));

import { ResellerAuditLogFilters } from '../audit-log-filters';

function renderFilters(search = '', onUrlUpdate?: (e: UrlUpdateEvent) => void): void {
  renderWithProviders(
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate}>
      <ResellerAuditLogFilters />
    </NuqsTestingAdapter>,
  );
}

describe('ResellerAuditLogFilters — institute filter', () => {
  it('renders the institute filter trigger', () => {
    renderFilters();

    expect(screen.getByTestId(testIds.resellerAudit.instituteFilter)).toBeInTheDocument();
  });

  it('writes tenantId to the URL when an institute is selected', async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderFilters('', onUrlUpdate);

    await user.click(screen.getByTestId(testIds.resellerAudit.instituteFilter));
    await user.click(await screen.findByRole('option', { name: 'Greenfield Institute' }));

    await waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.queryString).toContain('tenantId=inst-1');
    });
  });

  it('shows a clear control once an institute is selected', () => {
    renderFilters('?tenantId=inst-2');

    // The institute filter renders an inline clear (X) button only when set.
    const trigger = screen.getByTestId(testIds.resellerAudit.instituteFilter);
    const group = trigger.closest('div');
    expect(group?.querySelector('button[type="button"]')).toBeTruthy();
  });
});
