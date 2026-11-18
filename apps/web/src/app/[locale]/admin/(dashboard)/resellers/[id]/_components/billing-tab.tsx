'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useFormatNumber } from '@roviq/i18n';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { AlertTriangle, IndianRupee, TrendingDown, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import { AdminResellerBillingDocument } from './billing-tab.generated';

const { adminResellerDetail } = testIds;

export const ADMIN_RESELLER_BILLING = gql`
  query AdminResellerBilling($resellerId: ID!) {
    adminResellerBillingDashboard(resellerId: $resellerId) {
      mrr
      activeSubscriptions
      churnedLast30Days
      churnRate
      overdueInvoiceCount
    }
  }
`;

const EE_ENABLED = process.env.NEXT_PUBLIC_ROVIQ_EE === 'true';

export function ResellerBillingTab({ resellerId }: { resellerId: string }) {
  const t = useTranslations('adminResellers.billing');
  if (!EE_ENABLED) {
    return (
      <Empty className="py-12" data-testid={adminResellerDetail.billingDisabled}>
        <EmptyHeader>
          <EmptyTitle>{t('disabledTitle')}</EmptyTitle>
          <EmptyDescription>{t('disabledDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <BillingSummary resellerId={resellerId} />;
}

function BillingSummary({ resellerId }: { resellerId: string }) {
  const t = useTranslations('adminResellers.billing');
  const { format, currency } = useFormatNumber();
  const { data, loading } = useQuery(AdminResellerBillingDocument, {
    variables: { resellerId },
    fetchPolicy: 'cache-and-network',
  });
  const summary = data?.adminResellerBillingDashboard;

  if (loading && !summary) {
    return (
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        data-testid={adminResellerDetail.billingLoading}
      >
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (!summary) return null;

  const overdue = summary.overdueInvoiceCount;
  return (
    <div className="space-y-2" data-testid={adminResellerDetail.billingTab}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Metric
          testId={adminResellerDetail.billingMetric('mrr')}
          title={t('mrr')}
          hint={t('mrrHint')}
          icon={<IndianRupee className="size-4 text-muted-foreground" aria-hidden />}
          value={currency(Number(summary.mrr) / 100)}
        />
        <Metric
          testId={adminResellerDetail.billingMetric('active')}
          title={t('activeSubscriptions')}
          icon={<Users className="size-4 text-muted-foreground" aria-hidden />}
          value={format(summary.activeSubscriptions)}
        />
        <Metric
          testId={adminResellerDetail.billingMetric('churn')}
          title={t('churn')}
          hint={t('churnHint', { count: summary.churnedLast30Days })}
          icon={<TrendingDown className="size-4 text-muted-foreground" aria-hidden />}
          value={format(summary.churnRate, { style: 'percent', maximumFractionDigits: 1 })}
        />
        <Metric
          testId={adminResellerDetail.billingMetric('overdue')}
          title={t('overdueInvoices')}
          icon={<AlertTriangle className="size-4 text-muted-foreground" aria-hidden />}
          value={format(overdue)}
          badge={overdue > 0 ? t('actionRequired') : undefined}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}

function Metric({
  testId,
  title,
  hint,
  icon,
  value,
  badge,
}: {
  testId: string;
  title: string;
  hint?: string;
  icon: React.ReactNode;
  value: string;
  badge?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {badge && (
          <Badge variant="destructive" className="mt-1">
            {badge}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
