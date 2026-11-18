import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

const RESELLER_ID = 'reseller-1';

// EE_ENABLED is read once at module load, so each case imports a fresh copy.
async function loadTab(ee: 'true' | 'false') {
  vi.stubEnv('NEXT_PUBLIC_ROVIQ_EE', ee);
  vi.resetModules();
  const { ResellerBillingTab } = await import('../billing-tab');
  const { AdminResellerBillingDocument } = await import('../billing-tab.generated');
  return { ResellerBillingTab, AdminResellerBillingDocument };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ResellerBillingTab', () => {
  it('shows MRR in rupees, subscriptions, churn and overdue invoices', async () => {
    const { ResellerBillingTab, AdminResellerBillingDocument } = await loadTab('true');
    renderWithProviders(<ResellerBillingTab resellerId={RESELLER_ID} />, {
      apolloMocks: [
        {
          request: { query: AdminResellerBillingDocument, variables: { resellerId: RESELLER_ID } },
          result: {
            data: {
              adminResellerBillingDashboard: {
                __typename: 'BillingDashboardModel',
                mrr: '12500000',
                activeSubscriptions: 12,
                churnedLast30Days: 1,
                churnRate: 0.0769,
                overdueInvoiceCount: 2,
              },
            },
          },
        },
      ],
    });

    expect(await screen.findByTestId('reseller-billing-mrr')).toHaveTextContent('₹1,25,000.00');
    expect(screen.getByTestId('reseller-billing-active')).toHaveTextContent('12');
    expect(screen.getByTestId('reseller-billing-churn')).toHaveTextContent('7.7%');
    expect(screen.getByTestId('reseller-billing-churn')).toHaveTextContent(
      '1 subscription cancelled in the last 30 days',
    );
    expect(screen.getByTestId('reseller-billing-overdue')).toHaveTextContent('Needs follow-up');
  });

  it('explains that billing is off when the billing edition is not enabled', async () => {
    const { ResellerBillingTab } = await loadTab('false');
    renderWithProviders(<ResellerBillingTab resellerId={RESELLER_ID} />);
    expect(screen.getByTestId('reseller-billing-disabled')).toHaveTextContent(
      'Billing is not enabled',
    );
  });
});
