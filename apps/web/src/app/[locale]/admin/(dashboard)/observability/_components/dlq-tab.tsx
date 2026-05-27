'use client';

import type { DlqStatus } from '@roviq/graphql/generated';
import { useFormatDate } from '@roviq/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Can,
  DataTable,
  DataTablePagination,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Ban,
  Clock,
  Inbox,
  MoreHorizontal,
  RotateCcw,
  Search,
  SearchX,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import {
  type DlqMessageNode,
  useDiscardDlqMessage,
  useDlqMessages,
  useReplayDlqMessage,
} from '../_lib/dlq.graphql';

const { dlq } = testIds;
const PAGE_SIZE = 20;
const STATUS_VALUES = ['PENDING', 'REPLAYED', 'DISCARDED'] as const satisfies readonly DlqStatus[];

const STATUS_META: Record<
  DlqStatus,
  { variant: 'secondary' | 'default' | 'destructive'; Icon: typeof Clock }
> = {
  PENDING: { variant: 'secondary', Icon: Clock },
  REPLAYED: { variant: 'default', Icon: RotateCcw },
  DISCARDED: { variant: 'destructive', Icon: Ban },
};

const filterParsers = {
  originStream: parseAsString,
  status: parseAsStringLiteral(STATUS_VALUES),
};

