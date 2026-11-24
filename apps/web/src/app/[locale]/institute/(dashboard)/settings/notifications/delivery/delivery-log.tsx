'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import type { NotificationChannel, NotificationDeliveryState } from '@roviq/graphql/generated';
import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  DataTablePagination,
  DataTableToolbar,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Label,
  ResponsiveDataTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { ColumnDef } from '@tanstack/react-table';
import { buildCsv, downloadCsv } from '@web/lib/csv';
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Download,
  MinusCircle,
  SearchX,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  buildDeliveryFilter,
  CLEARED_DELIVERY_FILTERS,
  DELIVERY_CHANNELS,
  DELIVERY_MODULES,
  DELIVERY_STATES,
  DELIVERY_TYPES,
  type DeliveryFilters,
  hasActiveDeliveryFilters,
  useDeliveryFilters,
} from './delivery-filters';
import { type DeliveryCopy, useDeliveryCopy } from './use-delivery-copy';
import {
  DELIVERY_PAGE_SIZE,
  type DeliveryLogEntry,
  useNotificationDeliveryLog,
} from './use-notification-delivery-log';

const ids = testIds.notificationDelivery;
const ALL = 'all';

const STATE_STYLE: Record<
  NotificationDeliveryState,
  { className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  READ: { className: 'border-emerald-200 bg-emerald-100 text-emerald-800', icon: CheckCheck },
  DELIVERED: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CheckCheck },
  SENT: { className: 'border-sky-200 bg-sky-50 text-sky-700', icon: Send },
  FAILED: { className: 'border-rose-200 bg-rose-50 text-rose-700', icon: XCircle },
  SKIPPED: { className: 'border-border bg-muted text-muted-foreground', icon: MinusCircle },
  WAITING: { className: 'border-amber-200 bg-amber-50 text-amber-800', icon: Clock },
};

const STATES_WITH_REASON: ReadonlySet<NotificationDeliveryState> = new Set([
  'FAILED',
  'SKIPPED',
  'WAITING',
]);

