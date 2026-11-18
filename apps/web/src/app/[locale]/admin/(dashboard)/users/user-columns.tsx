'use client';

import { Badge } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { ColumnDef } from '@tanstack/react-table';
import { formatPhone, type UserListNode } from './types';
import { USER_STATUS_CLASS, USER_STATUS_VARIANT } from './user-badge-styles';

const { adminUsers } = testIds;

interface ColumnDeps {
  t: (key: string, values?: Record<string, string | number>) => string;
  resolveName: (user: UserListNode) => string;
  formatDate: (date: Date) => string;
  formatRelative: (date: Date) => string;
}

export function createUserColumns({
  t,
  resolveName,
  formatDate,
  formatRelative,
}: ColumnDeps): ColumnDef<UserListNode>[] {
  return [
    {
      accessorKey: 'username',
      header: t('columns.username'),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.username}</span>,
    },
    {
      id: 'name',
      header: t('columns.name'),
      cell: ({ row }) => (
        <span className="font-medium" data-testid={adminUsers.nameCell(row.original.id)}>
          {resolveName(row.original) || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'email',
      header: t('columns.email'),
      cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {formatPhone(row.original.primaryPhone) ?? '—'}
        </span>
      ),
    },
    {
      id: 'memberships',
      header: t('columns.memberships'),
      cell: ({ row }) => (
        <Badge variant="outline" data-testid={adminUsers.membershipCount(row.original.id)}>
          {t('membershipCount', { count: row.original.memberships.length })}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: t('columns.status'),
      cell: ({ row }) => (
        <Badge
          variant={USER_STATUS_VARIANT[row.original.status]}
          className={USER_STATUS_CLASS[row.original.status]}
        >
          {t(`statuses.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('columns.createdAt'),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(new Date(row.original.createdAt))}
        </span>
      ),
    },
    {
      accessorKey: 'lastActiveAt',
      header: t('columns.lastActive'),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.lastActiveAt
            ? formatRelative(new Date(row.original.lastActiveAt))
            : t('neverActive')}
        </span>
      ),
    },
  ];
}
