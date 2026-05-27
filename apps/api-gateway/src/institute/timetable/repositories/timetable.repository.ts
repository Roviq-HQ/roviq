import type { Weekday } from '@roviq/common-types';
import type {
  ClearEntryQuery,
  CreateOverrideData,
  CreatePeriodData,
  CreateTimetableData,
  ListTimetablesQuery,
  PaginatedTimetables,
  TimetableDayOverrideRecord,
  TimetableEntryRecord,
  TimetableLabelMaps,
  TimetablePeriodRecord,
  TimetableRecord,
  TimetableSectionRecord,
  TimetableStatisticsRow,
  UpdatePeriodData,
  UpdateTimetableData,
  UpsertEntryData,
} from './types';

/**
 * Persistence for the whole timetable aggregate (master, covered sections,
 * period grid, assignment entries, per-date overrides). One repository per
 * feature mirrors the attendance module. Status transitions, single-active
 * swaps, and conflict validation live in the services — the repo is plumbing.
 */
export abstract class TimetableRepository {
  // Master
  abstract createTimetable(data: CreateTimetableData): Promise<TimetableRecord>;
  /**
   * Atomic create: timetable + covered sections + period grid in ONE
   * transaction. Either the whole timetable lands or nothing does — no orphan
   * timetable rows on a mid-way failure (bad section FK, duplicate name, …).
   */
  abstract createWithGrid(
    data: CreateTimetableData,
    sectionIds: string[],
    periods: Omit<CreatePeriodData, 'timetableId'>[],
  ): Promise<TimetableRecord>;
  abstract findTimetableById(id: string): Promise<TimetableRecord | null>;
  abstract listTimetables(query: ListTimetablesQuery): Promise<PaginatedTimetables>;
  abstract updateTimetable(id: string, data: UpdateTimetableData): Promise<TimetableRecord>;
  abstract setStatus(id: string, status: TimetableRecord['status']): Promise<TimetableRecord>;
  /**
   * Atomically demote the current ACTIVE timetable for `academicYearId` (if any,
   * and not `id`) to INACTIVE, then promote `id` to ACTIVE — in one transaction.
   * Returns `{ timetable, previousActiveId }`.
   */
  abstract activateExclusive(
    id: string,
    academicYearId: string,
  ): Promise<{ timetable: TimetableRecord; previousActiveId: string | null }>;
  abstract findActiveTimetable(academicYearId: string): Promise<TimetableRecord | null>;
  abstract statistics(academicYearId?: string): Promise<TimetableStatisticsRow>;
  abstract softDeleteTimetable(id: string): Promise<void>;
  abstract restoreTimetable(id: string): Promise<TimetableRecord>;

  // Covered sections
  abstract addSection(timetableId: string, sectionId: string): Promise<TimetableSectionRecord>;
  abstract removeSection(timetableId: string, sectionId: string): Promise<void>;
  abstract findSections(timetableId: string): Promise<TimetableSectionRecord[]>;

  // Periods
  abstract createPeriods(data: CreatePeriodData[]): Promise<TimetablePeriodRecord[]>;
  abstract findPeriods(timetableId: string): Promise<TimetablePeriodRecord[]>;
  abstract findPeriodById(id: string): Promise<TimetablePeriodRecord | null>;
  abstract updatePeriod(id: string, data: UpdatePeriodData): Promise<TimetablePeriodRecord>;
  abstract softDeletePeriod(id: string): Promise<void>;

  // Entries
  abstract createEntries(data: UpsertEntryData[]): Promise<TimetableEntryRecord[]>;
  abstract upsertEntry(data: UpsertEntryData): Promise<TimetableEntryRecord>;
  abstract clearEntry(query: ClearEntryQuery): Promise<void>;
  abstract findEntriesByTimetable(timetableId: string): Promise<TimetableEntryRecord[]>;
  abstract findEntriesBySection(
    timetableId: string,
    sectionId: string,
  ): Promise<TimetableEntryRecord[]>;
  abstract findEntriesByTeacher(
    timetableId: string,
    teacherId: string,
  ): Promise<TimetableEntryRecord[]>;
  /**
   * All assignment cells occupying one slot (timetable, period, weekday) across
   * every section + split. Used to detect teacher / room double-booking before
   * an assignment (the DB partial-unique on teacher is the hard backstop).
   */
  abstract findEntriesAtSlot(
    timetableId: string,
    periodId: string,
    dayOfWeek: Weekday,
  ): Promise<TimetableEntryRecord[]>;

  // Day overrides
  abstract createOverride(data: CreateOverrideData): Promise<TimetableDayOverrideRecord>;
  abstract findOverrideById(id: string): Promise<TimetableDayOverrideRecord | null>;
  abstract findOverridesByDate(
    timetableId: string,
    date: string,
  ): Promise<TimetableDayOverrideRecord[]>;
  abstract findOverridesBySectionRange(
    sectionId: string,
    startDate: string,
    endDate: string,
  ): Promise<TimetableDayOverrideRecord[]>;
  abstract softDeleteOverride(id: string): Promise<void>;

  // Display labels (PDF / export rendering — subjects, sections, teachers live
  // in other modules, so the repo resolves their names for read-only output).
  abstract resolveLabels(input: {
    subjectIds: string[];
    sectionIds: string[];
    teacherIds: string[];
  }): Promise<TimetableLabelMaps>;
}
