'use client';

import { useI18nField } from '@roviq/i18n';
import {
  Can,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { StandardSectionSelect } from '@web/components/pickers/standard-section-select';
import { CalendarX2, Trophy } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ResultStatusBadge } from '../../status-badge';
import { useExam, useExamResults } from '../../use-examinations';

const { instituteExaminations: ex } = testIds;

export default function ExamResultsPage() {
  const params = useParams();
  const examId = params.examId as string;
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { exam, loading } = useExam(examId);
  // Breadcrumb reads "… › {exam name} › Results" — the results segment auto-formats.
  useBreadcrumbOverride(exam ? { [examId]: resolveI18n(exam.name) } : {});

  if (loading) return <ResultsSkeleton />;
  if (!exam) {
    return (
      <Empty data-testid={ex.emptyState}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarX2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('emptyStates.noExamsTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyStates.noExamsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Can I="read" a="Exam" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <Results
            examId={examId}
            academicYearId={exam.academicYearId}
            examName={resolveI18n(exam.name)}
          />
        ) : (
          <AccessDenied />
        )
      }
    </Can>
  );
}

function Results({
  examId,
  academicYearId,
  examName,
}: {
  examId: string;
  academicYearId: string;
  examName: string;
}) {
  const t = useTranslations('examinations');
  const [sectionId, setSectionId] = React.useState<string | null>(null);
  const { results, loading } = useExamResults(examId, sectionId);

  return (
    <div className="space-y-3" data-testid={ex.resultsPage}>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('results.pageTitle', { name: examName })}
      </h1>
      <StandardSectionSelect
        academicYearId={academicYearId}
        sectionId={sectionId}
        onSectionChange={setSectionId}
        standardTestId={`${ex.resultsSectionSelect}-standard`}
        sectionTestId={ex.resultsSectionSelect}
      />
      {!sectionId ? (
        <p className="text-sm text-muted-foreground">{t('results.pickSection')}</p>
      ) : loading ? (
        <div className="space-y-2 rounded-md border p-2" data-testid={ex.resultsSkeleton}>
          {Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Empty className="border" data-testid={ex.resultsEmpty}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trophy aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('emptyStates.noResultsTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyStates.noResultsDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid={ex.resultsTable}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>{t('results.rank')}</TableHead>
                <TableHead>{t('marks.rollNumber')}</TableHead>
                <TableHead>{t('marks.student')}</TableHead>
                <TableHead>{t('results.total')}</TableHead>
                <TableHead>{t('results.percentage')}</TableHead>
                <TableHead>{t('results.gpa')}</TableHead>
                <TableHead>{t('results.result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.studentId}>
                  <TableCell className="tabular-nums">{r.rank ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">{r.rollNumber ?? '—'}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.obtainedMarks}/{r.maxMarks}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.percentage}%</TableCell>
                  <TableCell className="tabular-nums">{r.gpa ?? '—'}</TableCell>
                  <TableCell>
                    <ResultStatusBadge status={r.resultStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" data-testid={ex.resultsSkeleton}>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function AccessDenied() {
  const t = useTranslations('examinations');
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-muted-foreground">{t('accessDenied')}</p>
    </div>
  );
}
