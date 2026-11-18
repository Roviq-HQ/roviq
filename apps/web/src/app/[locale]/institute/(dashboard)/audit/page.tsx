'use client';

import { Can } from '@roviq/ui';
import type { AuditColumnKey } from '@web/components/audit/audit-log-columns';
import { AuditLogFilters, useAuditLogFilters } from '@web/components/audit/audit-log-filters';
import { AuditLogTable } from '@web/components/audit/audit-log-table';
import {
  buildAuditLogFilter,
  CLEARED_AUDIT_FILTERS,
  hasActiveAuditFilters,
} from '@web/components/audit/audit-utils';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useAuditLogs } from './use-audit-logs';

const COLUMNS: readonly AuditColumnKey[] = [
  'createdAt',
  'actorId',
  'action',
  'actionType',
  'entityType',
  'entityId',
  'changes',
  'source',
];

export default function InstituteAuditLogsPage() {
  const t = useTranslations('auditLogs');
  const [filters, setFilters] = useAuditLogFilters();
  const filter = React.useMemo(() => buildAuditLogFilter(filters), [filters]);
  const { logs, totalCount, hasNextPage, loading, loadMore } = useAuditLogs({ filter, first: 20 });

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
              <AuditLogFilters scope="institute" />
              <AuditLogTable
                scope="institute"
                columns={COLUMNS}
                logs={logs}
                loading={loading}
                totalCount={totalCount}
                hasNextPage={hasNextPage}
                loadMore={loadMore}
                hasFilters={hasActiveAuditFilters(filters)}
                onClearFilters={() => setFilters(CLEARED_AUDIT_FILTERS)}
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
