'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  DataTable,
  DataTableToolbar,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { CopyIdButton } from '@web/components/copy-id-button';
import { parseISO } from 'date-fns';
import {
  CheckCircle2,
  FileText,
  GitBranch,
  Inbox,
  Loader2,
  SearchX,
  ThumbsDown,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';
import { useStandards } from '../../academics/use-academics';
import {
  APPLICATION_STATUS_CLASS,
  APPLICATION_STATUS_ICON,
  APPLICATION_STATUS_VALUES,
  type ApplicationStatusKey,
  getSelectableApplicationStatuses,
  isTerminalApplicationStatus,
} from '../admission-constants';
import {
  type ApplicationFilter,
  type ApplicationNode,
  useApplicationStatusChanged,
  useApplications,
} from '../use-admission';
import { ApplicationDocumentsDialog } from './application-documents-dialog';
import { ApproveApplicationDialog } from './approve-application-dialog';
import { RejectApplicationDialog } from './reject-application-dialog';
import { StatusChangeDialog } from './status-change-dialog';

const { instituteAdmissionApplications } = testIds;
/** The applicant's name as the form recorded it; null when the form has none. */
function applicantNameOf(application: ApplicationNode): string | null {
  const formData = (application.formData ?? {}) as Record<string, unknown>;
  const name = formData.studentName ?? formData.student_name;
  return typeof name === 'string' && name.trim() ? name : null;
}

const filterParsers = {
  status: parseAsString,
  standardId: parseAsString,
  rteOnly: parseAsBoolean.withDefault(false),
};

export default function ApplicationsPage() {
  const t = useTranslations('admission');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();

  const [filters, setFilters] = useQueryStates(filterParsers);
  // Standards of the active academic year, which is where applications are made.
  const { standards } = useStandards();
  const [statusChange, setStatusChange] = React.useState<ApplicationNode | null>(null);
  const [approveTarget, setApproveTarget] = React.useState<ApplicationNode | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<ApplicationNode | null>(null);
  const [documentsTarget, setDocumentsTarget] = React.useState<ApplicationNode | null>(null);
  // Track which applications were just approved so we can show the
  // "enrolment in progress" indicator until the backend confirms via the
  // applicationStatusChanged subscription.
  const [pendingApprovals, setPendingApprovals] = React.useState<Set<string>>(() => new Set());

  const queryFilter = React.useMemo<ApplicationFilter>(() => {
    const f: ApplicationFilter = { first: 100 };
    if (filters.status) f.status = filters.status as ApplicationStatusKey;
    if (filters.standardId) f.standardId = filters.standardId;
    if (filters.rteOnly) f.isRteApplication = true;
    return f;
  }, [filters]);

  const { applications, totalCount, loading, error, refetch } = useApplications(queryFilter);

  // ROV-168: real-time status updates clear the pending indicator and
  // refetch so the row reflects the new status without manual reload.
  useApplicationStatusChanged((event) => {
    setPendingApprovals((prev) => {
      if (!prev.has(event.applicationId)) return prev;
      const next = new Set(prev);
      next.delete(event.applicationId);
      return next;
    });
    refetch();
  });

  const hasFilters = !!filters.status || !!filters.standardId || filters.rteOnly;

  const clearFilters = () => setFilters({ status: null, standardId: null, rteOnly: null });

  const handleApprovalStarted = (id: string) => {
    setPendingApprovals((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Show the indicator for at most ~30s even if the subscription is
    // missed; statistics tab should also refetch when this completes.
    setTimeout(() => {
      setPendingApprovals((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 30_000);
    refetch();
  };

  const columns = React.useMemo<ColumnDef<ApplicationNode>[]>(
    () => [
      {
        accessorKey: 'id',
        header: t('applications.columns.applicant'),
        cell: ({ row }) => {
          const formData = (row.original.formData ?? {}) as Record<string, unknown>;
          const studentName = applicantNameOf(row.original);
          const parentName =
            (formData.parentName as string) ?? (formData.parent_name as string) ?? '';
          return (
            <div className="space-y-0.5">
              {studentName ? (
                <p
                  className="font-medium"
                  data-testid={instituteAdmissionApplications.applicant(row.original.id)}
                >
                  {studentName}
                </p>
              ) : (
                // No human reference exists for an application; the id is what support asks for.
                <p
                  className="flex items-center gap-1 text-muted-foreground"
                  data-testid={instituteAdmissionApplications.applicant(row.original.id)}
                >
                  {t('applications.unnamedApplicant')}
                  <CopyIdButton value={row.original.id} name={t('applications.applicationId')} />
                </p>
              )}
              {parentName && <p className="text-xs text-muted-foreground">{parentName}</p>}
            </div>
          );
        },
      },
      {
        id: 'standard',
        header: t('applications.columns.standard'),
        cell: ({ row }) => (
          <span className="text-sm">{resolveI18n(row.original.standardName) || '—'}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('applications.columns.status'),
        cell: ({ row }) => {
          const key = row.original.status as ApplicationStatusKey;
          const Icon = APPLICATION_STATUS_ICON[key] ?? APPLICATION_STATUS_ICON.SUBMITTED;
          const isPending = pendingApprovals.has(row.original.id);
          return (
            <div className="flex flex-col gap-1">
              <Badge
                variant="secondary"
                data-testid={`application-status-${row.original.id}`}
                className={`inline-flex w-fit items-center gap-1 ${
                  APPLICATION_STATUS_CLASS[key] ?? ''
                }`}
              >
                <Icon className="size-3.5" />
                {t(`applicationStatuses.${key}`, { default: row.original.status })}
              </Badge>
              {row.original.rejectionReason && (
                <span
                  className="max-w-56 text-xs text-muted-foreground"
                  data-testid={instituteAdmissionApplications.rejectionReason(row.original.id)}
                >
                  {t('applications.rejectionReason', { reason: row.original.rejectionReason })}
                </span>
              )}
              {isPending && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-amber-700"
                  data-testid={`application-pending-${row.original.id}`}
                >
                  <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                  {t('applications.workflowPending')}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'isRteApplication',
        header: t('applications.columns.rte'),
        cell: ({ row }) =>
          row.original.isRteApplication ? (
            <Badge
              data-testid={`application-rte-${row.original.id}`}
              className="bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
            >
              {t('applications.rteBadge')}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'meritRank',
        header: t('applications.columns.meritRank'),
        cell: ({ row }) =>
          row.original.meritRank != null ? (
            <span className="text-sm font-medium">#{row.original.meritRank}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('applications.columns.updatedAt'),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {format(parseISO(row.original.updatedAt), 'dd MMM yyyy')}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('applications.columns.actions'),
        cell: ({ row }) => {
          const status = row.original.status as ApplicationStatusKey;
          const terminal = isTerminalApplicationStatus(status);
          const canApprove = status === 'FEE_PAID';
          // Only where a status can be picked by hand: none after a terminal one, and FEE_PAID's
          // only step (ENROLLED) belongs to Approve & enrol.
          const canChangeStatus = getSelectableApplicationStatuses(status).length > 0;
          return (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                title={t('applications.actions.documents')}
                data-testid={instituteAdmissionApplications.documentsBtn(row.original.id)}
                onClick={() => setDocumentsTarget(row.original)}
              >
                <FileText aria-hidden="true" className="size-4" />
                <span className="sr-only md:not-sr-only md:ms-1">
                  {t('applications.actions.documents')}
                </span>
              </Button>
              {canChangeStatus && (
                <Can I="update" a="Application">
                  <Button
                    size="sm"
                    variant="outline"
                    title={t('applications.actions.changeStatus')}
                    data-testid={`application-status-btn-${row.original.id}`}
                    onClick={() => setStatusChange(row.original)}
                  >
                    <GitBranch aria-hidden="true" className="size-4" />
                    <span className="sr-only md:not-sr-only md:ms-1">
                      {t('applications.actions.changeStatus')}
                    </span>
                  </Button>
                </Can>
              )}
              {canApprove && (
                <Can I="update" a="Application">
                  <Button
                    size="sm"
                    title={t('applications.actions.approve')}
                    data-testid={`application-approve-btn-${row.original.id}`}
                    onClick={() => setApproveTarget(row.original)}
                  >
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                    <span className="sr-only md:not-sr-only md:ms-1">
                      {t('applications.actions.approve')}
                    </span>
                  </Button>
                </Can>
              )}
              {!terminal && (
                <Can I="update" a="Application">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-700 hover:bg-rose-50"
                    title={t('applications.actions.reject')}
                    data-testid={`application-reject-btn-${row.original.id}`}
                    onClick={() => setRejectTarget(row.original)}
                  >
                    <ThumbsDown aria-hidden="true" className="size-4" />
                  </Button>
                </Can>
              )}
            </div>
          );
        },
      },
    ],
    [t, format, pendingApprovals, resolveI18n],
  );

  return (
    <Can I="read" a="Application" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1
                  className="text-2xl font-bold tracking-tight"
                  data-testid={instituteAdmissionApplications.title}
                >
                  {t('applications.title')}
                </h1>
                <p className="text-muted-foreground">{t('applications.description')}</p>
              </div>
            </div>

            <DataTableToolbar>
              <Select
                value={filters.status ?? '__all__'}
                onValueChange={(v) => setFilters({ status: v === '__all__' ? null : v })}
              >
                <SelectTrigger
                  className="w-[200px]"
                  aria-label={t('applications.filters.allStatuses')}
                  data-testid={instituteAdmissionApplications.statusFilter}
                >
                  <SelectValue placeholder={t('applications.filters.allStatuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('applications.filters.allStatuses')}</SelectItem>
                  {APPLICATION_STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`applicationStatuses.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.standardId ?? '__all__'}
                onValueChange={(v) => setFilters({ standardId: v === '__all__' ? null : v })}
              >
                <SelectTrigger
                  className="w-[200px]"
                  aria-label={t('applications.filters.allStandards')}
                  data-testid={instituteAdmissionApplications.standardFilter}
                >
                  <SelectValue placeholder={t('applications.filters.allStandards')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('applications.filters.allStandards')}</SelectItem>
                  {standards.map((standard) => (
                    <SelectItem key={standard.id} value={standard.id}>
                      {resolveI18n(standard.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.rteOnly}
                  onChange={(e) => setFilters({ rteOnly: e.target.checked ? true : null })}
                  data-testid={instituteAdmissionApplications.rteFilter}
                  className="h-4 w-4"
                />
                {t('applications.filters.rteOnly')}
              </label>

              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={instituteAdmissionApplications.clearFiltersBtn}
                  onClick={clearFilters}
                >
                  <X aria-hidden="true" className="me-1 size-4" />
                  {t('applications.filters.clear')}
                </Button>
              )}
            </DataTableToolbar>

            <DataTable
              data-testid={instituteAdmissionApplications.table}
              columns={columns}
              data={applications}
              isLoading={loading && applications.length === 0}
              emptyState={
                error ? (
                  <Empty className="py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <TriangleAlert aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle data-testid={instituteAdmissionApplications.loadError}>
                        {t('applications.loadError.title')}
                      </EmptyTitle>
                      <EmptyDescription>{t('applications.loadError.description')}</EmptyDescription>
                    </EmptyHeader>
                    <Button
                      variant="outline"
                      size="sm"
                      title={t('applications.loadError.retry')}
                      data-testid={instituteAdmissionApplications.loadErrorRetryBtn}
                      onClick={() => refetch()}
                    >
                      {t('applications.loadError.retry')}
                    </Button>
                  </Empty>
                ) : hasFilters ? (
                  <Empty className="py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <SearchX aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle data-testid={instituteAdmissionApplications.emptyNoMatch}>
                        {t('applications.empty.noMatch')}
                      </EmptyTitle>
                      <EmptyDescription>
                        {t('applications.empty.noMatchDescription')}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <Empty className="py-12">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Inbox aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle data-testid={instituteAdmissionApplications.emptyNoData}>
                        {t('applications.empty.noData')}
                      </EmptyTitle>
                      <EmptyDescription>
                        {t('applications.empty.noDataDescription')}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )
              }
            />
            <p
              className="px-2 pb-2 text-xs text-muted-foreground"
              data-testid={instituteAdmissionApplications.total}
            >
              {totalCount} {t('applications.title')}
            </p>

            <StatusChangeDialog
              open={!!statusChange}
              onOpenChange={(o) => !o && setStatusChange(null)}
              application={statusChange}
            />
            <ApproveApplicationDialog
              open={!!approveTarget}
              onOpenChange={(o) => !o && setApproveTarget(null)}
              application={approveTarget}
              onApproved={(id) => {
                handleApprovalStarted(id);
                toast.success(t('applications.approveDialog.success'));
              }}
            />
            <ApplicationDocumentsDialog
              open={!!documentsTarget}
              onOpenChange={(o) => !o && setDocumentsTarget(null)}
              application={documentsTarget}
              applicantName={
                documentsTarget
                  ? (applicantNameOf(documentsTarget) ?? t('applications.unnamedApplicant'))
                  : ''
              }
            />
            <RejectApplicationDialog
              open={!!rejectTarget}
              onOpenChange={(o) => !o && setRejectTarget(null)}
              application={rejectTarget}
              onRejected={() => {
                refetch();
                toast.success(t('applications.rejectDialog.success'));
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-[400px] items-center justify-center">
            <p className="text-muted-foreground">{t('accessDenied')}</p>
          </div>
        )
      }
    </Can>
  );
}

import { testIds } from '@roviq/ui/testing/testid-registry';
