import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { instituteBillingInvoice: ids } = testIds;

const state = vi.hoisted(() => ({
  search: new URLSearchParams(),
  initiate: vi.fn(),
  verify: vi.fn(),
  openRazorpay: vi.fn(),
  redirectCashfree: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'inv-1' }),
  useSearchParams: () => state.search,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/en/institute/billing/invoices/inv-1',
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

vi.mock('../../../gateway-checkout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../gateway-checkout')>()),
  openRazorpayCheckout: state.openRazorpay,
  redirectToCashfreeCheckout: state.redirectCashfree,
}));

const INVOICE = {
  id: 'inv-1',
  invoiceNumber: 'RVQ-2026-00002',
  status: 'SENT',
  subtotalAmount: '100000',
  taxAmount: '18000',
  totalAmount: '118000',
  paidAmount: '0',
  currency: 'INR',
  periodStart: null,
  periodEnd: null,
  dueAt: '2026-12-01T00:00:00.000Z',
  paidAt: null,
  issuedAt: '2026-11-20T00:00:00.000Z',
  lineItems: [
    {
      description: 'Pro Plan — Nov 2026',
      quantity: 1,
      unitAmountPaise: '100000',
      totalAmountPaise: '100000',
      taxRate: 18,
      taxAmountPaise: '18000',
      sacCode: '998393',
    },
  ],
  notes: null,
  upiPaymentUri: null,
};

vi.mock('../../../use-billing', () => ({
  useMyInvoice: () => ({ invoice: INVOICE, loading: false }),
  useMyPaymentHistory: () => ({ payments: [], loading: false }),
  useSubmitUpiProof: () => [vi.fn(), { loading: false }],
  useGenerateInvoicePdf: () => [vi.fn(), { loading: false }],
  useInitiatePayment: () => [state.initiate, { loading: false }],
  useVerifyPayment: () => [state.verify, { loading: false }],
}));

import InvoiceDetailPage from '../page';

const RAZORPAY_ORDER = {
  data: {
    initiatePayment: {
      paymentId: 'pay-1',
      gatewayOrderId: 'order_server',
      gatewayProvider: 'RAZORPAY',
      checkoutPayload: { key: 'rzp_test_1', order_id: 'order_server' },
    },
  },
};

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'No active gateway for reseller 0000-raw', extensions: { code } }],
  });
}

beforeEach(() => {
  state.search = new URLSearchParams();
  state.initiate.mockReset();
  state.verify.mockReset().mockResolvedValue({ data: { verifyPayment: { id: 'pay-1' } } });
  state.openRazorpay.mockReset();
  state.redirectCashfree.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.info).mockClear();
});

describe('InvoiceDetailPage', () => {
  it('should show line item amounts in rupees', () => {
    renderWithProviders(<InvoiceDetailPage />);

    const row = within(screen.getByTestId(ids.lineItemRow(0)));
    expect(row.getByText('Pro Plan — Nov 2026')).toBeInTheDocument();
    expect(row.getAllByText('₹1,000.00')).toHaveLength(2);
    expect(row.getByText('₹180.00')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("should confirm a Razorpay payment against the server's order id", async () => {
    state.initiate.mockResolvedValue(RAZORPAY_ORDER);
    state.openRazorpay.mockResolvedValue({
      razorpay_payment_id: 'pay_rzp_1',
      razorpay_order_id: 'order_from_browser',
      razorpay_signature: 'sig_1',
    });
    renderWithProviders(<InvoiceDetailPage />);

    await userEvent.click(screen.getByTestId(ids.payOnlineBtn));

    await waitFor(() =>
      expect(state.verify).toHaveBeenCalledWith({
        variables: {
          input: {
            gatewayOrderId: 'order_server',
            gatewayPaymentId: 'pay_rzp_1',
            signature: 'sig_1',
          },
        },
      }),
    );
    expect(state.openRazorpay).toHaveBeenCalledWith(
      { key: 'rzp_test_1', order_id: 'order_server' },
      { name: 'Invoice RVQ-2026-00002' },
    );
    expect(toast.success).toHaveBeenCalledWith('Payment received. This invoice is now paid.');
  });

  it('should tell the payer when they close the payment window', async () => {
    state.initiate.mockResolvedValue(RAZORPAY_ORDER);
    state.openRazorpay.mockResolvedValue(null);
    renderWithProviders(<InvoiceDetailPage />);

    await userEvent.click(screen.getByTestId(ids.payOnlineBtn));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('Payment was not completed. You can try again.'),
    );
    expect(state.verify).not.toHaveBeenCalled();
  });

  it('should send the payer to Cashfree checkout', async () => {
    state.initiate.mockResolvedValue({
      data: {
        initiatePayment: {
          paymentId: 'pay-2',
          gatewayOrderId: 'ord_1',
          gatewayProvider: 'CASHFREE',
          checkoutPayload: { paymentSessionId: 'session_1', mode: 'sandbox' },
        },
      },
    });
    renderWithProviders(<InvoiceDetailPage />);

    await userEvent.click(screen.getByTestId(ids.payOnlineBtn));

    await waitFor(() =>
      expect(state.redirectCashfree).toHaveBeenCalledWith({
        paymentSessionId: 'session_1',
        mode: 'sandbox',
      }),
    );
    expect(state.openRazorpay).not.toHaveBeenCalled();
  });

  it('should confirm the order Cashfree returns the payer with', async () => {
    state.search = new URLSearchParams('order_id=ord_1');
    renderWithProviders(<InvoiceDetailPage />);

    await waitFor(() =>
      expect(state.verify).toHaveBeenCalledWith({
        variables: { input: { gatewayOrderId: 'ord_1' } },
      }),
    );
    expect(state.verify).toHaveBeenCalledTimes(1);
  });

  it('should show translated copy for a coded error, never the server text', async () => {
    state.initiate.mockRejectedValue(graphQLError('PAYMENT_GATEWAY_NOT_CONFIGURED'));
    renderWithProviders(<InvoiceDetailPage />);

    await userEvent.click(screen.getByTestId(ids.payOnlineBtn));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Online payment is not set up for your institute yet. Please pay by UPI or contact your administrator.',
      ),
    );
  });

  it('should show generic copy for an uncoded error', async () => {
    state.initiate.mockRejectedValue(new Error('socket hang up'));
    renderWithProviders(<InvoiceDetailPage />);

    await userEvent.click(screen.getByTestId(ids.payOnlineBtn));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.'),
    );
  });
});
