'use client';

import { useAuth } from '@roviq/auth';
import { useFormatDate } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  DataTable,
  DataTablePagination,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDebounce,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Search, SearchX, UserPlus, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs';
import * as React from 'react';
import { InviteMemberDialog } from './_components/invite-member-dialog';
import { MemberDetailSheet } from './_components/member-detail-sheet';
import {
  ChangeRoleDialog,
  type MemberDialog,
  StatusConfirmDialog,
} from './_components/member-dialogs';
import { TeamRoleBadge, TeamStatusBadge } from './_components/team-badges';
import { useMemberName } from './_components/use-member-name';
import { type TeamMember, useTeamMembers } from './use-reseller-team';

const { resellerTeam } = testIds;

const STATUS_VALUES = ['active', 'inactive'] as const;
const filterParsers = {
  search: parseAsString,
  status: parseAsStringLiteral(STATUS_VALUES),
};

export default function ResellerTeamPage() {
  const t = useTranslations('resellerTeam');
  const { user } = useAuth();
  const { format, formatDistance } = useFormatDate();
  const memberName = useMemberName();
  const [filters, setFilters] = useQueryStates(filterParsers);
  const [openMember, setOpenMember] = useQueryState('member', parseAsString);
  const [searchInput, setSearchInput] = React.useState(filters.search ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<MemberDialog | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  React.useEffect(() => {
    void setFilters({ search: debouncedSearch.trim() || null });
  }, [debouncedSearch, setFilters]);

  const queryFilter = React.useMemo(
    () => ({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.status ? { isActive: filters.status === 'active' } : {}),
    }),
    [filters],
  );
  const { members, totalCount, hasNextPage, loading, error, loadMore } =
    useTeamMembers(queryFilter);

  const columns = React.useMemo<ColumnDef<TeamMember>[]>(
    () => [
      {
        id: 'name',
        header: t('columns.name'),
        cell: ({ row }) => (
          <div data-testid={resellerTeam.nameCell(row.original.id)}>
            <span className="flex items-center gap-2 font-medium">
              {memberName(row.original)}
              {row.original.userId === user?.id && (
                <Badge variant="outline" data-testid={resellerTeam.youBadge}>
                  {t('you')}
                </Badge>
              )}
            </span>
            {memberName(row.original) !== row.original.username && (
              <span className="text-xs text-muted-foreground">{row.original.username}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: t('columns.email'),
        cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
      },
      {
        id: 'role',
        header: t('columns.role'),
        cell: ({ row }) => (
          <TeamRoleBadge
            name={row.original.roleName}
            testId={resellerTeam.roleBadge(row.original.id)}
          />
        ),
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => (
          <TeamStatusBadge
            isActive={row.original.isActive}
            testId={resellerTeam.statusBadge(row.original.id)}
          />
        ),
      },
      {
        id: 'lastActive',
        header: t('columns.lastActive'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.lastActiveAt
              ? formatDistance(new Date(row.original.lastActiveAt), new Date())
              : t('never')}
          </span>
        ),
      },
      {
        id: 'joined',
        header: t('columns.joined'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {format(new Date(row.original.joinedAt), 'dd/MM/yyyy')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('columns.actions')}</span>,
        cell: ({ row }) =>
          row.original.canManage ? (
            <Can I="update" a="ResellerTeam">
              <MemberActions
                member={row.original}
                name={memberName(row.original)}
                onPick={setDialog}
              />
            </Can>
          ) : null,
      },
    ],
    [t, memberName, user?.id, format, formatDistance],
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      await loadMore();
    } finally {
      setIsLoadingMore(false);
    }
  };

  const hasFilters = Boolean(filters.search || filters.status);

  return (
    <div className="space-y-4" data-testid={resellerTeam.page}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid={resellerTeam.title}>
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Can I="create" a="ResellerTeam">
          <Button onClick={() => setInviteOpen(true)} data-testid={resellerTeam.inviteBtn}>
            <UserPlus className="size-4" aria-hidden="true" />
            {t('invite')}
          </Button>
        </Can>
      </div>

      <DataTableToolbar>
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="absolute start-2.5 top-2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('filters.search')}
            aria-label={t('filters.search')}
            className="ps-8"
            data-testid={resellerTeam.searchInput}
          />
        </div>
        <Select
          value={filters.status ?? '__all__'}
          onValueChange={(value) =>
            setFilters({ status: value === 'active' || value === 'inactive' ? value : null })
          }
        >
          <SelectTrigger
            className="w-[170px]"
            aria-label={t('columns.status')}
            data-testid={resellerTeam.statusFilter}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('filters.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('status.active')}</SelectItem>
            <SelectItem value="inactive">{t('status.inactive')}</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput('');
              void setFilters({ search: null, status: null });
            }}
            data-testid={resellerTeam.clearFiltersBtn}
          >
            <X className="me-1 size-4" aria-hidden="true" />
            {t('filters.clear')}
          </Button>
        )}
      </DataTableToolbar>

      {error && members.length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={members}
          isLoading={loading && members.length === 0}
          onRowClick={(row) => void setOpenMember(row.id)}
          data-testid={resellerTeam.table}
          emptyState={
            <Empty className="py-12" data-testid={resellerTeam.empty}>
              <EmptyHeader>
                <EmptyMedia variant="icon">{hasFilters ? <SearchX /> : <Users />}</EmptyMedia>
                <EmptyTitle>{hasFilters ? t('empty.title') : t('empty.noData')}</EmptyTitle>
                <EmptyDescription>
                  {hasFilters ? t('empty.description') : t('empty.noDataDescription')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      )}

      <DataTablePagination
        hasNextPage={hasNextPage}
        isLoadingMore={isLoadingMore}
        onLoadMore={handleLoadMore}
        totalCount={totalCount}
        currentCount={members.length}
        labels={{
          loadMore: t('pagination.loadMore'),
          showing: t('pagination.showing'),
          of: t('pagination.of'),
        }}
      />

      <InviteMemberDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <MemberDetailSheet membershipId={openMember} onClose={() => void setOpenMember(null)} />
      {dialog?.kind === 'role' && (
        <ChangeRoleDialog member={dialog.member} onClose={() => setDialog(null)} />
      )}
      {dialog && dialog.kind !== 'role' && (
        <StatusConfirmDialog
          kind={dialog.kind}
          member={dialog.member}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function MemberActions({
  member,
  name,
  onPick,
}: {
  member: TeamMember;
  name: string;
  onPick: (dialog: MemberDialog) => void;
}) {
  const t = useTranslations('resellerTeam');
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            title={t('actions.menu', { name })}
            aria-label={t('actions.menu', { name })}
            data-testid={resellerTeam.actionsBtn(member.id)}
            // The row opens the detail sheet; the menu must not.
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem
            onSelect={() => onPick({ kind: 'role', member })}
            data-testid={resellerTeam.actionChangeRole}
          >
            {t('actions.changeRole')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {member.isActive ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onPick({ kind: 'deactivate', member })}
              data-testid={resellerTeam.actionDeactivate}
            >
              {t('actions.deactivate')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => onPick({ kind: 'reactivate', member })}
              data-testid={resellerTeam.actionReactivate}
            >
              {t('actions.reactivate')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
