import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const INVOICE_ID = '01a2b3c4-0000-7000-8000-0000000000f1';
const ORPHAN_INVOICE_ID = '7c1e0000-0000-7000-8000-0000000000f2';

const payment = {
  amountPaise: '250000',
  currency: 'INR',
  utrNumber: 'UTR123456',
  verificationDeadline: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-05-04T09:00:00.000Z',
  tenantId: '01a2b3c4-0000-7000-8000-0000000000e1',
};

vi.mock('../use-upi-verification', () => ({
  useUnverifiedPayments: () => ({
    payments: [
      {
        ...payment,
        id: 'pay-1',
        invoiceId: INVOICE_ID,
        invoiceNumber: 'INV-2026-0001',
        instituteName: { en: 'Sunrise Public', hi: 'सनराइज़ पब्लिक' },
      },
      {
        ...payment,
        id: 'pay-2',
        invoiceId: ORPHAN_INVOICE_ID,
        invoiceNumber: null,
        instituteName: null,
      },
    ],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useVerifyUpiPayment: () => [vi.fn()],
  useRejectUpiPayment: () => [vi.fn()],
}));

import UpiVerificationPage from '../page';

const { resellerBillingUpi } = testIds;

describe('UpiVerificationPage (ROV-360)', () => {
  it('shows the invoice number and the institute name, in Hindi too', () => {
    renderWithProviders(<UpiVerificationPage />, { locale: 'hi' });

    expect(screen.getByTestId(resellerBillingUpi.invoice('pay-1'))).toHaveTextContent(
      'INV-2026-0001',
    );
    expect(screen.getByTestId(resellerBillingUpi.institute('pay-1'))).toHaveTextContent(
      'सनराइज़ पब्लिक',
    );
    expect(screen.getByTestId(resellerBillingUpi.institute('pay-2'))).toHaveTextContent(
      'अज्ञात संस्थान',
    );
  });

  it('says "Unknown invoice" with the id to copy, never a shortened id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UpiVerificationPage />);

    const cell = screen.getByTestId(resellerBillingUpi.invoice('pay-2'));
    expect(cell).toHaveTextContent('Unknown invoice');
    expect(document.body).not.toHaveTextContent(ORPHAN_INVOICE_ID.slice(0, 8));
    expect(document.body).not.toHaveTextContent(INVOICE_ID.slice(0, 8));

    await user.click(screen.getByTestId(testIds.copyId.button(ORPHAN_INVOICE_ID)));
    expect(await navigator.clipboard.readText()).toBe(ORPHAN_INVOICE_ID);
  });
});
