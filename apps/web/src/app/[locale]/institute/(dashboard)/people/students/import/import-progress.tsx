'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import type { BulkImportStatus } from '@roviq/graphql/generated';
import { useFormatNumber } from '@roviq/i18n';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
} from '@roviq/ui';
import { cn } from '@roviq/ui/lib/utils';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Download,
  FileQuestion,
  LoaderCircle,
  RotateCcw,
  Users,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';
import { StepIndicator } from './import-wizard';
import { useStudentImportProgress } from './use-student-import';
import type { StudentImportProgressQuery } from './use-student-import.generated';

type ProgressNode = StudentImportProgressQuery['bulkImportProgress'];

const { instituteStudentImport: ids } = testIds;

const STAGES = ['PARSING', 'VALIDATING', 'INSERTING', 'GENERATING_REPORT'] as const;
type Stage = (typeof STAGES)[number];

export interface ImportTargetParams {
  academicYearId: string | null;
  standardId: string | null;
  sectionId: string | null;
}

export function ImportProgress({
  workflowId,
  target,
  onRestart,
}: {
  workflowId: string;
  target: ImportTargetParams;
  onRestart: () => void;
}) {
  const t = useTranslations('studentImport');
  const { data, error } = useStudentImportProgress(workflowId);
  const progress = data?.bulkImportProgress;

  if (!progress) {
    if (error && extractGraphQLErrorCode(error) === 'NOT_FOUND') {
      return (
        <Outcome
          icon={FileQuestion}
          title={t('notFound.heading')}
          body={t('notFound.body')}
          testId={ids.notFound}
          onRestart={onRestart}
        />
      );
    }
    return (
      <Card aria-busy="true">
        <CardHeader>
          <StepIndicator current={3} />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-20 w-full" />
          {error ? <Reconnecting /> : null}
        </CardContent>
      </Card>
    );
  }

  if (progress.status === 'FAILED') {
    return (
      <Outcome
        icon={CircleAlert}
        title={t('failed.heading')}
        body={t('failed.body')}
        testId={ids.failed}
        onRestart={onRestart}
        tone="destructive"
      />
    );
  }

  if (progress.status === 'COMPLETED') {
    return <Summary progress={progress} target={target} onRestart={onRestart} />;
  }

  const percent =
    progress.totalRows > 0 ? Math.round((progress.processed / progress.totalRows) * 100) : 0;

  return (
    <Card aria-busy="true" data-testid={ids.progress}>
      <CardHeader>
        <StepIndicator current={3} />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{t('progress.heading')}</CardTitle>
          <CardDescription>{t('progress.leaveNote')}</CardDescription>
        </div>
        <StageList status={progress.status} />
        <div className="flex flex-col gap-2">
          <Progress value={percent} aria-label={t('progress.heading')} />
          {/* The row count is known only once the file has been read. */}
          {progress.totalRows > 0 ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('progress.rows', { processed: progress.processed, total: progress.totalRows })}
            </p>
          ) : null}
        </div>
        <Counts created={progress.created} skipped={progress.skipped} errors={progress.errors} />
        {error ? <Reconnecting /> : null}
      </CardContent>
    </Card>
  );
}

function StageList({ status }: { status: BulkImportStatus }) {
  const t = useTranslations('studentImport');
  const current = (STAGES as readonly BulkImportStatus[]).indexOf(status);
  const state = (i: number) => (i < current ? 'done' : i === current ? 'current' : 'pending');
  const icon = { done: CircleCheck, current: LoaderCircle, pending: CircleDashed };
  const word = {
    done: t('progress.stageDone'),
    current: t('progress.stageCurrent'),
    pending: t('progress.stagePending'),
  };

  return (
    <ol className="flex flex-col gap-2">
      {STAGES.map((stage: Stage, i) => {
        const s = state(i);
        const Icon = icon[s];
        return (
          <li
            key={stage}
            data-state={s}
            data-testid={ids.stage(stage)}
            className={cn(
              'flex items-center gap-2 text-sm',
              s === 'pending' && 'text-muted-foreground',
              s === 'current' && 'font-medium',
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0',
                s === 'done' && 'text-emerald-600 dark:text-emerald-400',
                s === 'current' && 'animate-spin text-primary motion-reduce:animate-none',
              )}
            />
            <span>{t(`progress.stages.${stage}`)}</span>
            <span className="sr-only">({word[s]})</span>
          </li>
        );
      })}
    </ol>
  );
}

