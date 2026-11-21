import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundDialog } from '../refund-dialog';
import { InvoicePaymentsDocument, IssueRefundDocument } from '../refund-dialog.generated';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { resellerBillingInvoices: ids } = testIds;

const payment = (
  id: string,
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED',
  amountPaise: number,
  refundedAmountPaise: number,
) => ({
  __typename: 'PaymentModel' as const,
  id,
  status,
  method: 'CASH' as const,
  amountPaise,
  refundedAmountPaise,
  paidAt: '2026-11-21T06:00:00.000Z',
  createdAt: '2026-11-21T06:00:00.000Z',
  utrNumber: null,
  receiptNumber: null,
});

const paymentsMock = (payments: ReturnType<typeof payment>[]) => ({
  request: { query: InvoicePaymentsDocument, variables: { invoiceId: 'inv-1' } },
  result: { data: { invoicePayments: payments } },
});

const refundResult = vi.fn(() => ({
  data: {
    issueRefund: {
      __typename: 'InvoiceModel' as const,
      id: 'inv-1',
      status: 'PARTIALLY_PAID' as const,
      paidAmount: 67882,
    },
  },
}));

const refundMock = (paymentId: string, amountPaise: string) => ({
  request: {
    query: IssueRefundDocument,
    variables: { paymentId, input: { amountPaise, reason: 'duplicate' } },
  },
  result: refundResult,
});

describe('RefundDialog', () => {
  beforeEach(() => {
    refundResult.mockClear();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
  });

  it('preselects the only refundable payment and refunds that payment', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithProviders(<RefundDialog open onOpenChange={onOpenChange} invoiceId="inv-1" />, {
      apolloMocks: [
        paymentsMock([
          payment('pay-failed', 'FAILED', 117882, 0),
          payment('pay-done', 'REFUNDED', 117882, 117882),
          payment('pay-ok', 'PARTIALLY_REFUNDED', 117882, 50000),
        ]),
        refundMock('pay-ok', '67882'),
      ],
    });

    const amount = await screen.findByRole('spinbutton');
    await waitFor(() => expect(amount).toHaveValue(678.82));
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'duplicate');
    await user.click(screen.getByTestId(ids.refundSubmit));

    await waitFor(() => expect(refundResult).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastMock.success).toHaveBeenCalledWith('Refund issued successfully.');
  });

  it('blocks an amount above what remains on the payment', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RefundDialog open onOpenChange={vi.fn()} invoiceId="inv-1" />, {
      apolloMocks: [paymentsMock([payment('pay-ok', 'SUCCEEDED', 117882, 0)])],
    });

    const amount = await screen.findByRole('spinbutton');
    await waitFor(() => expect(amount).toHaveValue(1178.82));
    await user.clear(amount);
    await user.type(amount, '1178.83');
    await user.click(screen.getByTestId(ids.refundSubmit));

    expect(await screen.findByTestId(ids.refundAmountError)).toHaveTextContent(
      'Enter at most ₹1,178.82, the amount left on this payment.',
    );
    expect(refundResult).not.toHaveBeenCalled();
  });

  it('explains and disables submit when no payment can be refunded', async () => {
    renderWithProviders(<RefundDialog open onOpenChange={vi.fn()} invoiceId="inv-1" />, {
      apolloMocks: [paymentsMock([payment('pay-done', 'REFUNDED', 117882, 117882)])],
    });

    expect(await screen.findByTestId(ids.refundNoPayment)).toBeInTheDocument();
    expect(screen.getByTestId(ids.refundSubmit)).toBeDisabled();
  });
});
