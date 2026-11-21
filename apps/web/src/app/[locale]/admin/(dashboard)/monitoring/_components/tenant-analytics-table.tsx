'use client';

import { useQuery } from '@roviq/graphql';
import type { SortOrder, TenantAnalyticsSortField } from '@roviq/graphql/generated';
import { useFormatNumber, useI18nField } from '@roviq/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Sparkline } from '@web/components/metrics/sparkline';
import { formatBytes } from '@web/lib/format-bytes';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import * as React from 'react';
import {
  AdminMonitoringResellersDocument,
  AdminTenantAnalyticsDocument,
} from '../_lib/tenant-analytics.graphql.generated';
import { nextTenantSort, SORT_ORDERS, TENANT_SORT_FIELDS } from '../_lib/tenant-sort';
import { SectionError } from './section-error';

const { adminMonitoring: ids } = testIds;

export const TENANT_PAGE_SIZE = 25;
export const TENANT_POLL_MS = 60_000;
const ALL_RESELLERS = '__all__';

const tenantFilterParsers = {
  sort: parseAsStringLiteral(TENANT_SORT_FIELDS).withDefault('API_CALLS_24H'),
  order: parseAsStringLiteral(SORT_ORDERS).withDefault('DESC'),
  reseller: parseAsString,
};

