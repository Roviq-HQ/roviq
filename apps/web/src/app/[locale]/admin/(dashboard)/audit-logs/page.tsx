'use client';

import type { AuditLogFilterInput } from '@roviq/graphql/generated';
import { Can, Tabs, TabsContent, TabsList, TabsTrigger } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { AuditColumnKey } from '@web/components/audit/audit-log-columns';
import { AuditLogFilters, useAuditLogFilters } from '@web/components/audit/audit-log-filters';
import { AuditLogTable } from '@web/components/audit/audit-log-table';
import {
  buildAuditLogFilter,
  CLEARED_AUDIT_FILTERS,
  hasActiveAuditFilters,
} from '@web/components/audit/audit-utils';
import { ScrollText, ShieldAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import * as React from 'react';
import { ImpersonationScopeFilter, useImpersonatorScopeFilter } from './impersonation-scope-filter';
import { ImpersonationSessionPanel } from './impersonation-session-panel';
import { useAuditLogs } from './use-audit-logs';

const { adminAuditLogs } = testIds;

const COLUMNS: readonly AuditColumnKey[] = [
  'createdAt',
  'actorId',
  'action',
  'actionType',
  'entityType',
  'entityId',
  'source',
  'ipAddress',
];
const RESELLER_TAB_COLUMNS: readonly AuditColumnKey[] = [
  'createdAt',
  'actorId',
  'resellerName',
  'resellerTier',
  ...COLUMNS.slice(2),
];

export default function AuditLogsPage() {
  const t = useTranslations('auditLogs');
  const [filters, setFilters] = useAuditLogFilters();
  const [activeTab, setActiveTab] = useQueryState('tab', parseAsString.withDefault('all'));
  const [impScope] = useImpersonatorScopeFilter();
  const [sessionPanelId, setSessionPanelId] = React.useState<string | null>(null);

  const filter = React.useMemo(() => {
    const preset: AuditLogFilterInput = {};
    if (activeTab === 'impersonation') {
      preset.impersonatedOnly = true;
      if (impScope.length > 0) preset.impersonatorScope = impScope;
    } else if (activeTab === 'reseller') {
      preset.scopes = ['reseller'];
    }
    return buildAuditLogFilter(filters, preset);
  }, [filters, activeTab, impScope]);

  const { logs, totalCount, hasNextPage, loading, loadMore } = useAuditLogs({ filter, first: 20 });

  return (
    <div className="space-y-4" data-testid={adminAuditLogs.page}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid={adminAuditLogs.title}>
          {t('title')}
        </h1>
        <p className="text-muted-foreground" data-testid={adminAuditLogs.description}>
          {t('description')}
        </p>
      </div>

      <Can I="read" a="AuditLog" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all" data-testid={adminAuditLogs.tabAll}>
                  <ScrollText className="me-1.5 size-4" />
                  {t('tabs.all')}
                </TabsTrigger>
                <TabsTrigger value="impersonation" data-testid={adminAuditLogs.tabImpersonation}>
                  <ShieldAlert className="me-1.5 size-4" />
                  {t('tabs.impersonation')}
                </TabsTrigger>
                <TabsTrigger value="reseller" data-testid={adminAuditLogs.tabReseller}>
                  <Users className="me-1.5 size-4" />
                  {t('tabs.resellerActivity')}
                </TabsTrigger>
              </TabsList>

              {/* All three tabs share the same content — only the filter preset changes */}
              <TabsContent value={activeTab} forceMount className="mt-4 space-y-4">
                <AuditLogFilters scope="admin" />

                {activeTab === 'impersonation' && <ImpersonationScopeFilter />}

                <AuditLogTable
                  data-testid={adminAuditLogs.table}
                  scope="admin"
                  columns={activeTab === 'reseller' ? RESELLER_TAB_COLUMNS : COLUMNS}
                  logs={logs}
                  loading={loading}
                  totalCount={totalCount}
                  hasNextPage={hasNextPage}
                  loadMore={loadMore}
                  hasFilters={hasActiveAuditFilters(filters)}
                  onClearFilters={() => setFilters(CLEARED_AUDIT_FILTERS)}
                  hasPreset={activeTab !== 'all'}
                  onViewSession={setSessionPanelId}
                />

                <ImpersonationSessionPanel
                  sessionId={sessionPanelId}
                  open={sessionPanelId !== null}
                  onOpenChange={(open) => {
                    if (!open) setSessionPanelId(null);
                  }}
                />
              </TabsContent>
            </Tabs>
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
