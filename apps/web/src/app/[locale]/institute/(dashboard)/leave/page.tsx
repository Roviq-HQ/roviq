'use client';

import { isCalendarDate } from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { Link, useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Card,
  CardContent,
  DataTable,
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { type ColumnDef, createColumnHelper } from '@tanstack/react-table';
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  Eye,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import { useStudents } from '../people/students/use-students';
import { ApplicantPicker } from './applicant-picker';
import { applicantFactsByMembership, leaveSubject, useReadsOthersLeaves } from './leave-abilities';
import { leaveApplicantLabel } from './leave-applicant';
import { LeaveCancelAction } from './leave-cancel-action';
import { leaveActionErrorKey } from './leave-errors';
import {
  LEAVE_STATUS_VALUES,
  LEAVE_TYPE_VALUES,
  type LeaveRecord,
  type LeaveStatus,
  type LeaveType,
  useApproveLeave,
  useLeaves,
  useRejectLeave,
} from './use-leave';

const { instituteLeave } = testIds;
// Status chip colours — palette requested by the spec.
const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-100 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-700 border-slate-200',
};

function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

export default function LeavesPage() {
  const t = useTranslations('leave');

  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('all'));
  const [userId, setUserId] = useQueryState('userId', parseAsString);
  const [status, setStatus] = useQueryState('status', parseAsString);
  const [type, setType] = useQueryState('type', parseAsString);
  const [startDate, setStartDate] = useQueryState('startDate', parseAsString);
  const [endDate, setEndDate] = useQueryState('endDate', parseAsString);

  // A hand-edited or stale URL date would fail every request; drop it so the list loads.
  const validStartDate = startDate && isCalendarDate(startDate) ? startDate : null;
  const validEndDate = endDate && isCalendarDate(endDate) ? endDate : null;
  React.useEffect(() => {
    if (startDate && !validStartDate) void setStartDate(null);
  }, [startDate, validStartDate, setStartDate]);
  React.useEffect(() => {
    if (endDate && !validEndDate) void setEndDate(null);
  }, [endDate, validEndDate, setEndDate]);

  const filters: LeaveFiltersProps = {
    userId,
    status: isLeaveStatus(status) ? status : null,
    type: isLeaveType(type) ? type : null,
    startDate: validStartDate,
    endDate: validEndDate,
    onUserIdChange: setUserId,
    onStatusChange: setStatus,
    onTypeChange: setType,
    onStartDateChange: setStartDate,
    onEndDateChange: setEndDate,
  };

  return (
    <Can I="read" a="Leave" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6">
            <header className="flex items-center justify-between gap-4">
              <div>
                <h1
                  className="text-2xl font-semibold tracking-tight flex items-center gap-2"
                  data-testid={instituteLeave.title}
                >
                  <CalendarOff className="size-6 text-primary" />
                  {t('title')}
                </h1>
              </div>
              <Can I="create" a="Leave">
                <Button asChild size="sm" className="gap-2" data-testid={instituteLeave.applyLink}>
                  <Link href="/leave/apply">
                    <Plus className="size-4" />
                    {t('applyCta')}
                  </Link>
                </Button>
              </Can>
            </header>

            {/* The pending tab is a decision queue, so only for those who may decide leaves. */}
            <Can I="update" a="Leave" passThrough>
              {(canDecide: boolean) =>
                canDecide ? (
                  <Tabs value={tab} onValueChange={(v) => void setTab(v)}>
                    <TabsList data-testid={instituteLeave.tabs}>
                      <TabsTrigger value="all" data-testid={instituteLeave.tabAll}>
                        {t('all')}
                      </TabsTrigger>
                      <TabsTrigger value="pending" data-testid={instituteLeave.tabPending}>
                        {t('pending')}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="all" className="mt-4">
                      <LeavesTab filters={filters} />
                    </TabsContent>
                    <TabsContent value="pending" className="mt-4">
                      <LeavesTab filters={filters} pendingOnly />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <LeavesTab filters={filters} />
                )
              }
            </Can>
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-muted-foreground" data-testid={instituteLeave.accessDenied}>
              {t('accessDenied')}
            </p>
          </div>
        )
      }
    </Can>
  );
}

function isLeaveStatus(value: string | null): value is LeaveStatus {
  return value != null && (LEAVE_STATUS_VALUES as readonly string[]).includes(value);
}