/** The delivery list with its filters, chips, export and paging. */
export function DeliveryLog() {
  const t = useTranslations('notificationDelivery');
  const copy = useDeliveryCopy();
  const resolveName = useI18nField();
  const { format } = useFormatDate();
  const [filters, setFilters] = useDeliveryFilters();
  const filter = React.useMemo(() => buildDeliveryFilter(filters), [filters]);
  const { entries, totalCount, hasNextPage, loading, error, loadMore, refetch } =
    useNotificationDeliveryLog(filter);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const formatTime = React.useCallback(
    (at: string) => format(new Date(at), 'dd/MM/yyyy, HH:mm'),
    [format],
  );

  const columns = React.useMemo<ColumnDef<DeliveryLogEntry, unknown>[]>(
    () => [
      {
        id: 'time',
        header: t('columns.time'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">{formatTime(row.original.at)}</span>
        ),
      },
      {
        id: 'notification',
        header: t('columns.notification'),
        cell: ({ row }) => <NotificationName entry={row.original} copy={copy} />,
      },
      {
        id: 'about',
        header: t('columns.about'),
        cell: ({ row }) => studentName(row.original, resolveName) || '—',
      },
      {
        id: 'recipient',
        header: t('columns.recipient'),
        cell: ({ row }) => (
          <RecipientName entry={row.original} copy={copy} resolveName={resolveName} />
        ),
      },
      ...DELIVERY_CHANNELS.map(
        (channel): ColumnDef<DeliveryLogEntry, unknown> => ({
          id: channel,
          header: copy.channelName(channel),
          cell: ({ row }) => (
            <ChannelStateCell entry={row.original} channel={channel} copy={copy} withTestIds />
          ),
        }),
      ),
    ],
    [t, copy, resolveName, formatTime],
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      await loadMore();
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleExport = () => {
    const headers = [
      t('columns.time'),
      t('columns.notification'),
      t('columns.about'),
      t('columns.recipient'),
      t('csvRelationship'),
      ...DELIVERY_CHANNELS.map(copy.channelName),
    ];
    const rows = entries.map((entry) => [
      formatTime(entry.at),
      copy.typeName(entry.type),
      studentName(entry, resolveName),
      recipientName(entry, resolveName),
      copy.relationshipName(entry.relationship) ?? '',
      ...DELIVERY_CHANNELS.map((channel) => channelCsvText(entry, channel, copy)),
    ]);
    downloadCsv(
      `notification-delivery-${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsv(headers, rows),
    );
  };

  const errorCode = error ? extractGraphQLErrorCode(error) : null;
  const filtered = hasActiveDeliveryFilters(filters);

  return (
    <div className="space-y-4">
      <DeliveryFilterBar filters={filters} setFilters={setFilters} copy={copy} />
      <FilterChips
        filters={filters}
        setFilters={setFilters}
        entries={entries}
        resolveName={resolveName}
      />

      {error && entries.length === 0 ? (
        <Empty className="border py-12" data-testid={ids.error}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangle />
            </EmptyMedia>
            <EmptyTitle>
              {errorCode && t.has(`errors.${errorCode}`)
                ? t(`errors.${errorCode}`)
                : t('errors.generic')}
            </EmptyTitle>
          </EmptyHeader>
          <Button
            variant="outline"
            size="sm"
            data-testid={ids.retryBtn}
            onClick={() => void refetch()}
          >
            {t('errors.retry')}
          </Button>
        </Empty>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={entries.length === 0}
              title={t('exportTitle')}
              data-testid={ids.exportBtn}
              onClick={handleExport}
            >
              <Download className="me-1 size-4" />
              {t('export')}
            </Button>
          </div>
          {!loading && entries.length === 0 ? (
            <Empty className="border py-12" data-testid={ids.empty}>
              <EmptyHeader>
                <EmptyMedia variant="icon">{filtered ? <SearchX /> : <Send />}</EmptyMedia>
                <EmptyTitle>{filtered ? t('empty.filteredTitle') : t('empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {filtered ? t('empty.filteredDescription') : t('empty.description')}
                </EmptyDescription>
              </EmptyHeader>
              {filtered && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void setFilters(CLEARED_DELIVERY_FILTERS)}
                >
                  <X className="me-1 size-4" />
                  {t('filters.clearAll')}
                </Button>
              )}
            </Empty>
          ) : (
            <ResponsiveDataTable
              data-testid={ids.table}
              columns={columns}
              data={entries}
              getRowId={(entry) => entry.id}
              isLoading={loading && entries.length === 0}
              skeletonRows={DELIVERY_PAGE_SIZE}
              mobileCard={(entry) => (
                <MobileEntryCard
                  entry={entry}
                  copy={copy}
                  resolveName={resolveName}
                  time={formatTime(entry.at)}
                />
              )}
            />
          )}
          <DataTablePagination
            hasNextPage={hasNextPage}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
            totalCount={totalCount}
            currentCount={entries.length}
            labels={{
              loadMore: t('pagination.loadMore'),
              showing: t('pagination.showing'),
              of: t('pagination.of'),
            }}
          />
        </>
      )}
    </div>
  );
}

type SetDeliveryFilters = ReturnType<typeof useDeliveryFilters>[1];
type ResolveName = ReturnType<typeof useI18nField>;

function DeliveryFilterBar({
  filters,
  setFilters,
  copy,
}: {
  filters: DeliveryFilters;
  setFilters: SetDeliveryFilters;
  copy: DeliveryCopy;
}) {
  const t = useTranslations('notificationDelivery');

  return (
    <DataTableToolbar>
      <FilterSelect
        label={t('filters.module')}
        allLabel={t('filters.allModules')}
        value={filters.module}
        options={DELIVERY_MODULES.map((value) => ({ value, label: t(`modules.${value}`) }))}
        onChange={(module) => void setFilters({ module })}
        testId={ids.moduleFilter}
      />
      <FilterSelect
        label={t('filters.type')}
        allLabel={t('filters.allTypes')}
        value={filters.type}
        options={DELIVERY_TYPES.map((value) => ({ value, label: copy.typeName(value) }))}
        onChange={(type) => void setFilters({ type })}
        testId={ids.typeFilter}
      />
      <FilterSelect
        label={t('filters.channel')}
        allLabel={t('filters.allChannels')}
        value={filters.channel}
        options={DELIVERY_CHANNELS.map((value) => ({ value, label: copy.channelName(value) }))}
        onChange={(channel) => void setFilters({ channel })}
        testId={ids.channelFilter}
      />
      <FilterSelect
        label={t('filters.state')}
        allLabel={t('filters.allStates')}
        value={filters.state}
        options={DELIVERY_STATES.map((value) => ({ value, label: copy.stateName(value) }))}
        onChange={(state) => void setFilters({ state })}
        testId={ids.stateFilter}
      />
      <div className="flex items-center gap-2">
        <Label htmlFor={ids.fromInput} className="text-sm text-muted-foreground">
          {t('filters.from')}
        </Label>
        <Input
          id={ids.fromInput}
          type="date"
          className="w-[150px]"
          value={filters.from ?? ''}
          max={filters.to ?? undefined}
          onChange={(e) => void setFilters({ from: e.target.value || null })}
          data-testid={ids.fromInput}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={ids.toInput} className="text-sm text-muted-foreground">
          {t('filters.to')}
        </Label>
        <Input
          id={ids.toInput}
          type="date"
          className="w-[150px]"
          value={filters.to ?? ''}
          min={filters.from ?? undefined}
          onChange={(e) => void setFilters({ to: e.target.value || null })}
          data-testid={ids.toInput}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={ids.criticalOnlySwitch}
          checked={filters.critical === true}
          onCheckedChange={(checked) => void setFilters({ critical: checked ? true : null })}
          data-testid={ids.criticalOnlySwitch}
        />
        <Label htmlFor={ids.criticalOnlySwitch}>{t('filters.criticalOnly')}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={ids.notDeliveredOnlySwitch}
          checked={filters.notDelivered === true}
          onCheckedChange={(checked) => void setFilters({ notDelivered: checked ? true : null })}
          data-testid={ids.notDeliveredOnlySwitch}
        />
        <Label htmlFor={ids.notDeliveredOnlySwitch}>{t('filters.notDeliveredOnly')}</Label>
      </div>
      {hasActiveDeliveryFilters(filters) && (
        <Button
          variant="ghost"
          size="sm"
          data-testid={ids.clearFiltersBtn}
          onClick={() => void setFilters(CLEARED_DELIVERY_FILTERS)}
        >
          <X className="me-1 size-4" />
          {t('filters.clearAll')}
        </Button>
      )}
    </DataTableToolbar>
  );
}

function FilterSelect<T extends string>({
  label,
  allLabel,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  allLabel: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | null) => void;
  testId: string;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(options.find((o) => o.value === next)?.value ?? null)}
    >
      <SelectTrigger className="w-full sm:w-[180px]" aria-label={label} data-testid={testId}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Ids that arrive through links ("Who was notified") show as removable chips. */
function FilterChips({
  filters,
  setFilters,
  entries,
  resolveName,
}: {
  filters: DeliveryFilters;
  setFilters: SetDeliveryFilters;
  entries: readonly DeliveryLogEntry[];
  resolveName: ResolveName;
}) {
  const t = useTranslations('notificationDelivery');

  const chips: { key: 'studentId' | 'sessionId' | 'recipientUserId'; label: string }[] = [];
  if (filters.studentId) {
    const match = entries.find((e) => e.studentMembershipId === filters.studentId);
    const name = match ? studentName(match, resolveName) : '';
    chips.push({
      key: 'studentId',
      label: name ? t('filters.studentChip', { name }) : t('filters.studentChipUnnamed'),
    });
  }
  if (filters.sessionId) {
    chips.push({ key: 'sessionId', label: t('filters.sessionChip') });
  }
  if (filters.recipientUserId) {
    const match = entries.find((e) => e.recipientUserId === filters.recipientUserId);
    const name = match ? recipientName(match, resolveName) : '';
    chips.push({
      key: 'recipientUserId',
      label: name ? t('filters.recipientChip', { name }) : t('filters.recipientChipUnnamed'),
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant="secondary"
          className="gap-1 py-1 ps-3 pe-1"
          data-testid={ids.chip(chip.key)}
        >
          {chip.label}
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t('filters.removeChip', { label: chip.label })}
            title={t('filters.removeChip', { label: chip.label })}
            data-testid={ids.chipRemove(chip.key)}
            onClick={() => void setFilters({ [chip.key]: null })}
          >
            <X className="size-3" />
          </Button>
        </Badge>
      ))}
    </div>
  );
}

function NotificationName({ entry, copy }: { entry: DeliveryLogEntry; copy: DeliveryCopy }) {
  const t = useTranslations('notificationDelivery');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{copy.typeName(entry.type)}</span>
      {entry.critical && (
        <Badge variant="outline" className="border-rose-200 text-rose-700">
          <AlertTriangle className="me-1 size-3" />
          {t('critical')}
        </Badge>
      )}
    </div>
  );
}

function RecipientName({
  entry,
  copy,
  resolveName,
}: {
  entry: DeliveryLogEntry;
  copy: DeliveryCopy;
  resolveName: ResolveName;
}) {
  const relationship = copy.relationshipName(entry.relationship);
  return (
    <div>
      <div>{recipientName(entry, resolveName) || '—'}</div>
      {relationship && <div className="text-xs text-muted-foreground">{relationship}</div>}
    </div>
  );
}

function ChannelStateCell({
  entry,
  channel,
  copy,
  withTestIds,
}: {
  entry: DeliveryLogEntry;
  channel: NotificationChannel;
  copy: DeliveryCopy;
  withTestIds: boolean;
}) {
  const t = useTranslations('notificationDelivery');
  const state = entry.channels.find((c) => c.channel === channel);
  if (!state) {
    return (
      <span
        className="text-muted-foreground"
        title={t('noChannel')}
        data-testid={withTestIds ? ids.channelCell(entry.id, channel) : undefined}
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('noChannel')}</span>
      </span>
    );
  }
  const style = STATE_STYLE[state.state];
  const Icon = style.icon;
  const reason =
    STATES_WITH_REASON.has(state.state) && state.reason ? copy.reasonText(state.reason) : null;

  return (
    <div
      className="flex max-w-[220px] flex-col gap-1"
      data-testid={withTestIds ? ids.channelCell(entry.id, channel) : undefined}
    >
      <Badge variant="outline" className={`w-fit gap-1 ${style.className}`}>
        <Icon className="size-3" />
        {copy.stateName(state.state)}
      </Badge>
      {reason && (
        <span
          className="text-xs text-muted-foreground"
          data-testid={withTestIds ? ids.reason(entry.id, channel) : undefined}
        >
          {reason}
        </span>
      )}
    </div>
  );
}

function MobileEntryCard({
  entry,
  copy,
  resolveName,
  time,
}: {
  entry: DeliveryLogEntry;
  copy: DeliveryCopy;
  resolveName: ResolveName;
  time: string;
}) {
  const student = studentName(entry, resolveName);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <NotificationName entry={entry} copy={copy} />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time}</span>
      </div>
      {student && <div className="text-sm">{student}</div>}
      <RecipientName entry={entry} copy={copy} resolveName={resolveName} />
      <dl className="grid grid-cols-2 gap-2">
        {DELIVERY_CHANNELS.map((channel) => (
          <div key={channel}>
            <dt className="text-xs text-muted-foreground">{copy.channelName(channel)}</dt>
            <dd>
              <ChannelStateCell entry={entry} channel={channel} copy={copy} withTestIds={false} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function channelCsvText(
  entry: DeliveryLogEntry,
  channel: NotificationChannel,
  copy: DeliveryCopy,
): string {
  const state = entry.channels.find((c) => c.channel === channel);
  if (!state) return '—';
  const stateText = copy.stateName(state.state);
  if (!STATES_WITH_REASON.has(state.state) || !state.reason) return stateText;
  return `${stateText}: ${copy.reasonText(state.reason)}`;
}

function studentName(entry: DeliveryLogEntry, resolveName: ResolveName): string {
  return joinName(resolveName(entry.studentFirstName), resolveName(entry.studentLastName));
}

function recipientName(entry: DeliveryLogEntry, resolveName: ResolveName): string {
  return joinName(resolveName(entry.recipientFirstName), resolveName(entry.recipientLastName));
}

function joinName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(' ');
}
