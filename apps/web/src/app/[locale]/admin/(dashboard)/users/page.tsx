'use client';

import type { AdminListUsersFilterInput, UserStatus } from '@roviq/graphql/generated';
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
import { SearchX, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import type { UserListNode } from './types';
import { PAGE_SIZE, useUsers } from './use-users';
import { createUserColumns } from './user-columns';
import { USER_STATUSES, UserFilters, useUserFilters } from './user-filters';
import { UserJumpSearch } from './user-jump-search';
import { UserStats } from './user-stats';

const { adminUsers } = testIds;

function isUserStatus(value: string | null): value is UserStatus {
  return USER_STATUSES.some((s) => s === value);
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export default function UsersPage() {
  const t = useTranslations('adminUsers');
  const { format, formatDistance } = useFormatDate();
  const resolveI18n = useI18nField();
  const router = useRouter();
  const [filters] = useUserFilters();
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const queryFilter = React.useMemo<AdminListUsersFilterInput>(() => {
    const f: AdminListUsersFilterInput = {};
    if (filters.search) f.search = filters.search;
    if (isUserStatus(filters.status)) f.status = [filters.status];
    if (filters.institute) f.hasInstituteMembership = true;
    if (filters.reseller) f.hasResellerMembership = true;
    if (filters.platform) f.hasPlatformMembership = true;
    if (filters.createdAfter) f.createdAfter = filters.createdAfter.toISOString();
    if (filters.createdBefore) f.createdBefore = endOfDay(filters.createdBefore).toISOString();
    return f;
  }, [filters]);

  const { users, totalCount, hasNextPage, loading, error, loadMore, refetch } =
    useUsers(queryFilter);

  const columns = React.useMemo(
    () =>
      createUserColumns({
        t,
        resolveName: (user: UserListNode) =>
          user.profile
            ? [resolveI18n(user.profile.firstName), resolveI18n(user.profile.lastName)]
                .filter(Boolean)
                .join(' ')
            : '',
        formatDate: (d) => format(d, 'dd/MM/yyyy'),
        formatRelative: (d) => formatDistance(d, new Date()),
      }),
    [t, resolveI18n, format, formatDistance],
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      await loadMore();
    } finally {
      setIsLoadingMore(false);
    }
  };

  const hasFilters = Object.keys(queryFilter).length > 0;

  return (
    <div className="space-y-4" data-testid={adminUsers.page}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid={adminUsers.title}>
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <UserJumpSearch />
      </div>

      <UserStats />

      <UserFilters />

      {error && users.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyTitle>{t('loadFailed')}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </Empty>
      ) : (
        <DataTable
          data-testid={adminUsers.table}
          columns={columns}
          data={users}
          isLoading={loading && users.length === 0}
          skeletonRows={PAGE_SIZE}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/admin/users/${row.id}`)}
          emptyState={
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">{hasFilters ? <SearchX /> : <Users />}</EmptyMedia>
                <EmptyTitle
                  data-testid={hasFilters ? adminUsers.emptyFilteredTitle : adminUsers.emptyTitle}
                >
                  {hasFilters ? t('empty.filteredTitle') : t('empty.title')}
                </EmptyTitle>
                <EmptyDescription>
                  {hasFilters ? t('empty.filteredDescription') : t('empty.description')}
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
        currentCount={users.length}
        labels={{
          loadMore: t('pagination.loadMore'),
          showing: t('pagination.showing'),
          of: t('pagination.of'),
        }}
      />
    </div>
  );
}
