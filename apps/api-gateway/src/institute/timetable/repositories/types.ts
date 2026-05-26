import type {
  DaySession,
  PeriodKind,
  TimetableOverrideType,
  TimetableStatus,
  Weekday,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';

// ── Master timetable ──────────────────────────────────────────────────────────

export interface TimetableRecord {
  id: string;
  tenantId: string;
  academicYearId: string;
  name: I18nContent;
  description: string | null;
  status: TimetableStatus;
  effectiveFrom: string;
  effectiveTo: string;
  workingDays: Weekday[];
  dayStartTime: string;
  defaultPeriodDurationMins: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTimetableData {
  academicYearId: string;
  name: I18nContent;
  description?: string | null;
  effectiveFrom: string;
  effectiveTo: string;
  workingDays: Weekday[];
  dayStartTime: string;
  defaultPeriodDurationMins: number;
}

export interface UpdateTimetableData {
  name?: I18nContent;
  description?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string;
  workingDays?: Weekday[];
}

export interface TimetableStatisticsRow {
  total: number;
  draft: number;
  active: number;
  inactive: number;
  archived: number;
}

export interface ListTimetablesQuery {
  academicYearId?: string;
  status?: TimetableStatus;
  /** Restrict to timetables that cover this section. */
  sectionId?: string;
  /** Case-insensitive match against the i18n name (any locale value). */
  search?: string;
  page: number;
  perPage: number;
}

export interface PaginatedTimetables {
  docs: TimetableRecord[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ── Covered sections ────────────────────────────────────────────────────────

export interface TimetableSectionRecord {
  id: string;
  tenantId: string;
  timetableId: string;
  sectionId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Periods (time grid) ───────────────────────────────────────────────────────

export interface TimetablePeriodRecord {
  id: string;
  tenantId: string;
  timetableId: string;
  kind: PeriodKind;
  label: string;
  sequence: number;
  startTime: string;
  endTime: string;
  session: DaySession;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePeriodData {
  timetableId: string;
  kind: PeriodKind;
  label: string;
  sequence: number;
  startTime: string;
  endTime: string;
  session: DaySession;
}

export interface UpdatePeriodData {
  label?: string;
  startTime?: string;
  endTime?: string;
}

// ── Entries (assignment cells) ──────────────────────────────────────────────

export interface TimetableEntryRecord {
  id: string;
  tenantId: string;
  timetableId: string;
  periodId: string;
  sectionId: string;
  dayOfWeek: Weekday;
  splitIndex: number;
  splitLabel: string | null;
  subjectId: string | null;
  teacherId: string | null;
  room: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertEntryData {
  timetableId: string;
  periodId: string;
  sectionId: string;
  dayOfWeek: Weekday;
  splitIndex: number;
  splitLabel?: string | null;
  subjectId?: string | null;
  teacherId?: string | null;
  room?: string | null;
  notes?: string | null;
}

export interface ClearEntryQuery {
  timetableId: string;
  sectionId: string;
  periodId: string;
  dayOfWeek: Weekday;
  splitIndex: number;
}

// ── Day overrides ─────────────────────────────────────────────────────────────

export interface TimetableDayOverrideRecord {
  id: string;
  tenantId: string;
  timetableId: string;
  date: string;
  sectionId: string;
  periodId: string;
  splitIndex: number;
  overrideType: TimetableOverrideType;
  subjectId: string | null;
  teacherId: string | null;
  room: string | null;
  originalSubjectId: string | null;
  originalTeacherId: string | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOverrideData {
  timetableId: string;
  date: string;
  sectionId: string;
  periodId: string;
  splitIndex: number;
  overrideType: TimetableOverrideType;
  subjectId?: string | null;
  teacherId?: string | null;
  room?: string | null;
  originalSubjectId?: string | null;
  originalTeacherId?: string | null;
  reason?: string | null;
}