export function DlqTab() {
  const t = useTranslations('dlq');
  const { format } = useFormatDate();

  const [filters, setFilters] = useQueryStates(filterParsers);
  const hasFilters = Boolean(filters.originStream) || Boolean(filters.status);

  const [selected, setSelected] = React.useState<DlqMessageNode | null>(null);
  const [replayTarget, setReplayTarget] = React.useState<DlqMessageNode | null>(null);
  const [discardTarget, setDiscardTarget] = React.useState<DlqMessageNode | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const queryFilter = React.useMemo(
    () => ({
      first: PAGE_SIZE,
      ...(filters.originStream ? { originStream: filters.originStream } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    }),
    [filters.originStream, filters.status],
  );

  const { messages, totalCount, hasNextPage, loading, error, loadMore, refetch } = useDlqMessages({
    filter: queryFilter,
  });

  const [replayMessage, { loading: replaying }] = useReplayDlqMessage();
  const [discardMessage, { loading: discarding }] = useDiscardDlqMessage();

  const formatDate = React.useCallback(
    (value: string) => format(new Date(value), 'dd MMM yyyy, HH:mm:ss'),
    [format],
  );

  const columns = React.useMemo<ColumnDef<DlqMessageNode, unknown>[]>(
    () => [
      {
        accessorKey: 'originStream',
        header: t('columns.originStream'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.originStream}</span>,
      },
      {
        accessorKey: 'originalSubject',
        header: t('columns.subject'),
        cell: ({ row }) => (
          <span className="block max-w-[200px] truncate font-mono text-xs">
            {row.original.originalSubject}
          </span>
        ),
      },
      {
        accessorKey: 'error',
        header: t('columns.error'),
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate text-xs text-muted-foreground">
            {row.original.error}
          </span>
        ),
      },
      {
        accessorKey: 'tenantId',
        header: t('columns.tenant'),
        cell: ({ row }) =>
          row.original.tenantId ? (
            <span className="font-mono text-xs">{row.original.tenantId.slice(0, 8)}</span>
          ) : (
            <span className="text-muted-foreground">{t('none')}</span>
          ),
      },
      {
        accessorKey: 'retryCount',
        header: t('columns.retries'),
        cell: ({ row }) => <span className="tabular-nums text-xs">{row.original.retryCount}</span>,
      },
      {
        accessorKey: 'failedAt',
        header: t('columns.failedAt'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs">{formatDate(row.original.failedAt)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('columns.status'),
        cell: ({ row }) => {
          const { variant, Icon } = STATUS_META[row.original.status];
          return (
            <Badge variant={variant} data-testid={dlq.statusBadge(row.original.id)}>
              <Icon className="size-3" aria-hidden />
              {t(`status.${row.original.status}`)}
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: t('columns.actions'),
        cell: ({ row }) => {
          const message = row.original;
          const canAct = message.status === 'PENDING';
          return (
            <Can I="replay" a="DlqMessage">
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canAct}
                  title={t('actions.replay')}
                  data-testid={dlq.replayBtn(message.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setReplayTarget(message);
                  }}
                >
                  <RotateCcw className="me-1 size-3.5" />
                  {t('actions.replay')}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('actions.openMenu')}
                      aria-label={t('actions.openMenu')}
                      data-testid={dlq.actionsMenu(message.id)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    // Row is clickable (opens inspect). Stop menu clicks bubbling
                    // to it, else selecting an item also fires the row click.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem
                      data-testid={dlq.inspectBtn(message.id)}
                      onSelect={() => setSelected(message)}
                    >
                      <Search className="me-2 size-4" />
                      {t('actions.inspect')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!canAct}
                      data-testid={dlq.discardAction(message.id)}
                      onSelect={() => setDiscardTarget(message)}
                    >
                      <Ban className="me-2 size-4" />
                      {t('actions.discard')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Can>
          );
        },
      },
    ],
    [t, formatDate],
  );

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      await loadMore();
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleReplay = async () => {
    if (!replayTarget) return;
    const id = replayTarget.id;
    setReplayTarget(null);
    try {
      await replayMessage({ variables: { id } });
      toast.success(t('toasts.replaySuccess'));
      await refetch();
    } catch {
      toast.error(t('toasts.replayError'));
    }
  };

  const handleDiscard = async () => {
    if (!discardTarget) return;
    const id = discardTarget.id;
    setDiscardTarget(null);
    try {
      await discardMessage({ variables: { id } });
      toast.success(t('toasts.discardSuccess'));
      await refetch();
    } catch {
      toast.error(t('toasts.discardError'));
    }
  };

  if (error) {
    return (
      <Empty className="py-12" data-testid={dlq.error}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>{t('error.title')}</EmptyTitle>
          <EmptyDescription>{t('error.description')}</EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          size="sm"
          data-testid={dlq.errorRetryBtn}
          onClick={() => void refetch()}
        >
          {t('error.retry')}
        </Button>
      </Empty>
    );
  }

  return (
    <div className="space-y-4" data-testid={dlq.content}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <DlqFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters({ originStream: null, status: null })}
        hasFilters={hasFilters}
      />

      <DataTable
        data-testid={dlq.table}
        columns={columns}
        data={messages}
        isLoading={loading && messages.length === 0}
        skeletonRows={PAGE_SIZE}
        onRowClick={setSelected}
        emptyState={
          hasFilters ? (
            <Empty className="py-12" data-testid={dlq.emptyFiltered}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>{t('emptyFiltered.title')}</EmptyTitle>
                <EmptyDescription>{t('emptyFiltered.description')}</EmptyDescription>
              </EmptyHeader>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ originStream: null, status: null })}
              >
                {t('filters.clearFilters')}
              </Button>
            </Empty>
          ) : (
            <Empty className="py-12" data-testid={dlq.empty}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>{t('empty.title')}</EmptyTitle>
                <EmptyDescription>{t('empty.description')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        }
      />

      <DataTablePagination
        hasNextPage={hasNextPage}
        isLoadingMore={isLoadingMore}
        onLoadMore={handleLoadMore}
        totalCount={totalCount}
        currentCount={messages.length}
        labels={{
          loadMore: t('pagination.loadMore'),
          showing: t('pagination.showing'),
          of: t('pagination.of'),
        }}
      />

      <DlqInspectSheet
        message={selected}
        onClose={() => setSelected(null)}
        formatDate={formatDate}
      />

      <AlertDialog
        open={replayTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReplayTarget(null);
        }}
      >
        <AlertDialogContent data-testid={dlq.replayDialog}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('replayDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('replayDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={dlq.replayCancelBtn}>
              {t('replayDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid={dlq.replayConfirmBtn}
              disabled={replaying}
              onClick={(e) => {
                e.preventDefault();
                void handleReplay();
              }}
            >
              {replaying && <Spinner className="me-2" />}
              {t('replayDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={discardTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
      >
        <AlertDialogContent data-testid={dlq.discardDialog}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={dlq.discardCancelBtn}>
              {t('discardDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid={dlq.discardConfirmBtn}
              disabled={discarding}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleDiscard();
              }}
            >
              {discarding && <Spinner className="me-2" />}
              {t('discardDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DlqFilters({
  filters,
  onChange,
  onClear,
  hasFilters,
}: {
  filters: { originStream: string | null; status: DlqStatus | null };
  onChange: (next: { originStream?: string | null; status?: DlqStatus | null }) => void;
  onClear: () => void;
  hasFilters: boolean;
}) {
  const t = useTranslations('dlq');
  return (
    <DataTableToolbar>
      <Input
        className="w-[200px]"
        placeholder={t('filters.originStreamPlaceholder')}
        aria-label={t('filters.originStream')}
        value={filters.originStream ?? ''}
        data-testid={dlq.streamFilter}
        onChange={(e) => onChange({ originStream: e.target.value || null })}
      />
      <Select
        value={filters.status ?? ''}
        onValueChange={(value) => onChange({ status: (value as DlqStatus) || null })}
      >
        <SelectTrigger
          className="w-[160px]"
          aria-label={t('filters.status')}
          data-testid={dlq.statusFilter}
        >
          <SelectValue placeholder={t('filters.statusPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {STATUS_VALUES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasFilters && (
        <Button variant="ghost" size="sm" data-testid={dlq.clearFilters} onClick={onClear}>
          <X className="me-1 size-4" />
          {t('filters.clearFilters')}
        </Button>
      )}
    </DataTableToolbar>
  );
}

function DlqInspectSheet({
  message,
  onClose,
  formatDate,
}: {
  message: DlqMessageNode | null;
  onClose: () => void;
  formatDate: (value: string) => string;
}) {
  const t = useTranslations('dlq');

  return (
    <Sheet open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="flex w-[520px] flex-col overflow-hidden p-0 sm:max-w-[520px]"
        data-testid={dlq.inspectSheet}
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{t('inspect.title')}</SheetTitle>
          <SheetDescription>{t('inspect.description')}</SheetDescription>
        </SheetHeader>
        {message && (
          <ScrollArea className="flex-1">
            <div className="space-y-3 px-6 py-4">
              <InspectRow label={t('inspect.subject')} value={message.originalSubject} mono />
              <InspectRow label={t('inspect.stream')} value={message.originStream} mono />
              <InspectRow label={t('inspect.correlationId')} value={message.correlationId} mono />
              <InspectRow label={t('inspect.tenant')} value={message.tenantId ?? t('none')} mono />
              <InspectRow label={t('inspect.retryCount')} value={String(message.retryCount)} />
              <InspectRow label={t('inspect.replayCount')} value={String(message.replayCount)} />
              <InspectRow label={t('inspect.failedAt')} value={formatDate(message.failedAt)} />
              <InspectRow
                label={t('inspect.replayedAt')}
                value={message.replayedAt ? formatDate(message.replayedAt) : t('none')}
              />

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('inspect.payload')}
                </p>
                <pre className="max-h-[260px] overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground/80">
                  {message.payload
                    ? JSON.stringify(message.payload, null, 2)
                    : t('inspect.noPayload')}
                </pre>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('inspect.error')}
                </p>
                <pre className="max-h-[240px] overflow-auto rounded-lg border bg-destructive/5 p-3 font-mono text-xs leading-relaxed text-foreground/80">
                  {message.error || t('inspect.noError')}
                </pre>
              </div>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InspectRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`min-w-0 break-all text-sm ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}
