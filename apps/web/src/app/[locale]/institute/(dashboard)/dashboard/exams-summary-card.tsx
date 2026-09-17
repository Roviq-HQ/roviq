'use client';

import { Link, useI18nField } from '@roviq/i18n';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActiveAcademicYear } from '../academic-years/use-academic-years';
import { useExams } from '../examinations/use-examinations';

const { instituteDashboard } = testIds;

/**
 * "Published results" — the most recent exams whose results are live for the
 * institute's active year. Mirrors the today-schedule-card pattern: one query,
 * empty state, link to the full examinations page. Gated by read:Exam upstream.
 */
export function ExamsSummaryCard() {
  const t = useTranslations('dashboard.exams');
  const resolveI18n = useI18nField();
  const { activeYear } = useActiveAcademicYear();
  const { exams, total, loading } = useExams(activeYear?.id ?? null, {
    status: 'RESULTS_PUBLISHED',
    perPage: 5,
  });

  return (
    <Card className="transition-shadow hover:shadow-md" data-testid={instituteDashboard.examsCard}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <GraduationCap className="size-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </div>
        <CardDescription>{t('subtitle', { count: total })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {!loading && exams.length === 0 ? (
          <CardDescription>{t('noData')}</CardDescription>
        ) : (
          <ul className="space-y-1.5">
            {exams.map((exam) => (
              <li
                key={exam.id}
                className="truncate text-sm"
                data-testid={instituteDashboard.examsCardRow(exam.id)}
              >
                <Link href={`/institute/examinations/${exam.id}`} className="hover:underline">
                  {resolveI18n(exam.name)}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Button variant="link" className="h-auto p-0" asChild>
          <Link href="/institute/examinations" data-testid={instituteDashboard.examsCardLink}>
            {t('viewAll')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