function isLeaveType(value: string | null): value is LeaveType {
  return value != null && (LEAVE_TYPE_VALUES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────
// One tab: filters + DataTable. The pending tab fixes the status.
// ─────────────────────────────────────────────────────────────────────

interface LeaveFiltersProps {
  userId: string | null;
  status: LeaveStatus | null;
  type: LeaveType | null;
  startDate: string | null;
  endDate: string | null;
  onUserIdChange: (next: string | null) => Promise<URLSearchParams>;
  onStatusChange: (next: string | null) => Promise<URLSearchParams>;
  onTypeChange: (next: string | null) => Promise<URLSearchParams>;
  onStartDateChange: (next: string | null) => Promise<URLSearchParams>;
  onEndDateChange: (next: string | null) => Promise<URLSearchParams>;
}

function LeavesTab({
  filters,
  pendingOnly = false,
}: {
  filters: LeaveFiltersProps;
  pendingOnly?: boolean;
}) {
  const { leaves, loading, error, refetch } = useLeaves({
    userId: filters.userId,
    status: pendingOnly ? 'PENDING' : filters.status,
    type: filters.type,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  return (
    <div className="space-y-4">
      <LeaveFilters {...filters} showStatus={!pendingOnly} />
      <LeavesTable
        leaves={leaves}
        loading={loading}
        failed={Boolean(error)}
        onRetry={() => void refetch()}
      />
    </div>
  );
}

function LeaveFilters({
  userId,
  status,
  type,
  startDate,
  endDate,
  onUserIdChange,
  onStatusChange,
  onTypeChange,
  onStartDateChange,
  onEndDateChange,
  showStatus,
}: LeaveFiltersProps & { showStatus: boolean }) {
  const t = useTranslations('leave');
  const readsOthers = useReadsOthersLeaves();
  const columns = 3 + (readsOthers ? 1 : 0) + (showStatus ? 1 : 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className={`grid grid-cols-1 gap-3 ${GRID_COLUMNS[columns]}`}>
          {/* Someone who reads only their own or their children's leaves has no one to filter by. */}
          {readsOthers ? (
            <div>
              <span className="text-xs font-medium text-muted-foreground mb-1 block">
                {t('fields.userId')}
              </span>
              <ApplicantPicker
                value={userId}
                onChange={(v) => void onUserIdChange(v)}
                clearable
                testIds={{
                  trigger: instituteLeave.userPicker,
                  input: instituteLeave.userPickerInput,
                  clear: instituteLeave.userPickerClear,
                  option: instituteLeave.userPickerOption,
                }}
              />
            </div>
          ) : null}
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1 block">
              {t('fields.type')}
            </span>
            <Select
              value={type ?? '__all__'}
              onValueChange={(v) => void onTypeChange(v === '__all__' ? null : v)}
            >
              <SelectTrigger data-testid={instituteLeave.filterType}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('filters.any')}</SelectItem>
                {LEAVE_TYPE_VALUES.map((v) => (
                  <SelectItem key={v} value={v} data-testid={`leave-filter-type-${v}`}>
                    {t(`type.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showStatus ? (
            <div>
              <span className="text-xs font-medium text-muted-foreground mb-1 block">
                {t('filters.status')}
              </span>
              <Select
                value={status ?? '__all__'}
                onValueChange={(v) => void onStatusChange(v === '__all__' ? null : v)}
              >
                <SelectTrigger data-testid={instituteLeave.filterStatus}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('filters.any')}</SelectItem>
                  {LEAVE_STATUS_VALUES.map((v) => (
                    <SelectItem key={v} value={v} data-testid={`leave-filter-status-${v}`}>
                      {t(`status.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1 block">
              {t('fields.startDate')}
            </span>
            <Input
              type="date"
              value={startDate ?? ''}
              onChange={(e) => void onStartDateChange(e.target.value || null)}
              data-testid={instituteLeave.filterStartDate}
            />
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1 block">
              {t('fields.endDate')}
            </span>
            <Input
              type="date"
              value={endDate ?? ''}
              onChange={(e) => void onEndDateChange(e.target.value || null)}
              data-testid={instituteLeave.filterEndDate}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Literal class names so Tailwind sees them.
const GRID_COLUMNS: Record<number, string> = {
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
};

// ─────────────────────────────────────────────────────────────────────
// Shared DataTable
// ─────────────────────────────────────────────────────────────────────

interface LeavesTableProps {
  leaves: LeaveRecord[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

function LeavesTable({ leaves, loading, failed, onRetry }: LeavesTableProps) {
  const t = useTranslations('leave');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const { approve, loading: approving } = useApproveLeave();
  const { reject, loading: rejecting } = useRejectLeave();

  // Students are loaded for the approval rules below; names come with each leave.
  const { students } = useStudents({ first: 200 });
  const factsByMembership = React.useMemo(() => applicantFactsByMembership(students), [students]);

  async function runAction(
    fn: (id: string) => Promise<unknown>,
    id: string,
    done: 'approved' | 'rejected',
  ): Promise<void> {
    try {
      await fn(id);
      toast.success(t(`toasts.${done}`));
    } catch (err) {
      toast.error(t(`errors.action.${leaveActionErrorKey(extractGraphQLErrorCode(err))}`));
    }
  }

  const columnHelper = createColumnHelper<LeaveRecord>();
  const columns: ColumnDef<LeaveRecord, unknown>[] = [
    columnHelper.accessor('userId', {
      header: t('fields.userId'),
      cell: ({ row }) => {
        const label =
          leaveApplicantLabel(row.original.applicant, resolveI18n) ?? t('applicantUnknown');
        return (
          <span
            className="font-medium truncate"
            data-testid={`leave-row-${row.original.id}-applicant`}
          >
            {label}
          </span>
        );
      },
    }) as ColumnDef<LeaveRecord, unknown>,
    columnHelper.accessor('type', {
      header: t('fields.type'),
      cell: ({ getValue, row }) => {
        const type = getValue();
        return (
          <Badge variant="outline" data-testid={`leave-row-${row.original.id}-type`}>
            {t(`type.${type}`)}
          </Badge>
        );
      },
    }) as ColumnDef<LeaveRecord, unknown>,
    columnHelper.display({
      id: 'dateRange',
      header: t('columns.dates'),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="tabular-nums text-sm" data-testid={`leave-row-${r.id}-dates`}>
            {format(parseIsoDateLocal(r.startDate), 'dd MMM yyyy')} –{' '}
            {format(parseIsoDateLocal(r.endDate), 'dd MMM yyyy')}
          </span>
        );
      },
    }) as ColumnDef<LeaveRecord, unknown>,
    columnHelper.accessor('status', {
      header: t('columns.status'),
      cell: ({ getValue, row }) => {
        const status = getValue();
        return (
          <Badge
            variant="outline"
            className={STATUS_COLORS[status]}
            data-testid={`leave-row-${row.original.id}-status`}
          >
            {t(`status.${status}`)}
          </Badge>
        );
      },
    }) as ColumnDef<LeaveRecord, unknown>,
    columnHelper.accessor('reason', {
      header: t('fields.reason'),
      cell: ({ getValue, row }) => {
        const reason = String(getValue());
        return (
          <span
            className="text-sm text-muted-foreground"
            title={reason}
            data-testid={`leave-row-${row.original.id}-reason`}
          >
            {truncate(reason, 60)}
          </span>
        );
      },
    }) as ColumnDef<LeaveRecord, unknown>,
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const r = row.original;
        const isPending = r.status === 'PENDING';
        const facts = factsByMembership.get(r.userId) ?? null;
        return (
          <div className="flex items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              data-testid={`leave-row-${r.id}-view-btn`}
              title={t('actions.view')}
            >
              <Link href={`/leave/${r.id}`} aria-label={t('actions.view')}>
                <Eye className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            {isPending ? (
              <Can I="update" this={leaveSubject(r, facts)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0 text-emerald-600 hover:text-emerald-700"
                  onClick={() => runAction(approve, r.id, 'approved')}
                  disabled={approving}
                  title={t('actions.approve')}
                  data-testid={`leave-row-${r.id}-approve-btn`}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0 text-rose-600 hover:text-rose-700"
                  onClick={() => runAction(reject, r.id, 'rejected')}
                  disabled={rejecting}
                  title={t('actions.reject')}
                  data-testid={`leave-row-${r.id}-reject-btn`}
                >
                  <XCircle className="size-4" aria-hidden="true" />
                </Button>
              </Can>
            ) : null}
            <LeaveCancelAction leave={r} facts={facts} variant="icon" />
          </div>
        );
      },
    }) as ColumnDef<LeaveRecord, unknown>,
  ];

  if (failed && leaves.length === 0) {
    return (
      <Empty data-testid={instituteLeave.listError}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>{t('list.loadFailed')}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            title={t('detail.retry')}
            data-testid={instituteLeave.listRetryBtn}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t('detail.retry')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!loading && leaves.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarOff />
          </EmptyMedia>
          <EmptyTitle>{t('noLeaves')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={leaves}
      isLoading={loading}
      skeletonRows={5}
      data-testid={instituteLeave.table}
    />
  );
}
