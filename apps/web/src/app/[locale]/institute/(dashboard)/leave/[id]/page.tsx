'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import { Link, useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StoredImage } from '@web/components/stored-image/stored-image';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarOff,
  CheckCircle2,
  RefreshCw,
  SearchX,
  XCircle,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { type ApplicantFacts, leaveSubject } from '../leave-abilities';
import { leaveApplicantLabel } from '../leave-applicant';
import { LeaveCancelAction, WithApplicantFacts } from '../leave-cancel-action';
import { leaveActionErrorKey } from '../leave-errors';
import {
  type LeaveRecord,
  type LeaveStatus,
  useApproveLeave,
  useLeave,
  useRejectLeave,
} from '../use-leave';

const { instituteLeave } = testIds;
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

export default function LeaveDetailPage() {
  const t = useTranslations('leave');
  const params = useParams();
  const id = params.id as string;

  const { leave, loading, error, refetch } = useLeave(id);

  return (
    <Can I="read" a="Leave" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="mx-auto max-w-3xl space-y-6">
            <DetailHeader leave={leave} onChanged={refetch} />
            {loading && !leave ? (
              <Card>
                <CardContent className="p-6">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ) : leave ? (
              <LeaveDetailCard leave={leave} />
            ) : error ? (
              <LeaveLoadError error={error} onRetry={() => void refetch()} />
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-muted-foreground" data-testid={instituteLeave.detailAccessDenied}>
              {t('accessDenied')}
            </p>
          </div>
        )
      }
    </Can>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Header — back link + title + contextual action buttons
// ─────────────────────────────────────────────────────────────────────

function DetailHeader({
  leave,
  onChanged,
}: {
  leave: LeaveRecord | null;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('leave');

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-2"
          data-testid={instituteLeave.detailBackBtn}
        >
          <Link href="/leave">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('detail.back')}
          </Link>
        </Button>
        <h1
          className="text-2xl font-semibold tracking-tight flex items-center gap-2"
          data-testid={instituteLeave.detailTitle}
        >
          <CalendarOff className="size-6 text-primary" aria-hidden="true" />
          {t('title')}
        </h1>
      </div>
      {leave ? (
        <WithApplicantFacts userId={leave.userId}>
          {(facts) => <DetailActions leave={leave} facts={facts} onChanged={onChanged} />}
        </WithApplicantFacts>
      ) : null}
    </header>
  );
}

function DetailActions({
  leave,
  facts,
  onChanged,
}: {
  leave: LeaveRecord;
  facts: ApplicantFacts | null;
  onChanged: () => Promise<unknown>;
}) {
  const t = useTranslations('leave');
  const { approve, loading: approving } = useApproveLeave();
  const { reject, loading: rejecting } = useRejectLeave();

  async function runAction(
    fn: (id: string) => Promise<unknown>,
    done: 'approved' | 'rejected',
  ): Promise<void> {
    try {
      await fn(leave.id);
      toast.success(t(`toasts.${done}`));
      await onChanged();
    } catch (err) {
      toast.error(t(`errors.action.${leaveActionErrorKey(extractGraphQLErrorCode(err))}`));
    }
  }

  return (
    <div className="flex items-center gap-2">
      {leave.status === 'PENDING' ? (
        <Can I="update" this={leaveSubject(leave, facts)}>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => runAction(approve, 'approved')}
            disabled={approving}
            data-testid={instituteLeave.detailApproveBtn}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {approving ? t('actions.approving') : t('actions.approve')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            onClick={() => runAction(reject, 'rejected')}
            disabled={rejecting}
            data-testid={instituteLeave.detailRejectBtn}
          >
            <XCircle className="size-4" aria-hidden="true" />
            {rejecting ? t('actions.rejecting') : t('actions.reject')}
          </Button>
        </Can>
      ) : null}
      <LeaveCancelAction leave={leave} facts={facts} variant="button" onDone={onChanged} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Load failure — LEAVE_NOT_FOUND also covers a leave the caller may not read
// ─────────────────────────────────────────────────────────────────────

function LeaveLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('leave');

  const code = extractGraphQLErrorCode(error);
  // BAD_REQUEST: the id is not a UUID, so no such leave can exist.
  if (code === 'LEAVE_NOT_FOUND' || code === 'BAD_REQUEST') {
    return (
      <Empty className="py-16" data-testid={instituteLeave.detailNotFound}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>{t('detail.notFound')}</EmptyTitle>
          <EmptyDescription>{t('detail.notFoundDescription')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/leave" data-testid={instituteLeave.detailNotFoundBackLink}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('detail.backToList')}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <Empty className="py-16" data-testid={instituteLeave.detailError}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>{t('detail.loadFailed')}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          data-testid={instituteLeave.detailRetryBtn}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('detail.retry')}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body — all fields
// ─────────────────────────────────────────────────────────────────────

function LeaveDetailCard({ leave }: { leave: LeaveRecord }) {
  const t = useTranslations('leave');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();

  return (
    <Card data-testid={instituteLeave.detailCard}>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Badge variant="outline" data-testid={instituteLeave.detailType}>
              {t(`type.${leave.type}`)}
            </Badge>
            <Badge
              variant="outline"
              className={STATUS_COLORS[leave.status]}
              data-testid={instituteLeave.detailStatus}
            >
              {t(`status.${leave.status}`)}
            </Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailRow
          label={t('fields.userId')}
          value={leaveApplicantLabel(leave.applicant, resolveI18n) ?? t('applicantUnknown')}
          testId="leave-detail-user"
        />
        <DetailRow
          label={`${t('fields.startDate')} – ${t('fields.endDate')}`}
          value={`${format(parseIsoDateLocal(leave.startDate), 'dd MMM yyyy')} – ${format(
            parseIsoDateLocal(leave.endDate),
            'dd MMM yyyy',
          )}`}
          testId="leave-detail-dates"
        />
        <DetailRow label={t('detail.reason')} value={leave.reason} testId="leave-detail-reason" />
        {leave.files.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{t('fields.files')}</p>
            <ul
              className="list-disc ps-5 space-y-0.5 text-sm"
              data-testid={instituteLeave.detailFiles}
            >
              {leave.files.map((file) => (
                <li key={file.id}>
                  {file.url ? (
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary underline-offset-4 hover:underline break-all"
                      data-testid={instituteLeave.detailFile(file.id)}
                    >
                      {file.width ? (
                        <StoredImage
                          file={{ ...file, url: file.thumbnailUrl }}
                          alt={file.name}
                          fallback={file.name}
                          className="my-1 w-40 rounded-md border"
                          testId={instituteLeave.detailFileImage(file.id)}
                        />
                      ) : (
                        file.name
                      )}
                    </a>
                  ) : (
                    <span data-testid={instituteLeave.detailFile(file.id)}>{file.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {leave.decidedBy ? (
          <DetailRow
            label={t('detail.decidedBy')}
            value={leave.decidedBy}
            testId="leave-detail-decided-by"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm break-words" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}