function Counts({
  created,
  skipped,
  errors,
}: {
  created: number;
  skipped: number;
  errors: number;
}) {
  const t = useTranslations('studentImport');
  const { format } = useFormatNumber();
  const tiles = [
    { label: t('progress.created'), value: created, testId: ids.createdCount, hint: null },
    {
      label: t('progress.skipped'),
      value: skipped,
      testId: ids.skippedCount,
      hint: t('progress.skippedHint'),
    },
    { label: t('progress.errors'), value: errors, testId: ids.errorCount, hint: null },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div key={tile.testId} className="min-w-0 rounded-md border p-3">
          <dt className="truncate text-xs text-muted-foreground" title={tile.hint ?? undefined}>
            {tile.label}
          </dt>
          <dd className="text-xl font-semibold tabular-nums" data-testid={tile.testId}>
            {format(tile.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Summary({
  progress,
  target,
  onRestart,
}: {
  progress: ProgressNode;
  target: ImportTargetParams;
  onRestart: () => void;
}) {
  const t = useTranslations('studentImport');
  const reportUrl = progress.report?.url ?? null;
  const studentsHref = `/institute/people/students?${new URLSearchParams(
    Object.entries(target).flatMap(([key, value]) => (value ? [[key, value]] : [])),
  ).toString()}`;

  return (
    <Card data-testid={ids.summary}>
      <CardHeader className="flex flex-col gap-4">
        <StepIndicator current={3} />
        <div className="flex items-start gap-3">
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
          <div className="flex flex-col gap-1.5">
            <CardTitle>{t('summary.heading')}</CardTitle>
            <CardDescription>
              {t('summary.body', {
                created: progress.created,
                skipped: progress.skipped,
                errors: progress.errors,
              })}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Counts created={progress.created} skipped={progress.skipped} errors={progress.errors} />
        {reportUrl ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t('summary.reportTitle')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <p>{t('summary.reportBody')}</p>
              <Button asChild variant="outline" size="sm" data-testid={ids.reportBtn}>
                <a
                  href={reportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('summary.reportButton')}
                >
                  <Download aria-hidden="true" className="size-4" />
                  {t('summary.reportButton')}
                </a>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('summary.nextSteps')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <NextStep
              href={studentsHref}
              icon={Users}
              title={t('summary.viewStudents')}
              body={t('summary.viewStudentsBody')}
              testId={ids.viewStudentsBtn}
            />
            <NextStep
              onClick={onRestart}
              icon={RotateCcw}
              title={t('summary.importAnother')}
              body={t('summary.importAnotherBody')}
              testId={ids.importAnotherBtn}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NextStep({
  href,
  onClick,
  icon: Icon,
  title,
  body,
  testId,
}: {
  href?: string;
  onClick?: () => void;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  body: string;
  testId: string;
}) {
  const content = (
    <span className="flex items-start gap-3 text-start">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
        <span className="font-medium">{title}</span>
        <span className="text-xs font-normal text-muted-foreground">{body}</span>
      </span>
    </span>
  );
  const className = 'h-auto min-h-11 w-full justify-start p-4';
  return href ? (
    <Button asChild variant="outline" className={className} title={title} data-testid={testId}>
      <Link href={href}>{content}</Link>
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={onClick}
      title={title}
      data-testid={testId}
    >
      {content}
    </Button>
  );
}

function Outcome({
  icon: Icon,
  title,
  body,
  testId,
  onRestart,
  tone,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  body: string;
  testId: string;
  onRestart: () => void;
  tone?: 'destructive';
}) {
  const t = useTranslations('studentImport');
  return (
    <Card data-testid={testId}>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-10',
            tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
        <CardTitle>{title}</CardTitle>
        <CardDescription className="max-w-md">{body}</CardDescription>
        <Button
          type="button"
          onClick={onRestart}
          title={t('summary.importAnother')}
          data-testid={ids.importAnotherBtn}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {t('summary.importAnother')}
        </Button>
      </CardContent>
    </Card>
  );
}

function Reconnecting() {
  const t = useTranslations('studentImport');
  return (
    <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400" role="status">
      <WifiOff aria-hidden="true" className="size-4" />
      {t('progress.reconnecting')}
    </p>
  );
}
