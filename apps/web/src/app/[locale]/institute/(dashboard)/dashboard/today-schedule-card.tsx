'use client';

import { useAuth } from '@roviq/auth';
import { Link } from '@roviq/i18n';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAcademicYears } from '../academic-years/use-academic-years';
import type { DayScheduleSlot } from '../timetable/use-timetable';
import { useStaffDaySchedule } from '../timetable/use-timetable';
import { TimetableLookupsProvider, useTimetableLookups } from '../timetable/use-timetable-lookups';

const { instituteDashboard } = testIds;

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Today's classes" — the signed-in teacher's resolved day schedule (overrides
 * applied). Renders nothing for users with no classes today (admins, clerks),
 * so the heavy label lookups only mount when there's something to show.
 */
export function TodayScheduleCard() {
  const { user } = useAuth();
  const membershipId = user?.membershipId ?? null;
  const { slots, loading } = useStaffDaySchedule(todayIso(), membershipId);

  if (!membershipId || loading) return null;
  const teaching = slots.filter((s) => s.kind !== 'BREAK');
  if (teaching.length === 0) return null;

  return <TodayScheduleInner slots={teaching} />;
}

function TodayScheduleInner({ slots }: { slots: DayScheduleSlot[] }) {
  const { years } = useAcademicYears();
  const activeYearId = years.find((y) => y.status === 'ACTIVE')?.id ?? null;
  return (
    <TimetableLookupsProvider academicYearId={activeYearId}>
      <TodayScheduleBody slots={slots} />
    </TimetableLookupsProvider>
  );
}

function TodayScheduleBody({ slots }: { slots: DayScheduleSlot[] }) {
  const t = useTranslations('dashboard.todaySchedule');
  const lookups = useTimetableLookups();

  return (
    <Card
      className="transition-shadow hover:shadow-md"
      data-testid={instituteDashboard.todayScheduleCard}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <CalendarClock className="size-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </div>
        <CardDescription>{t('subtitle', { count: slots.length })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-1.5">
          {slots.slice(0, 6).map((slot) => (
            <li
              key={`${slot.periodId}-${slot.splitIndex}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
                {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
              </span>
              <span className="flex-1 truncate">
                {lookups.subjectLabel(slot.subjectId) || t('unassigned')}
                <span className="text-muted-foreground">
                  {' '}
                  · {lookups.sectionLabel(slot.sectionId)}
                </span>
                {slot.room && <span className="text-muted-foreground"> · {slot.room}</span>}
              </span>
            </li>
          ))}
        </ul>
        <Button variant="link" className="h-auto p-0" asChild>
          <Link
            href="/institute/timetable/staff-timetable"
            data-testid={instituteDashboard.todayScheduleLink}
          >
            {t('viewMyTimetable')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
