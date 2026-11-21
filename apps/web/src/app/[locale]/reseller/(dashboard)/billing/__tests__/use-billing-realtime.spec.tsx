import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnverifiedPayments } from '../upi-verification/use-upi-verification';
import { UnverifiedPaymentsDocument } from '../upi-verification/use-upi-verification.generated';
import { useResellerBillingRealtime } from '../use-billing-realtime';
import {
  ResellerInvoiceGeneratedDocument,
  ResellerPaymentReceivedDocument,
  ResellerPaymentStatusChangedDocument,
} from '../use-billing-realtime.generated';

const toastMock = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

// The event must land after the first load: Apollo drops a refetch of a query still in flight.
const EVENT_DELAY_MS = 400;

function payment(id: string, utr: string) {
  return {
    __typename: 'PaymentModel' as const,
    id,
    invoiceId: 'inv-1',
    tenantId: 'tenant-1',
    amountPaise: '118000',
    currency: 'INR',
    utrNumber: utr,
    verificationDeadline: '2026-12-01T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

const unverifiedQuery = (payments: ReturnType<typeof payment>[]) => ({
  request: { query: UnverifiedPaymentsDocument, variables: {} },
  result: { data: { unverifiedPayments: payments } },
});

const event = {
  __typename: 'BillingPaymentEvent' as const,
  paymentId: 'pay-2',
  invoiceId: 'inv-1',
  tenantId: 'tenant-1',
};

function Harness() {
  useResellerBillingRealtime();
  const { payments } = useUnverifiedPayments();
  return (
    <ul>
      {payments.map((p) => (
        <li key={p.id}>{p.utrNumber}</li>
      ))}
    </ul>
  );
}

describe('useResellerBillingRealtime', () => {
  beforeEach(() => {
    toastMock.info.mockClear();
    toastMock.success.mockClear();
  });

  it('refetches the UPI verification list on a payment status change, without a toast', async () => {
    renderWithProviders(<Harness />, {
      apolloMocks: [
        unverifiedQuery([payment('pay-1', 'UTR-ONE')]),
        unverifiedQuery([payment('pay-1', 'UTR-ONE'), payment('pay-2', 'UTR-TWO')]),
        {
          request: { query: ResellerPaymentStatusChangedDocument },
          delay: EVENT_DELAY_MS,
          result: { data: { resellerPaymentStatusChanged: event } },
        },
      ],
    });

    expect(await screen.findByText('UTR-TWO')).toBeInTheDocument();
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('toasts when an invoice is generated', async () => {
    renderWithProviders(<Harness />, {
      apolloMocks: [
        unverifiedQuery([]),
        {
          request: { query: ResellerInvoiceGeneratedDocument },
          delay: EVENT_DELAY_MS,
          result: {
            data: {
              resellerInvoiceGenerated: {
                __typename: 'BillingInvoiceEvent',
                invoiceId: 'inv-9',
                tenantId: 'tenant-1',
              },
            },
          },
        },
      ],
    });

    await vi.waitFor(() => expect(toastMock.info).toHaveBeenCalledWith('New invoice generated'));
  });

  it('toasts when a payment is received', async () => {
    renderWithProviders(<Harness />, {
      apolloMocks: [
        unverifiedQuery([]),
        {
          request: { query: ResellerPaymentReceivedDocument },
          delay: EVENT_DELAY_MS,
          result: { data: { resellerPaymentReceived: event } },
        },
      ],
    });

    await vi.waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Payment received'));
  });

  it('does not subscribe without the ability to read payments', async () => {
    renderWithProviders(<Harness />, {
      abilityRules: [],
      apolloMocks: [
        unverifiedQuery([payment('pay-1', 'UTR-ONE')]),
        {
          request: { query: ResellerPaymentReceivedDocument },
          delay: EVENT_DELAY_MS,
          result: { data: { resellerPaymentReceived: event } },
        },
      ],
    });

    expect(await screen.findByText('UTR-ONE')).toBeInTheDocument();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
