'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  DataTable,
  DataTablePagination,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ScrollText, SearchX, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { createResellerAuditLogColumns } from './audit-log-columns';
import { ResellerAuditLogFilters, useResellerAuditLogFilters } from './audit-log-filters';
import { useResellerAuditLogs } from './use-reseller-audit-logs';

/** Tier badge colour: full=green, support=blue, read-only=grey. */
const TIER_BADGE_CLASS: Record<string, string> = {
  FULL_MANAGEMENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  SUPPORT_MANAGEMENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  READ_ONLY: 'bg-muted text-muted-foreground',
};

export default function ResellerAuditLogsPage() {
  const t = useTranslations('auditLogs');
  const { format } = useFormatDate();
  const ti = useI18nField();
  const [filters, setFilters] = useResellerAuditLogFilters();
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const hasFilters = Object.values(filters).some(Boolean);

  const queryFilter = React.useMemo(() => {
    const f: Record<string, unknown> = {};
    if (filters.entityType) f.entityType = filters.entityType;
    if (filters.actionType) f.actionTypes = [filters.actionType];
    if (filters.userId) f.userId = filters.userId;
    if (filters.tenantId) f.tenantId = filters.tenantId;
    if (filters.dateFrom) f.dateFrom = filters.dateFrom;
    if (filters.dateTo) f.dateTo = filters.dateTo;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [filters]);

  const { logs, totalCount, hasNextPage, loading, loadMore } = useResellerAuditLogs({
    filter: queryFilter as Parameters<typeof useResellerAuditLogs>[0]['filter'],
    first: 20,
  });

  const formatDate = React.useCallback(
    (date: Date) => format(date, 'dd MMM yyyy, HH:mm:ss'),
    [format],
  );

  const columns = React.useMemo(
    () => createResellerAuditLogColumns(t, formatDate, ti),
    [t, formatDate, ti],
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      await loadMore();
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
        {logs[0]?.resellerName && (
          <div
            className="mt-1 flex items-center gap-2 text-sm"
            data-testid={testIds.resellerAudit.resellerContext}
          >
            <span className="text-muted-foreground">{t('columns.reseller')}:</span>
            <span className="font-medium">{logs[0].resellerName}</span>
            {logs[0].resellerTier && (
              <Badge variant="outline" className={TIER_BADGE_CLASS[logs[0].resellerTier] ?? ''}>
                {t(`resellerTier.${logs[0].resellerTier}`)}
              </Badge>
            )}
          </div>
        )}
      </div>

      <Can I="read" a="AuditLog" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <>
              <ResellerAuditLogFilters />

              <DataTable
                columns={columns}
                data={logs}
                isLoading={loading && logs.length === 0}
                emptyState={
                  hasFilters ? (
                    <Empty className="py-12">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <SearchX />
                        </EmptyMedia>
                        <EmptyTitle>{t('emptyFilteredTitle')}</EmptyTitle>
                        <EmptyDescription>{t('emptyFilteredDescription')}</EmptyDescription>
                      </EmptyHeader>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setFilters({
                            entityType: null,
                            actionType: null,
                            userId: null,
                            tenantId: null,
                            dateFrom: null,
                            dateTo: null,
                          })
                        }
                      >
                        <X className="me-1 size-4" />
                        {t('filters.clearFilters')}
                      </Button>
                    </Empty>
                  ) : (
                    <Empty className="py-12">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ScrollText />
                        </EmptyMedia>
                        <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
                        <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )
                }
              />

              <DataTablePagination
                hasNextPage={hasNextPage}
                isLoadingMore={isLoadingMore}
                onLoadMore={handleLoadMore}
                totalCount={totalCount}
                currentCount={logs.length}
                labels={{
                  loadMore: t('pagination.loadMore'),
                  showing: t('pagination.showing'),
                  of: t('pagination.of'),
                }}
              />
            </>
          ) : (
            <div className="flex h-[50vh] items-center justify-center">
              <p className="text-muted-foreground">{t('accessDenied')}</p>
            </div>
          )
        }
      </Can>
    </div>
  );
}
