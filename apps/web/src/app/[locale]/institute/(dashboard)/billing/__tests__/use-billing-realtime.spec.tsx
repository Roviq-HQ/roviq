import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstituteBillingRealtime, useUnpaidInvoiceCount } from '../use-billing-realtime';
import {
  MyInvoiceGeneratedDocument,
  MyPaymentStatusChangedDocument,
  MyUnpaidInvoicesDocument,
} from '../use-billing-realtime.generated';

const toastMock = vi.hoisted(() => ({ info: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const invoice = (id: string, status: 'SENT' | 'PAID' | 'OVERDUE') => ({
  __typename: 'InvoiceModel' as const,
  id,
  status,
});

const unpaidQuery = (invoices: ReturnType<typeof invoice>[]) => ({
  request: { query: MyUnpaidInvoicesDocument, variables: {} },
  result: { data: { myInvoices: invoices } },
});

function Harness() {
  useInstituteBillingRealtime();
  const unpaid = useUnpaidInvoiceCount(true);
  return <p>{`unpaid:${unpaid}`}</p>;
}

describe('useInstituteBillingRealtime', () => {
  beforeEach(() => {
    toastMock.info.mockClear();
    nav.push.mockClear();
  });

  it('toasts with an action that opens the invoice and refreshes the unpaid count', async () => {
    renderWithProviders(<Harness />, {
      apolloMocks: [
        unpaidQuery([invoice('inv-1', 'SENT'), invoice('inv-0', 'PAID')]),
        unpaidQuery([invoice('inv-1', 'SENT'), invoice('inv-2', 'OVERDUE')]),
        {
          request: { query: MyInvoiceGeneratedDocument },
          delay: 50,
          result: {
            data: {
              myInvoiceGenerated: {
                __typename: 'BillingInvoiceEvent',
                invoiceId: 'inv-2',
                tenantId: 'tenant-1',
              },
            },
          },
        },
      ],
    });

    expect(await screen.findByText('unpaid:2')).toBeInTheDocument();
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.info.mock.calls[0];
    expect(title).toBe('New invoice');
    options.action.onClick();
    expect(nav.push).toHaveBeenCalledWith('/billing/invoices/inv-2');
  });

  it('refreshes the unpaid count when a payment changes state', async () => {
    renderWithProviders(<Harness />, {
      apolloMocks: [
        unpaidQuery([invoice('inv-1', 'SENT')]),
        unpaidQuery([invoice('inv-1', 'PAID')]),
        {
          request: { query: MyPaymentStatusChangedDocument },
          delay: 50,
          result: {
            data: {
              myPaymentStatusChanged: {
                __typename: 'BillingPaymentEvent',
                paymentId: 'pay-1',
                invoiceId: 'inv-1',
                tenantId: 'tenant-1',
              },
            },
          },
        },
      ],
    });

    expect(await screen.findByText('unpaid:0')).toBeInTheDocument();
    expect(toastMock.info).not.toHaveBeenCalled();
  });
});
