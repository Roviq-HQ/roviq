'use client';

import { Badge, ImpersonationBadge } from '@roviq/ui';
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

/**
 * Derive impersonator scope from the audit log entry.
 * The scope is stored on the impersonation_sessions table,
 * but for display we infer from the metadata or default to 'institute'.
 */
function getImpersonatorScope(log: AuditLogNode): 'platform' | 'reseller' | 'institute' {
  const meta = log.metadata as Record<string, unknown> | null;
  if (meta?.impersonator_scope === 'platform') return 'platform';
  if (meta?.impersonator_scope === 'reseller') return 'reseller';
  return 'institute';
}

export function createAuditLogColumns(
  t: (key: string) => string,
  formatDate: (date: Date) => string,
): ColumnDef<AuditLogNode, unknown>[] {
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
        const log = row.original;
        const actorName = log.actorName;

        return (
          <div className="flex items-center gap-1.5">
            <span className="max-w-[120px] truncate text-xs">
              {actorName ?? log.actorId.slice(0, 8)}
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
    {
      accessorKey: 'source',
      header: t('columns.source'),
    },
  ];
}