export function TenantAnalyticsTable() {
  const t = useTranslations('adminMonitoring.tenants');
  const ti = useI18nField();
  const { format: formatNumber } = useFormatNumber();
  const [filters, setFilters] = useQueryStates(tenantFilterParsers);

  // Cursor stack is tied to the sort/filter it was built under; a change starts at page 1.
  const queryKey = `${filters.sort}|${filters.order}|${filters.reseller ?? ''}`;
  const [pages, setPages] = React.useState<{ key: string; cursors: (string | null)[] }>({
    key: queryKey,
    cursors: [null],
  });
  const cursors = pages.key === queryKey ? pages.cursors : [null];
  const pageIndex = cursors.length - 1;

  const { data, previousData, loading, error, refetch } = useQuery(AdminTenantAnalyticsDocument, {
    variables: {
      first: TENANT_PAGE_SIZE,
      after: cursors[pageIndex] ?? null,
      sortBy: filters.sort,
      sortOrder: filters.order,
      resellerId: filters.reseller,
    },
    pollInterval: TENANT_POLL_MS,
  });
  const { data: resellerData } = useQuery(AdminMonitoringResellersDocument);

  const connection = (data ?? previousData)?.adminTenantAnalytics;
  const rows = connection?.edges.map((e) => e.node) ?? [];
  const resellers = resellerData?.adminListResellers.edges.map((e) => e.node) ?? [];

  const onSort = (field: TenantAnalyticsSortField) => {
    const next = nextTenantSort({ field: filters.sort, order: filters.order }, field);
    void setFilters({ sort: next.field, order: next.order });
  };

  const goNext = () => {
    const endCursor = connection?.pageInfo.endCursor;
    if (!endCursor) return;
    setPages({ key: queryKey, cursors: [...cursors, endCursor] });
  };
  const goPrevious = () => {
    if (pageIndex === 0) return;
    setPages({ key: queryKey, cursors: cursors.slice(0, -1) });
  };

  const formatMetric = (value: number | null) => (value === null ? '—' : formatNumber(value));
  const from = rows.length > 0 ? pageIndex * TENANT_PAGE_SIZE + 1 : 0;
  const to = pageIndex * TENANT_PAGE_SIZE + rows.length;

  return (
    <Card data-testid={ids.tenantTable}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('heading')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <div className="flex flex-col gap-1 sm:w-56">
          <label htmlFor="monitoring-reseller-filter" className="text-xs text-muted-foreground">
            {t('resellerFilter')}
          </label>
          <Select
            value={filters.reseller ?? ALL_RESELLERS}
            onValueChange={(v) => void setFilters({ reseller: v === ALL_RESELLERS ? null : v })}
          >
            <SelectTrigger
              id="monitoring-reseller-filter"
              className="w-full"
              data-testid={ids.tenantResellerFilter}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_RESELLERS}>{t('allResellers')}</SelectItem>
              {resellers.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {connection && !connection.metricsAvailable ? (
          <Alert data-testid={ids.tenantMetricsUnavailable}>
            <Info aria-hidden="true" />
            <AlertDescription>{t('metricsUnavailable')}</AlertDescription>
          </Alert>
        ) : null}

        {error && !connection ? (
          <SectionError
            error={error}
            onRetry={() => void refetch()}
            testId={ids.tenantError}
            retryTestId={ids.tenantRetryBtn}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-busy={loading && !connection}>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    field="INSTITUTE_NAME"
                    label={t('columns.institute')}
                    sort={filters.sort}
                    order={filters.order}
                    onSort={onSort}
                  />
                  <TableHead className="hidden md:table-cell">{t('columns.reseller')}</TableHead>
                  <SortableHead
                    field="ACTIVE_USERS_24H"
                    label={t('columns.activeUsers')}
                    sort={filters.sort}
                    order={filters.order}
                    onSort={onSort}
                    numeric
                  />
                  <SortableHead
                    field="API_CALLS_24H"
                    label={t('columns.apiCalls')}
                    sort={filters.sort}
                    order={filters.order}
                    onSort={onSort}
                    numeric
                  />
                  <SortableHead
                    field="STORAGE_USED"
                    label={t('columns.storage')}
                    sort={filters.sort}
                    order={filters.order}
                    onSort={onSort}
                    numeric
                  />
                  <TableHead className="hidden sm:table-cell">{t('columns.trend')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!connection && loading
                  ? Array.from({ length: 5 }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders with no identity
                      <TableRow key={i}>
                        {Array.from({ length: 6 }, (__, j) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders with no identity
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : rows.map((row) => {
                      const name = ti(row.instituteName);
                      const trend = row.activityTrend7d;
                      return (
                        <TableRow
                          key={row.instituteId}
                          data-testid={ids.tenantRow(row.instituteId)}
                        >
                          <TableCell className="max-w-[16rem] font-medium">
                            <span className="block truncate">{name}</span>
                            <span className="block truncate text-xs text-muted-foreground md:hidden">
                              {row.resellerName}
                            </span>
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {row.resellerName}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatNumber(row.activeUsers24h)}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatMetric(row.apiCalls24h)}
                          </TableCell>
                          <TableCell
                            className="text-end tabular-nums"
                            data-testid={ids.tenantStorage(row.instituteId)}
                          >
                            {row.storageUsedBytes > 0
                              ? formatBytes(row.storageUsedBytes, formatNumber)
                              : '—'}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">
                            <Sparkline
                              data={trend}
                              label={t('trendLabel', {
                                institute: name,
                                values: trend ? trend.join(', ') : '—',
                              })}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
            {connection && rows.length === 0 ? (
              <Empty className="py-10" data-testid={ids.tenantEmpty}>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Building2 />
                  </EmptyMedia>
                  <EmptyTitle>{filters.reseller ? t('emptyFiltered') : t('empty')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : null}
          </div>
        )}

        {connection && connection.totalCount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground" data-testid={ids.tenantPageInfo}>
              {t('pageInfo', {
                from: formatNumber(from),
                to: formatNumber(to),
                total: formatNumber(connection.totalCount),
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrevious}
                disabled={pageIndex === 0}
                title={t('previousTitle')}
                data-testid={ids.tenantPrevPage}
              >
                <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
                {t('previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={!connection.pageInfo.hasNextPage}
                title={t('nextTitle')}
                data-testid={ids.tenantNextPage}
              >
                {t('next')}
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface SortableHeadProps {
  field: TenantAnalyticsSortField;
  label: string;
  sort: TenantAnalyticsSortField;
  order: SortOrder;
  onSort: (field: TenantAnalyticsSortField) => void;
  numeric?: boolean;
}

function SortableHead({ field, label, sort, order, onSort, numeric = false }: SortableHeadProps) {
  const t = useTranslations('adminMonitoring.tenants');
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : order === 'ASC' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={numeric ? 'text-end' : undefined}
      aria-sort={active ? (order === 'ASC' ? 'ascending' : 'descending') : 'none'}
    >
      <Button
        variant="ghost"
        size="sm"
        className={numeric ? '-me-2' : '-ms-2'}
        onClick={() => onSort(field)}
        title={t('sortBy', { column: label })}
        data-testid={ids.tenantSort(field)}
      >
        {label}
        <Icon
          className={active ? 'size-3.5' : 'size-3.5 text-muted-foreground'}
          aria-label={active ? t(order === 'ASC' ? 'sortedAsc' : 'sortedDesc') : undefined}
          aria-hidden={active ? undefined : true}
        />
      </Button>
    </TableHead>
  );
}
