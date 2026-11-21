'use client';

import { gql, useApolloClient, useQuery, useSubscription } from '@roviq/graphql';
import { useAbility } from '@roviq/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  MyInvoiceGeneratedDocument,
  MyPaymentStatusChangedDocument,
  MySubscriptionStatusChangedDocument,
  MyUnpaidInvoicesDocument,
} from './use-billing-realtime.generated';

export const MY_SUBSCRIPTION_STATUS_CHANGED = gql`
  subscription MySubscriptionStatusChanged {
    mySubscriptionStatusChanged {
      subscriptionId
      tenantId
    }
  }
`;

export const MY_INVOICE_GENERATED = gql`
  subscription MyInvoiceGenerated {
    myInvoiceGenerated {
      invoiceId
      tenantId
    }
  }
`;

export const MY_PAYMENT_STATUS_CHANGED = gql`
  subscription MyPaymentStatusChanged {
    myPaymentStatusChanged {
      paymentId
      invoiceId
      tenantId
    }
  }
`;

export const MY_UNPAID_INVOICES = gql`
  query MyUnpaidInvoices {
    myInvoices(first: 100) {
      id
      status
    }
  }
`;

const UNPAID_STATUSES: readonly string[] = ['SENT', 'PARTIALLY_PAID', 'OVERDUE'];

/** Unpaid invoice count for the Billing nav badge; kept current by `useInstituteBillingRealtime`. */
export function useUnpaidInvoiceCount(enabled: boolean) {
  const { data } = useQuery(MyUnpaidInvoicesDocument, { skip: !enabled });
  return (data?.myInvoices ?? []).filter((invoice) => UNPAID_STATUSES.includes(invoice.status))
    .length;
}

/**
 * Billing events arrive as ids only, so each one re-reads the queries it can have
 * changed. Only mounted queries with a matching name are refetched.
 */
export function useInstituteBillingRealtime() {
  const t = useTranslations('instituteBilling');
  const ability = useAbility();
  const router = useRouter();
  const client = useApolloClient();
  const refetch = (...names: string[]) =>
    void client.refetchQueries({
      include: 'active',
      onQueryUpdated: (query) => query.queryName !== undefined && names.includes(query.queryName),
    });

  useSubscription(MySubscriptionStatusChangedDocument, {
    skip: !ability.can('read', 'Subscription'),
    onData: () => refetch('MySubscription'),
  });
  useSubscription(MyInvoiceGeneratedDocument, {
    skip: !ability.can('read', 'Invoice'),
    onData: ({ data }) => {
      const invoiceId = data.data?.myInvoiceGenerated.invoiceId;
      toast.info(t('realtime.newInvoice'), {
        description: t('realtime.newInvoiceDescription'),
        action: invoiceId
          ? {
              label: t('realtime.openInvoice'),
              onClick: () => router.push(`/billing/invoices/${invoiceId}`),
            }
          : undefined,
      });
      refetch('MyInvoices', 'MyUnpaidInvoices');
    },
  });
  useSubscription(MyPaymentStatusChangedDocument, {
    skip: !ability.can('read', 'Payment'),
    onData: () => refetch('MyPaymentHistory', 'MyInvoice', 'MyInvoices', 'MyUnpaidInvoices'),
  });
}
