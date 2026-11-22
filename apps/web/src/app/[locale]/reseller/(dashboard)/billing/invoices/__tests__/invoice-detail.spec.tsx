import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceDetail } from '../invoice-detail';
import type { InvoiceNode } from '../use-invoices';

const NOW = '2026-11-21T00:00:00.000Z';

const invoice = (status: InvoiceNode['status'], paidAmount: string): InvoiceNode => ({
  id: 'inv-1',
  tenantId: 'inst-1',
  resellerId: 'reseller-1',
  subscriptionId: 'sub-1',
  invoiceNumber: 'RVQ-2026-00001',
  subscription: {
    id: 'sub-1',
    institute: { id: 'inst-1', name: { en: 'Saraswati Vidya Mandir' } },
  },
  subtotalAmount: '99900',
  taxAmount: '17982',
  totalAmount: '117882',
  paidAmount,
  currency: 'INR',
  status,
  periodStart: NOW,
  periodEnd: NOW,
  issuedAt: NOW,
  dueAt: NOW,
  paidAt: null,
  lineItems: [],
  taxBreakdown: null,
  notes: null,
  upiPaymentUri: null,
  createdAt: NOW,
});

function renderSheet(node: InvoiceNode) {
  renderWithProviders(
    <InvoiceDetail
      invoice={node}
      open
      onOpenChange={vi.fn()}
      onRecordPayment={vi.fn()}
      onIssueRefund={vi.fn()}
    />,
  );
}

describe('InvoiceDetail refund button', () => {
  it.each([
    ['PAID', '117882'],
    ['PARTIALLY_PAID', '50000'],
  ] as const)('shows Issue Refund for a %s invoice with money paid', (status, paid) => {
    renderSheet(invoice(status, paid));

    expect(screen.getByRole('button', { name: 'Issue Refund' })).toBeInTheDocument();
  });

  it.each([
    ['PARTIALLY_PAID', '0'],
    ['SENT', '0'],
    ['REFUNDED', '0'],
  ] as const)('hides Issue Refund for a %s invoice with %s paid', (status, paid) => {
    renderSheet(invoice(status, paid));

    expect(screen.queryByRole('button', { name: 'Issue Refund' })).not.toBeInTheDocument();
  });
});
