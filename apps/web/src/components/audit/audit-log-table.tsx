'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Button,
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
import { AuditChanges } from './audit-changes';
import { type AuditColumnKey, createAuditLogColumns } from './audit-log-columns';
import { AuditLogDetail } from './audit-log-detail';
import { type AuditLogRow, type AuditScope, hasAuditChanges } from './audit-utils';
import { useAuditLabels } from './use-audit-labels';

export interface AuditLogTableProps {
  scope: AuditScope;
  columns: readonly AuditColumnKey[];
  logs: AuditLogRow[];
  loading: boolean;
  totalCount: number;
  hasNextPage: boolean;
  loadMore: () => Promise<unknown> | undefined;
  /** Whether user-set filters are active — offers "Clear filters" in the empty state. */
  hasFilters: boolean;
  onClearFilters: () => void;
  /** A tab-level preset narrows the list even without user filters. */
  hasPreset?: boolean;
  onViewSession?: (sessionId: string) => void;
  'data-testid'?: string;
}

/** Audit list shared by the three portals: table, row diff expansion, pagination, detail sheet. */
export function AuditLogTable({
  scope,
  columns: columnKeys,
  logs,
  loading,
  totalCount,
  hasNextPage,
  loadMore,
  hasFilters,
  onClearFilters,
  hasPreset = false,
  onViewSession,
  'data-testid': dataTestId = testIds.auditLogs.table,
}: AuditLogTableProps) {
  const t = useTranslations('auditLogs');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const labels = useAuditLabels();
  const [selectedLog, setSelectedLog] = React.useState<AuditLogRow | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const columns = React.useMemo(
    () =>
      createAuditLogColumns({
        keys: columnKeys,
        scope,
        t,
        formatDate: (date) => format(date, 'dd MMM yyyy, HH:mm:ss'),
        resolveI18n,
        impersonationLabels: labels.impersonation,
      }),
    [columnKeys, scope, t, format, resolveI18n, labels.impersonation],
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
    <>
      <DataTable
        data-testid={dataTestId}
        columns={columns}
        data={logs}
        getRowId={(log) => log.id}
        isLoading={loading && logs.length === 0}
        onRowClick={setSelectedLog}
        expansion={{
          canExpand: hasAuditChanges,
          render: (log) => <AuditChanges log={log} />,
          labels: { expand: t('table.showChanges'), collapse: t('table.hideChanges') },
        }}
        emptyState={
          hasFilters || hasPreset ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>{t('emptyFilteredTitle')}</EmptyTitle>
                <EmptyDescription>{t('emptyFilteredDescription')}</EmptyDescription>
              </EmptyHeader>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={onClearFilters}>
                  <X className="me-1 size-4" />
                  {t('filters.clearFilters')}
                </Button>
              )}
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

      <AuditLogDetail
        log={selectedLog}
        scope={scope}
        open={selectedLog !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedLog(null);
        }}
        onViewSession={
          onViewSession
            ? (sessionId) => {
                setSelectedLog(null);
                onViewSession(sessionId);
              }
            : undefined
        }
      />
    </>
  );
}
