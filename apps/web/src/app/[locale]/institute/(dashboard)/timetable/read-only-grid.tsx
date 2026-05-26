'use client';

import { useTranslations } from 'next-intl';
import type { GridEntry, SectionTimetableGrid, Weekday } from './use-timetable';
import { useTimetableLookups } from './use-timetable-lookups';

/**
 * Read-only weekly grid (rows = periods, columns = working days) shared by the
 * section-timetable and staff-timetable views. Print-friendly: the `@media
 * print` rules in the page hide chrome and keep this table on the sheet.
 */
export function ReadOnlyGrid({
  grid,
  showSection = false,
  testId,
}: {
  grid: SectionTimetableGrid;
  /** Staff view shows which section each entry belongs to. */
  showSection?: boolean;
  testId?: string;
}) {
  const t = useTranslations('timetable');
  const lookups = useTimetableLookups();

  const periods = [...grid.periods].sort((a, b) => a.sequence - b.sequence);

  const entriesFor = (periodId: string, day: Weekday): GridEntry[] =>
    grid.entries.filter((e) => e.periodId === periodId && e.dayOfWeek === day);

  return (
    <div className="overflow-x-auto rounded-md border" data-testid={testId}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="p-2 text-start font-medium">{t('editor.period')}</th>
            {grid.workingDays.map((day) => (
              <th key={day} className="p-2 text-start font-medium">
                {t(`weekdaysShort.${day}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.id} className="border-t">
              <th className="p-2 text-start align-top">
                <span className="font-medium">{period.label}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {period.startTime.slice(0, 5)}–{period.endTime.slice(0, 5)}
                </span>
              </th>
              {grid.workingDays.map((day) => {
                if (period.kind === 'BREAK') {
                  return (
                    <td
                      key={day}
                      className="p-2 bg-muted/30 text-center text-xs text-muted-foreground"
                    >
                      {period.label}
                    </td>
                  );
                }
                const cellEntries = entriesFor(period.id, day);
                return (
                  <td key={day} className="p-2 align-top">
                    {cellEntries.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t('view.free')}</span>
                    ) : (
                      <div className="space-y-1">
                        {cellEntries.map((entry) => (
                          <div key={entry.id} className="text-xs">
                            {entry.splitLabel && (
                              <span className="font-medium">{entry.splitLabel}: </span>
                            )}
                            <span className="font-medium">
                              {lookups.subjectLabel(entry.subjectId) || t('assign.unassigned')}
                            </span>
                            {showSection && (
                              <span className="block text-muted-foreground">
                                {lookups.sectionLabel(entry.sectionId)}
                              </span>
                            )}
                            {!showSection && entry.teacherId && (
                              <span className="block text-muted-foreground">
                                {lookups.teacherLabel(entry.teacherId)}
                              </span>
                            )}
                            {entry.room && (
                              <span className="block text-muted-foreground">{entry.room}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
