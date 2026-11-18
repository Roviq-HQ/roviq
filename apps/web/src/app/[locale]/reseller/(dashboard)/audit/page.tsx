'use client';

import { Badge, Can } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { AuditColumnKey } from '@web/components/audit/audit-log-columns';
import { AuditLogFilters, useAuditLogFilters } from '@web/components/audit/audit-log-filters';
import { AuditLogTable } from '@web/components/audit/audit-log-table';
import {
  buildAuditLogFilter,
  CLEARED_AUDIT_FILTERS,
  hasActiveAuditFilters,
  TIER_BADGE_CLASS,
} from '@web/components/audit/audit-utils';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useResellerInstitutes } from '../institutes/use-reseller-institutes';
import { useResellerAuditLogs } from './use-reseller-audit-logs';

const COLUMNS: readonly AuditColumnKey[] = [
  'createdAt',
  'tenantId',
  'actorId',
  'action',
  'actionType',
  'entityType',
  'entityId',
  'changes',
];

export default function ResellerAuditLogsPage() {
  const t = useTranslations('auditLogs');
  const [filters, setFilters] = useAuditLogFilters();
  const { institutes } = useResellerInstitutes();
  const filter = React.useMemo(() => buildAuditLogFilter(filters), [filters]);
  const { logs, totalCount, hasNextPage, loading, loadMore } = useResellerAuditLogs({
    filter,
    first: 20,
  });
  const reseller = logs[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
        {reseller?.resellerName && (
          <div
            className="mt-1 flex items-center gap-2 text-sm"
            data-testid={testIds.resellerAudit.resellerContext}
          >
            <span className="text-muted-foreground">{t('columns.reseller')}:</span>
            <span className="font-medium">{reseller.resellerName}</span>
            {reseller.resellerTier && (
              <Badge variant="outline" className={TIER_BADGE_CLASS[reseller.resellerTier] ?? ''}>
                {t(`resellerTier.${reseller.resellerTier}`)}
              </Badge>
            )}
          </div>
        )}
      </div>

      <Can I="read" a="AuditLog" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <>
              <AuditLogFilters scope="reseller" institutes={institutes} />
              <AuditLogTable
                scope="reseller"
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
