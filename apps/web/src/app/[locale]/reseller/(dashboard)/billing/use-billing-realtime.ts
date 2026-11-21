'use client';

import { gql, useApolloClient, useSubscription } from '@roviq/graphql';
import { useAbility } from '@roviq/ui';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ResellerInvoiceGeneratedDocument,
  ResellerPaymentReceivedDocument,
  ResellerPaymentStatusChangedDocument,
  ResellerSubscriptionChangedDocument,
} from './use-billing-realtime.generated';

export const RESELLER_INVOICE_GENERATED = gql`
  subscription ResellerInvoiceGenerated {
    resellerInvoiceGenerated {
      invoiceId
      tenantId
    }
  }
`;

export const RESELLER_PAYMENT_RECEIVED = gql`
  subscription ResellerPaymentReceived {
    resellerPaymentReceived {
      paymentId
      invoiceId
      tenantId
    }
  }
`;

export const RESELLER_PAYMENT_STATUS_CHANGED = gql`
  subscription ResellerPaymentStatusChanged {
    resellerPaymentStatusChanged {
      paymentId
      invoiceId
      tenantId
    }
  }
`;

export const RESELLER_SUBSCRIPTION_CHANGED = gql`
  subscription ResellerSubscriptionChanged {
    resellerSubscriptionChanged {
      subscriptionId
      tenantId
    }
  }
`;

/**
 * Billing events arrive as ids only, so each one re-reads the queries it can have
 * changed. Only mounted queries with a matching name are refetched.
 */
export function useResellerBillingRealtime() {
  const t = useTranslations('billing');
  const ability = useAbility();
  const client = useApolloClient();
  const refetch = (...names: string[]) =>
    void client.refetchQueries({
      include: 'active',
      onQueryUpdated: (query) => query.queryName !== undefined && names.includes(query.queryName),
    });

  useSubscription(ResellerInvoiceGeneratedDocument, {
    skip: !ability.can('read', 'Invoice'),
    onData: () => {
      toast.info(t('realtime.invoiceGenerated'));
      refetch('Invoices');
    },
  });
  useSubscription(ResellerPaymentReceivedDocument, {
    skip: !ability.can('read', 'Payment'),
    onData: () => {
      toast.success(t('realtime.paymentReceived'));
      refetch('ResellerBillingDashboard', 'Invoices');
    },
  });
  useSubscription(ResellerPaymentStatusChangedDocument, {
    skip: !ability.can('read', 'Payment'),
    onData: () =>
      refetch(
        'UnverifiedPayments',
        'UnverifiedPaymentsCount',
        'ResellerBillingDashboard',
        'Invoices',
      ),
  });
  useSubscription(ResellerSubscriptionChangedDocument, {
    skip: !ability.can('read', 'Subscription'),
    onData: () => refetch('Subscriptions'),
  });
}
