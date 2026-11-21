'use client';

import { INVOICE_STATUS_VALUES } from '@roviq/common-types';
import type { InvoiceStatus } from '@roviq/graphql/generated';
import { useFormatDate, useFormatNumber } from '@roviq/i18n';
import {
  Button,
  Can,
  DataTable,
  DataTableToolbar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useAbility,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileText, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';
import { type MyInvoice, useMyInvoices } from '../use-billing';
import { createInvoiceColumns } from './invoice-columns';

const { instituteBillingInvoices: ids } = testIds;

const PAGE_SIZE = 20;

const filterParsers = {
  status: parseAsStringEnum<InvoiceStatus>([...INVOICE_STATUS_VALUES]),
};

export default function InvoicesPage() {
  const t = useTranslations('instituteBilling');
  const { format } = useFormatDate();
  const { currency } = useFormatNumber();
  const router = useRouter();
  const [filters, setFilters] = useQueryStates(filterParsers);
  const [pages, setPages] = React.useState(1);
  const first = pages * PAGE_SIZE;

  const canRead = useAbility().can('read', 'Invoice');
  const { invoices, loading } = useMyInvoices({
    first,
    status: filters.status ?? undefined,
    skip: !canRead,
  });

  const formatDate = React.useCallback((date: Date) => format(date, 'dd MMM yyyy'), [format]);
  const formatCurrency = React.useCallback((amount: number) => currency(amount), [currency]);
  const columns = React.useMemo(
    () => createInvoiceColumns(t, formatDate, formatCurrency),
    [t, formatDate, formatCurrency],
  );

  const changeStatus = (status: InvoiceStatus | null) => {
    setPages(1);
    setFilters({ status });
  };

  // The API returns a bare list, so a full window means there may be more.
  const hasMore = invoices.length === first;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('invoices.title')}</h1>
        <p className="text-muted-foreground">{t('invoices.description')}</p>
      </div>

      <Can I="read" a="Invoice" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <>
              <DataTableToolbar>
                <Select
                  value={filters.status ?? ''}
                  onValueChange={(v) =>
                    changeStatus(INVOICE_STATUS_VALUES.find((s) => s === v) ?? null)
                  }
                >
                  <SelectTrigger className="w-[180px]" data-testid={ids.statusFilter}>
                    <SelectValue placeholder={t('invoices.filters.status')} />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_STATUS_VALUES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`invoiceStatuses.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filters.status && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={ids.clearFilters}
                    onClick={() => changeStatus(null)}
                  >
                    <X className="me-1 size-4" />
                    {t('invoices.filters.clearFilters')}
                  </Button>
                )}
              </DataTableToolbar>

              <DataTable
                data-testid={ids.table}
                columns={columns}
                data={invoices}
                isLoading={loading && invoices.length === 0}
                skeletonRows={5}
                emptyState={
                  <div
                    data-testid={ids.empty}
                    className="flex flex-col items-center justify-center gap-3 py-12"
                  >
                    <FileText className="size-12 text-muted-foreground" aria-hidden="true" />
                    <p className="text-muted-foreground">
                      {filters.status ? t('invoices.emptyFiltered') : t('invoices.empty')}
                    </p>
                  </div>
                }
                onRowClick={(invoice: MyInvoice) => router.push(`/billing/invoices/${invoice.id}`)}
              />

              {hasMore && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    data-testid={ids.loadMore}
                    disabled={loading}
                    onClick={() => setPages((p) => p + 1)}
                  >
                    {t('invoices.loadMore')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div
              data-testid={ids.accessDenied}
              className="flex h-[50vh] items-center justify-center"
            >
              <p className="text-muted-foreground">{t('invoices.accessDenied')}</p>
            </div>
          )
        }
      </Can>
    </div>
  );
}
