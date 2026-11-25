'use client';

import type { useI18nField } from '@roviq/i18n';
import { Badge, ImpersonationBadge, type ImpersonationBadgeLabels } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { ColumnDef } from '@tanstack/react-table';
import { CopyIdButton } from '@web/components/copy-id-button';
import Link from 'next/link';
import {
  type AuditLogRow,
  type AuditScope,
  auditEntityHref,
  getImpersonatorScope,
  outsideActorScope,
  TIER_BADGE_CLASS,
} from './audit-utils';

export type AuditColumnKey =
  | 'createdAt'
  | 'tenantId'
  | 'actorId'
  | 'resellerName'
  | 'resellerTier'
  | 'action'
  | 'actionType'
  | 'entityType'
  | 'entityId'
  | 'changes'
  | 'source'
  | 'ipAddress';

export interface AuditLogColumnsOptions {
  /** Columns to show, in order. */
  keys: readonly AuditColumnKey[];
  scope: AuditScope;
  t: (key: string) => string;
  formatDate: (date: Date) => string;
  resolveI18n: ReturnType<typeof useI18nField>;
  impersonationLabels: ImpersonationBadgeLabels;
}

const ACTION_TYPE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  CREATE: 'default',
  UPDATE: 'secondary',
  DELETE: 'destructive',
  RESTORE: 'outline',
  ASSIGN: 'default',
  REVOKE: 'destructive',
  SUSPEND: 'destructive',
  ACTIVATE: 'default',
};

const DASH = <span className="text-muted-foreground">—</span>;

export function createAuditLogColumns({
  keys,
  scope,
  t,
  formatDate,
  resolveI18n,
  impersonationLabels,
}: AuditLogColumnsOptions): ColumnDef<AuditLogRow, unknown>[] {
  const all: Record<AuditColumnKey, ColumnDef<AuditLogRow, unknown>> = {
    createdAt: {
      accessorKey: 'createdAt',
      header: t('columns.timestamp'),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(new Date(row.original.createdAt))}
        </span>
      ),
    },
    tenantId: {
      accessorKey: 'tenantId',
      header: t('columns.institute'),
      cell: ({ row }) => {
        const name = resolveI18n(row.original.tenantName);
        return name ? <span className="max-w-[120px] truncate text-xs">{name}</span> : DASH;
      },
    },
    actorId: {
      accessorKey: 'actorId',
      header: t('columns.actor'),
      cell: ({ row }) => {
        const log = row.original;
        const unnamed = outsideActorScope(log, scope);
        const actor = log.actorName ?? (unnamed ? t(`actorScope.${unnamed}`) : t('unknownUser'));
        const unknown = !log.actorName && !unnamed;
        // On an institute's own log, mark what the platform or its reseller did to it. An
        // unnamed outsider already reads as its side, so the badge would only repeat it.
        const outside =
          !unnamed &&
          scope === 'institute' &&
          (log.scope === 'platform' || log.scope === 'reseller')
            ? log.scope
            : null;
        return (
          <div className="flex items-center gap-1.5">
            <span className="max-w-[120px] truncate text-xs">{actor}</span>
            {unknown && <CopyIdButton value={log.actorId} name={t('detail.actorId')} />}
            {outside && (
              <Badge
                variant="outline"
                className="text-[10px]"
                data-testid={testIds.auditLogs.outsideActorBadge(log.id)}
              >
                {t(`actorScope.${outside}`)}
              </Badge>
            )}
            {log.impersonatorId && (
              <ImpersonationBadge
                impersonatorName={actor}
                actorScope={getImpersonatorScope(log)}
                userName={log.userName ?? undefined}
                labels={impersonationLabels}
              />
            )}
          </div>
        );
      },
    },
    resellerName: {
      accessorKey: 'resellerName',
      header: t('columns.reseller'),
      cell: ({ row }) => (
        <span className="max-w-[160px] truncate text-sm">{row.original.resellerName ?? '—'}</span>
      ),
    },
    resellerTier: {
      accessorKey: 'resellerTier',
      header: t('columns.resellerTier'),
      cell: ({ row }) => {
        const tier = row.original.resellerTier;
        return tier ? (
          <Badge variant="outline" className={TIER_BADGE_CLASS[tier] ?? ''}>
            {t(`resellerTier.${tier}`)}
          </Badge>
        ) : (
          DASH
        );
      },
    },
    action: {
      accessorKey: 'action',
      header: t('columns.action'),
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate text-sm">{row.original.action}</span>
      ),
    },
    actionType: {
      accessorKey: 'actionType',
      header: t('columns.actionType'),
      cell: ({ row }) => {
        const actionType = row.original.actionType;
        return (
          <Badge variant={ACTION_TYPE_VARIANT[actionType] ?? 'outline'}>
            {t(`actionTypes.${actionType}`)}
          </Badge>
        );
      },
    },
    entityType: {
      accessorKey: 'entityType',
      header: t('columns.entityType'),
      cell: ({ row }) => <span className="text-sm">{row.original.entityType}</span>,
    },
    entityId: {
      accessorKey: 'entityId',
      header: t('columns.entityId'),
      cell: ({ row }) => {
        const { id, entityId, entityType } = row.original;
        if (!entityId) return DASH;
        const href = auditEntityHref(scope, entityType, entityId);
        return (
          <div className="flex items-center gap-1">
            {href ? (
              <Link
                href={href}
                title={t('detail.openEntity')}
                className="max-w-[140px] truncate font-mono text-xs text-primary underline-offset-2 hover:underline"
                data-testid={testIds.auditLogs.entityLink(id)}
                // The row opens the detail sheet on click; the link must only navigate.
                onClick={(event) => event.stopPropagation()}
              >
                {entityId}
              </Link>
            ) : (
              <span className="max-w-[140px] truncate font-mono text-xs" title={entityId}>
                {entityId}
              </span>
            )}
            <CopyIdButton value={entityId} name={t('detail.entityId')} />
          </div>
        );
      },
    },
    changes: {
      accessorKey: 'changes',
      header: t('detail.changes'),
      cell: ({ row }) => {
        const fields = Object.keys(row.original.changes ?? {});
        if (fields.length === 0) return DASH;
        return (
          <span className="max-w-[150px] truncate text-xs text-muted-foreground">
            {fields[0]}
            {fields.length > 1 ? ` +${fields.length - 1}` : ''}
          </span>
        );
      },
    },
    source: {
      accessorKey: 'source',
      header: t('columns.source'),
    },
    ipAddress: {
      accessorKey: 'ipAddress',
      header: t('columns.ipAddress'),
      cell: ({ row }) => {
        const ip = row.original.ipAddress;
        return ip ? <span className="font-mono text-xs">{ip}</span> : DASH;
      },
    },
  };

  return keys.map((key) => all[key]);
}
