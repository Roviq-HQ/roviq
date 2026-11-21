'use client';

import type { InvoiceStatus } from '@roviq/graphql/generated';
import { Badge } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import type { MyInvoice } from '../use-billing';

const { instituteBillingInvoices: ids } = testIds;

const STATUS_VARIANT: Record<InvoiceStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SENT: 'outline',
  PAID: 'default',
  PARTIALLY_PAID: 'outline',
  OVERDUE: 'destructive',
  CANCELLED: 'secondary',
  REFUNDED: 'secondary',
};

export function createInvoiceColumns(
  t: (key: string) => string,
  formatDate: (date: Date) => string,
  formatCurrency: (amount: number) => string,
): ColumnDef<MyInvoice, unknown>[] {
  return [
    {
      accessorKey: 'invoiceNumber',
      header: t('invoices.columns.invoiceNumber'),
      cell: ({ row }) => (
        <Link
          href={`/billing/invoices/${row.original.id}`}
          data-testid={ids.invoiceLink(row.original.id)}
          className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.invoiceNumber}
        </Link>
      ),
    },
    {
      id: 'billingPeriod',
      header: t('invoices.columns.billingPeriod'),
      cell: ({ row }) => {
        const { periodStart, periodEnd } = row.original;
        if (!periodStart || !periodEnd) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="whitespace-nowrap text-xs">
            {formatDate(new Date(periodStart))} – {formatDate(new Date(periodEnd))}
          </span>
        );
      },
    },
    {
      accessorKey: 'totalAmount',
      header: t('invoices.columns.total'),
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-medium">
          {formatCurrency(Number(row.original.totalAmount) / 100)}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('invoices.columns.status'),
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status] ?? 'secondary'}>
          {t(`invoiceStatuses.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'dueAt',
      header: t('invoices.columns.dueDate'),
      cell: ({ row }) =>
        row.original.dueAt ? (
          <span className="whitespace-nowrap text-xs">
            {formatDate(new Date(row.original.dueAt))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}
