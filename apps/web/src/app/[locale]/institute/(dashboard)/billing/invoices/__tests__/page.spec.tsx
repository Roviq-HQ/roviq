import type { RawRuleOf } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyInvoicesDocument } from '../../use-billing.generated';
import InvoicesPage from '../page';

const { instituteBillingInvoices: ids } = testIds;

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/en/institute/billing/invoices',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

const BASE = {
  __typename: 'InvoiceModel' as const,
  tenantId: 'tenant-1',
  subtotalAmount: '100000',
  taxAmount: '18000',
  paidAmount: '0',
  currency: 'INR',
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-11-30T00:00:00.000Z',
  paidAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const SENT = {
  ...BASE,
  id: 'inv-1',
  invoiceNumber: 'RVQ-2026-00001',
  status: 'SENT' as const,
  totalAmount: '118000',
  dueAt: '2026-12-01T00:00:00.000Z',
};
const PAID = {
  ...BASE,
  id: 'inv-2',
  invoiceNumber: 'RVQ-2026-00002',
  status: 'PAID' as const,
  totalAmount: '236000',
  paidAmount: '236000',
  dueAt: '2026-11-15T00:00:00.000Z',
  paidAt: '2026-11-10T00:00:00.000Z',
};

const mockFor = (invoices: Array<typeof SENT | typeof PAID>, status?: 'PAID') => ({
  request: {
    query: MyInvoicesDocument,
    variables: { filter: status ? { status } : undefined, first: 20, after: undefined },
  },
  result: { data: { myInvoices: invoices } },
});

function renderPage(
  mocks: ReturnType<typeof mockFor>[],
  { search = '', abilityRules }: { search?: string; abilityRules?: RawRuleOf<AppAbility>[] } = {},
) {
  const onUrlUpdate = vi.fn();
  renderWithProviders(
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
      <InvoicesPage />
    </NuqsTestingAdapter>,
    { apolloMocks: mocks, abilityRules },
  );
  return { onUrlUpdate };
}

describe('institute invoices page', () => {
  beforeEach(() => nav.push.mockClear());

  it('renders a row per invoice with number, total and status', async () => {
    renderPage([mockFor([SENT, PAID])]);

    expect(await screen.findByRole('link', { name: 'RVQ-2026-00001' })).toHaveAttribute(
      'href',
      '/billing/invoices/inv-1',
    );
    expect(screen.getByRole('link', { name: 'RVQ-2026-00002' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Paid', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    expect(screen.queryByTestId(ids.loadMore)).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no invoices', async () => {
    renderPage([mockFor([])]);

    const empty = await screen.findByTestId(ids.empty);
    expect(within(empty).getByText('No invoices yet.')).toBeInTheDocument();
  });

  it('sends the status from the URL as a server filter and clears it', async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = renderPage([mockFor([PAID], 'PAID'), mockFor([SENT, PAID])], {
      search: '?status=PAID',
    });

    expect(await screen.findByRole('link', { name: 'RVQ-2026-00002' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'RVQ-2026-00001' })).not.toBeInTheDocument();

    await user.click(screen.getByTestId(ids.clearFilters));

    expect(await screen.findByRole('link', { name: 'RVQ-2026-00001' })).toBeInTheDocument();
    expect(onUrlUpdate).toHaveBeenCalled();
    expect(onUrlUpdate.mock.lastCall?.[0].queryString).toBe('');
  });

  it('navigates to the invoice detail when a row is clicked', async () => {
    const user = userEvent.setup();
    renderPage([mockFor([SENT])]);

    const link = await screen.findByTestId(ids.invoiceLink('inv-1'));
    const row = link.closest('tr');
    if (!row) throw new Error('row not found');
    await user.click(within(row).getByText('Sent'));

    expect(nav.push).toHaveBeenCalledWith('/billing/invoices/inv-1');
  });

  it('shows the access-denied message without invoice read permission', async () => {
    renderPage([], { abilityRules: [{ action: 'read', subject: 'Student' }] });

    expect(await screen.findByTestId(ids.accessDenied)).toHaveTextContent(
      'You do not have permission to view invoices.',
    );
  });
});
