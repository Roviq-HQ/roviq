'use client';

import { Badge } from '@roviq/ui';
import type { ColumnDef } from '@tanstack/react-table';
import type { AuditLogNode } from './use-audit-logs';

const ACTION_TYPE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  /** New entity created */
  CREATE: 'default',
  /** Existing entity modified */
  UPDATE: 'secondary',
  /** Entity soft-deleted */
  DELETE: 'destructive',
  /** Soft-deleted entity restored */
  RESTORE: 'outline',
  /** Resource assigned to entity */
  ASSIGN: 'default',
  /** Resource revoked from entity */
  REVOKE: 'destructive',
  /** Entity suspended (still exists but disabled) */
  SUSPEND: 'destructive',
  /** Suspended entity re-activated */
  ACTIVATE: 'default',
};

/** Tier badge colour: full=green, support=blue, read-only=grey. */
const TIER_BADGE_CLASS: Record<string, string> = {
  FULL_MANAGEMENT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  SUPPORT_MANAGEMENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  READ_ONLY: 'bg-muted text-muted-foreground',
};

export function createAuditLogColumns(
  t: (key: string) => string,
  formatDate: (date: Date) => string,
  showReseller = false,
): ColumnDef<AuditLogNode, unknown>[] {
  const resellerColumns: ColumnDef<AuditLogNode, unknown>[] = showReseller
    ? [
        {
          accessorKey: 'resellerName',
          header: t('columns.reseller'),
          cell: ({ row }) => (
            <span className="max-w-[160px] truncate text-sm">
              {row.original.resellerName ?? '—'}
            </span>
          ),
        },
        {
          accessorKey: 'resellerTier',
          header: t('columns.resellerTier'),
          cell: ({ row }) => {
            const tier = row.original.resellerTier;
            return tier ? (
              <Badge variant="outline" className={TIER_BADGE_CLASS[tier] ?? ''}>
                {t(`resellerTier.${tier}`)}
              </Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          },
        },
      ]
    : [];

  return [
    {
      accessorKey: 'createdAt',
      header: t('columns.timestamp'),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(new Date(row.getValue('createdAt')))}
        </span>
      ),
    },
    {
      accessorKey: 'actorId',
      header: t('columns.actor'),
      cell: ({ row }) => {
        const impersonatorId = row.original.impersonatorId;
        const actorName = row.original.actorName;
        return (
          <div className="flex items-center gap-1">
            <span className="max-w-[120px] truncate text-xs">
              {actorName ?? row.getValue<string>('actorId').slice(0, 8)}
            </span>
            {impersonatorId && (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">
                {t('detail.impersonated')}
              </Badge>
            )}
          </div>
        );
      },
    },
    ...resellerColumns,
    {
      accessorKey: 'action',
      header: t('columns.action'),
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate text-sm">{row.getValue('action')}</span>
      ),
    },
    {
      accessorKey: 'actionType',
      header: t('columns.actionType'),
      cell: ({ row }) => {
        const actionType = row.getValue<string>('actionType');
        return (
          <Badge variant={ACTION_TYPE_VARIANT[actionType] ?? 'outline'}>
            {t(`actionTypes.${actionType}`)}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'entityType',
      header: t('columns.entityType'),
      cell: ({ row }) => <span className="text-sm">{row.getValue('entityType')}</span>,
    },
    {
      accessorKey: 'entityId',
      header: t('columns.entityId'),
      cell: ({ row }) => {
        const entityId = row.getValue<string | null>('entityId');
        return entityId ? (
          <span className="max-w-[100px] truncate font-mono text-xs">{entityId.slice(0, 8)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: 'source',
      header: t('columns.source'),
    },
    {
      accessorKey: 'ipAddress',
      header: t('columns.ipAddress'),
      cell: ({ row }) => {
        const ip = row.getValue<string | null>('ipAddress');
        return ip ? (
          <span className="font-mono text-xs">{ip}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
  ];
}
