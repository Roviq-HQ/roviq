'use client';

import { useFormatDate } from '@roviq/i18n';
import { Can, DataTable, DataTablePagination } from '@roviq/ui';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { createAuditLogColumns } from './audit-log-columns';
import { AuditLogDetail } from './audit-log-detail';
import { AuditLogFilters, useAuditLogFilters } from './audit-log-filters';
import { type AuditLogNode, useAuditLogs } from './use-audit-logs';

export default function AuditLogsPage() {
  const t = useTranslations('auditLogs');
  const { format } = useFormatDate();
  const [filters] = useAuditLogFilters();
  const [selectedLog, setSelectedLog] = React.useState<AuditLogNode | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const queryFilter = React.useMemo(() => {
    const f: Record<string, unknown> = {};
    if (filters.entityType) f.entityType = filters.entityType;
    if (filters.actionType) f.actionTypes = [filters.actionType];
    if (filters.userId) f.userId = filters.userId;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [filters]);

  const { logs, totalCount, hasNextPage, loading, loadMore } = useAuditLogs({
    filter: queryFilter as Parameters<typeof useAuditLogs>[0]['filter'],
    first: 20,
  });

  const formatDate = React.useCallback(
    (date: Date) => format(date, 'dd MMM yyyy, HH:mm:ss'),
    [format],
  );

  const columns = React.useMemo(() => createAuditLogColumns(t, formatDate), [t, formatDate]);

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
      </div>

      <Can I="read" a="AuditLog" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <>
              <AuditLogFilters t={t} />

              <DataTable
                columns={columns}
                data={logs}
                isLoading={loading && logs.length === 0}
                emptyMessage={t('empty')}
                onRowClick={setSelectedLog}
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

              <AuditLogDetail
                log={selectedLog}
                open={selectedLog !== null}
                onOpenChange={(open) => {
                  if (!open) setSelectedLog(null);
                }}
                t={t}
                formatDate={formatDate}
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
