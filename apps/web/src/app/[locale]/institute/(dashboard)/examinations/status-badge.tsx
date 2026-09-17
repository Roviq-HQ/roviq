'use client';

import { Badge, cn } from '@roviq/ui';
import {
  Archive,
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Lock,
  type LucideIcon,
  MinusCircle,
  Pencil,
  PencilLine,
  Trophy,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ExamStatus, ReportCardStatus, ResultStatus } from './use-examinations';

// [RVSBJ] Status = colour + icon + text, never colour alone. One map per
// enum keeps tint/icon meaning consistent across list, detail, and cards.
interface BadgeStyle {
  icon: LucideIcon;
  className: string;
}

const EXAM_STATUS_STYLES: Record<ExamStatus, BadgeStyle> = {
  DRAFT: {
    icon: Pencil,
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  SCHEDULED: {
    icon: CalendarCheck,
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  MARKS_ENTRY: {
    icon: PencilLine,
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  LOCKED: {
    icon: Lock,
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  },
  RESULTS_PUBLISHED: {
    icon: CheckCircle2,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  ARCHIVED: {
    icon: Archive,
    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  },
};

const REPORT_CARD_STATUS_STYLES: Record<ReportCardStatus, BadgeStyle> = {
  DRAFT: {
    icon: Pencil,
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  GENERATED: {
    icon: CircleDashed,
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  },
  PUBLISHED: {
    icon: CheckCircle2,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  ARCHIVED: {
    icon: Archive,
    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  },
};

const RESULT_STATUS_STYLES: Record<ResultStatus, BadgeStyle> = {
  PASS: {
    icon: CheckCircle2,
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  FAIL: { icon: XCircle, className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  COMPARTMENT: {
    icon: Trophy,
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  ABSENT: {
    icon: MinusCircle,
    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  },
  PENDING: {
    icon: CircleDashed,
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
};

function StatusBadge({
  icon: Icon,
  className,
  label,
  testId,
}: BadgeStyle & { label: string; testId?: string }) {
  return (
    <Badge variant="secondary" className={cn('gap-1 border-0', className)} data-testid={testId}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function ExamStatusBadge({ status, testId }: { status: ExamStatus; testId?: string }) {
  const t = useTranslations('examinations');
  return (
    <StatusBadge {...EXAM_STATUS_STYLES[status]} label={t(`statuses.${status}`)} testId={testId} />
  );
}

export function ReportCardStatusBadge({
  status,
  testId,
}: {
  status: ReportCardStatus;
  testId?: string;
}) {
  const t = useTranslations('examinations');
  return (
    <StatusBadge
      {...REPORT_CARD_STATUS_STYLES[status]}
      label={t(`reportCardStatuses.${status}`)}
      testId={testId}
    />
  );
}

export function ResultStatusBadge({ status, testId }: { status: ResultStatus; testId?: string }) {
  const t = useTranslations('examinations');
  return (
    <StatusBadge
      {...RESULT_STATUS_STYLES[status]}
      label={t(`resultStatuses.${status}`)}
      testId={testId}
    />
  );
}
