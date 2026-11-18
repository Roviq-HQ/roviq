'use client';

import {
  Button,
  DataTableToolbar,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDebounce,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsIsoDate, parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';

const { adminUsers } = testIds;

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'LOCKED'] as const;
const SCOPES = ['institute', 'reseller', 'platform'] as const;

const filterParsers = {
  search: parseAsString,
  status: parseAsString,
  institute: parseAsBoolean,
  reseller: parseAsBoolean,
  platform: parseAsBoolean,
  createdAfter: parseAsIsoDate,
  createdBefore: parseAsIsoDate,
};

const CLEARED = {
  search: null,
  status: null,
  institute: null,
  reseller: null,
  platform: null,
  createdAfter: null,
  createdBefore: null,
};

export function useUserFilters() {
  return useQueryStates(filterParsers);
}

function toDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : '';
}

export function UserFilters() {
  const t = useTranslations('adminUsers');
  const [filters, setFilters] = useUserFilters();
  const [searchInput, setSearchInput] = React.useState(filters.search ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);

  React.useEffect(() => {
    setFilters({ search: debouncedSearch || null });
  }, [debouncedSearch, setFilters]);

  const hasFilters = Object.values(filters).some((v) => v !== null && v !== '');

  return (
    <DataTableToolbar>
      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute start-2.5 top-2 size-4 text-muted-foreground" />
        <Input
          data-testid={adminUsers.searchInput}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('filters.search')}
          aria-label={t('filters.search')}
          className="ps-8"
        />
      </div>

      <Select
        value={filters.status ?? '__all__'}
        onValueChange={(v) => setFilters({ status: v === '__all__' ? null : v })}
      >
        <SelectTrigger
          className="w-[160px]"
          aria-label={t('filters.allStatuses')}
          data-testid={adminUsers.statusFilter}
        >
          <SelectValue placeholder={t('filters.allStatuses')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t('filters.allStatuses')}</SelectItem>
          {USER_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`statuses.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <fieldset className="flex items-center gap-1" aria-label={t('filters.scopeLabel')}>
        {SCOPES.map((scope) => {
          const active = filters[scope] === true;
          return (
            <Button
              key={scope}
              type="button"
              size="sm"
              variant={active ? 'default' : 'outline'}
              className="rounded-full"
              aria-pressed={active}
              title={t(`filters.scopeHint.${scope}`)}
              data-testid={adminUsers.scopeFilter(scope)}
              onClick={() => setFilters({ [scope]: active ? null : true })}
            >
              {t(`filters.scope.${scope}`)}
            </Button>
          );
        })}
      </fieldset>

      <Input
        type="date"
        value={toDateInput(filters.createdAfter)}
        onChange={(e) =>
          setFilters({ createdAfter: e.target.value ? new Date(e.target.value) : null })
        }
        className="w-[150px]"
        aria-label={t('filters.createdAfter')}
        title={t('filters.createdAfter')}
        data-testid={adminUsers.createdAfter}
      />
      <Input
        type="date"
        value={toDateInput(filters.createdBefore)}
        onChange={(e) =>
          setFilters({ createdBefore: e.target.value ? new Date(e.target.value) : null })
        }
        className="w-[150px]"
        aria-label={t('filters.createdBefore')}
        title={t('filters.createdBefore')}
        data-testid={adminUsers.createdBefore}
      />

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          data-testid={adminUsers.clearFilters}
          onClick={() => {
            setSearchInput('');
            setFilters(CLEARED);
          }}
        >
          <X className="me-1 size-4" />
          {t('filters.clearFilters')}
        </Button>
      )}
    </DataTableToolbar>
  );
}
