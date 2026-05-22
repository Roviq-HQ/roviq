'use client';

import type { useI18nField } from '@roviq/i18n';
import { Badge, ImpersonationBadge } from '@roviq/ui';
import type { ColumnDef } from '@tanstack/react-table';
import type { ResellerAuditLogNode } from './use-reseller-audit-logs';

const ACTION_TYPE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  /** New entity created */
  CREATE: 'default',
  /** Existing entity modified */
  UPDATE: 'secondary',
  /** Entity soft-deleted */
  DELETE: 'destructive',
  /** Soft-deleted entity restored */
  RESTORE: 'outline',
  /** Resource assigned */
  ASSIGN: 'default',
  /** Resource revoked */
  REVOKE: 'destructive',
  /** Entity suspended */
  SUSPEND: 'destructive',
  /** Suspended entity re-activated */
  ACTIVATE: 'default',
};

function getImpersonatorScope(log: ResellerAuditLogNode): 'platform' | 'reseller' | 'institute' {
  const meta = log.metadata as Record<string, unknown> | null;
  if (meta?.impersonator_scope === 'platform') return 'platform';
  if (meta?.impersonator_scope === 'reseller') return 'reseller';
  return 'institute';
}

export function createResellerAuditLogColumns(
  t: (key: string) => string,
  formatDate: (date: Date) => string,
  ti: ReturnType<typeof useI18nField>,
): ColumnDef<ResellerAuditLogNode, unknown>[] {
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
      accessorKey: 'tenantId',
      header: t('columns.institute'),
      cell: ({ row }) => {
        const name = ti(row.original.tenantName);
        return name ? (
          <span className="max-w-[120px] truncate text-xs">{name}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: 'actorId',
      header: t('columns.actor'),
      cell: ({ row }) => {
        const log = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <span className="max-w-[120px] truncate text-xs">
              {log.actorName ?? log.actorId.slice(0, 8)}
            </span>
            {log.impersonatorId && (
              <ImpersonationBadge
                impersonatorName={log.actorName ?? log.actorId.slice(0, 8)}
                actorScope={getImpersonatorScope(log)}
              />
            )}
          </div>
        );
      },
    },
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
      accessorKey: 'changes',
      header: t('detail.changes'),
      cell: ({ row }) => {
        const changes = row.original.changes as Record<string, unknown> | null;
        if (!changes || Object.keys(changes).length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }
        const firstKey = Object.keys(changes)[0];
        const count = Object.keys(changes).length;
        return (
          <span className="max-w-[150px] truncate text-xs text-muted-foreground">
            {firstKey}
            {count > 1 ? ` +${count - 1}` : ''}
          </span>
        );
      },
    },
  ];
}
