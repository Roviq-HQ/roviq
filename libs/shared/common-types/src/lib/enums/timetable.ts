/**
 * Timetable-domain enums — single source of truth.
 *
 * Consumed by:
 *   - `libs/database` → `pgEnum(...)` column types
 *   - `apps/api-gateway` → `registerEnumType(...)` + `@IsEnum(...)` + `@Field(() => ...)`
 *   - `apps/web` → Zod schemas, Select options, runtime comparisons
 */

// ─── TimetableStatus ──────────────────────────────────────────────────────────

export const TIMETABLE_STATUS_VALUES = [
  // Being built; not yet in effect. Periods/entries editable freely
  'DRAFT',
  // The live timetable — at most one ACTIVE per institute + academic year
  'ACTIVE',
  // Previously active or retired; kept for reference, can be re-activated
  'INACTIVE',
  // Permanently retired; terminal, read-only
  'ARCHIVED',
] as const;

export type TimetableStatus = (typeof TIMETABLE_STATUS_VALUES)[number];

export const TimetableStatus = Object.fromEntries(TIMETABLE_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in TimetableStatus]: K;
};

// ─── Weekday ──────────────────────────────────────────────────────────────────

export const WEEKDAY_VALUES = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type Weekday = (typeof WEEKDAY_VALUES)[number];

export const Weekday = Object.fromEntries(WEEKDAY_VALUES.map((v) => [v, v])) as {
  readonly [K in Weekday]: K;
};

/** JS `Date.getDay()` is 0=Sunday..6=Saturday. This maps that to {@link Weekday}. */
export const WEEKDAY_BY_JS_DAY: readonly Weekday[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

// ─── PeriodKind ───────────────────────────────────────────────────────────────

export const PERIOD_KIND_VALUES = [
  // A regular teaching period — assignable
  'PERIOD',
  // A break (lunch/recess) — not assignable
  'BREAK',
  // A morning/zero or evening extra period — assignable
  'EXTRA',
] as const;

export type PeriodKind = (typeof PERIOD_KIND_VALUES)[number];

export const PeriodKind = Object.fromEntries(PERIOD_KIND_VALUES.map((v) => [v, v])) as {
  readonly [K in PeriodKind]: K;
};

// ─── DaySession ───────────────────────────────────────────────────────────────

export const DAY_SESSION_VALUES = [
  // Prepended before the first regular period (zero/morning extra classes)
  'MORNING',
  // The main school day (regular periods + breaks)
  'MAIN',
  // Appended after the last regular period (evening extra classes)
  'EVENING',
] as const;

export type DaySession = (typeof DAY_SESSION_VALUES)[number];

export const DaySession = Object.fromEntries(DAY_SESSION_VALUES.map((v) => [v, v])) as {
  readonly [K in DaySession]: K;
};

// ─── TimetableOverrideType ────────────────────────────────────────────────────

export const TIMETABLE_OVERRIDE_TYPE_VALUES = [
  // A substitute teacher takes the slot for that date
  'SUBSTITUTION',
  // The slot is cancelled for that date (free period)
  'CANCELLATION',
  // Same teacher/subject, different room for that date
  'ROOM_CHANGE',
  // Different subject for that date (e.g. extra revision)
  'SUBJECT_CHANGE',
  // An ad-hoc extra slot added only for that date
  'EXTRA',
] as const;

export type TimetableOverrideType = (typeof TIMETABLE_OVERRIDE_TYPE_VALUES)[number];

export const TimetableOverrideType = Object.fromEntries(
  TIMETABLE_OVERRIDE_TYPE_VALUES.map((v) => [v, v]),
) as { readonly [K in TimetableOverrideType]: K };
