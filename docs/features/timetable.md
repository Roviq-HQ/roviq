# Timetable

Institute-scope weekly scheduling: master timetables for a set of sections, a generated period grid, per-section/per-weekday/per-split subject+teacher+room assignments, section & staff views, and per-date overrides (substitutions, cancellations). Module: `apps/api-gateway/src/institute/timetable/`. UI: `apps/web/src/app/[locale]/institute/(dashboard)/timetable/`.

## Data model (5 tenant-scoped tables)

All spread `tenantColumns`, have an `institutes` FK on `tenant_id`, RLS via `tenantPolicies()`, and a `<table>_live` security-invoker view (reads go through the view, writes target the base table).

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `timetables` | Master template for one academic year | partial-unique `(tenant_id, academic_year_id) WHERE status='ACTIVE'` (single active); partial-unique name; `CHECK effective_from <= effective_to` |
| `timetable_sections` | Sections a timetable covers | unique `(timetable_id, section_id)` |
| `timetable_periods` | Shared time grid: `PERIOD` / `BREAK` / `EXTRA` rows with `time` start/end | unique `(timetable_id, sequence)`, unique `(timetable_id, label)`, `CHECK end_time > start_time` |
| `timetable_entries` | Assignment cell: (section, period, weekday, split) → subject/teacher/room | unique cell key; **partial-unique `(timetable_id, period_id, day_of_week, teacher_id) WHERE teacher_id IS NOT NULL`** — DB backstop against teacher double-booking |
| `timetable_day_overrides` | Per-date deviation (substitution/cancellation/room/subject change/extra), snapshots the original | unique `(timetable_id, date, section_id, period_id, split_index)` |

Enums (single source in `@roviq/common-types`): `TimetableStatus` (DRAFT/ACTIVE/INACTIVE/ARCHIVED), `Weekday` (MONDAY–SUNDAY), `PeriodKind` (PERIOD/BREAK/EXTRA), `DaySession` (MORNING/MAIN/EVENING), `TimetableOverrideType`.

Migration: `libs/database/migrations/20260526224039_thankful_ravenous` (tables, enums, indexes, `_live` views, RLS policies, grants).

## Services

- `timetable-generation.service.ts` — pure period-grid builder (minutes math): regular periods → lunch breaks interleaved after their configured period → morning extras prepended / evening extras appended (namespaced labels). Validates lunch positions, durations, period count. 6 unit tests.
- `timetable.service.ts` — master CRUD; **named status transitions** `activate`/`deactivate`/`archive` via `TIMETABLE_STATE_MACHINE` (no raw `updateStatus`); `activate` is a transactional single-active swap; sections add/remove; period add/update/remove; statistics; soft-delete/restore. Create is atomic (`createWithGrid`).
- `timetable-schedule.service.ts` — entry assign/clear with two-phase conflict detection: teacher double-booking + room clash, validated against DB state **and** within the batch, before any write.
- `timetable-view.service.ts` — section/staff weekly grids; per-date `daySchedule` (master entries for the weekday overlaid with that date's overrides — substitution replaces, cancellation hides); override create/clear.
- `timetable-pdf.service.ts` — renders a section or staff weekly grid to a **real downloadable PDF** (pdfkit, A4 landscape, manual table layout with page-break-aware row heights). Display labels (subject / "Standard - Section" / teacher name) are resolved server-side by `TimetableRepository.resolveLabels()`, which reads `subjectsLive`, `sectionsLive`+`standardsLive`, and `staffProfilesLive`+`userProfiles` (teacher = membership id) under tenant RLS. Returns a `Buffer`; the resolver base64-encodes it. Follows the EE invoice-PDF pattern. 4 unit tests.

## GraphQL surface (institute scope, `@CheckAbility(..., 'Timetable')`)

Queries: `timetables` (paginated), `timetable`, `timetableStatistics`, `sectionTimetable`, `staffTimetable`, `timetableDaySchedule`, `staffDaySchedule`, `timetableDayOverrides`, **`sectionTimetablePdf` / `staffTimetablePdf`** (return a base64-encoded PDF `String`, mirror the EE `generateInvoicePdf` shape).
Mutations: `createTimetable`, `updateTimetable`, **`activateTimetable` / `deactivateTimetable` / `archiveTimetable`** (named transitions), `deleteTimetable`, `restoreTimetable`, `addTimetableSection`, `removeTimetableSection`, `addTimetablePeriod`, `updateTimetablePeriod`, `removeTimetablePeriod`, `assignTimetableEntry`, `clearTimetableEntry`, `createTimetableDayOverride`, `clearTimetableDayOverride`.

## Events

`EVENT_PATTERNS.TIMETABLE.*` (created/updated/deleted/restored/activated/deactivated/archived/section_added/section_removed/period_added/period_removed/entry_assigned/entry_cleared/day_overridden/override_cleared), stream `TIMETABLE` (`TIMETABLE.>`). Emitted via `EventBusService`; every payload carries `tenantId`.

## CASL

Subject `Timetable`. `read` granted to class_teacher, subject_teacher, lab_assistant, student, parent; `manage` to institute_admin, principal, vice_principal, academic_coordinator.

## Frontend

Pages: list + full-screen create dialog (`page.tsx`), grid editor (`[timetableId]/`), section/staff read-only grids, and a day-schedule + override page. Shared pickers (`SectionPicker`, `StandardSectionSelect`) live in `apps/web/src/components/pickers/`.

- **PDF + print** — the section and staff views offer **Download PDF** (server-rendered via `useSectionTimetablePdf` / `useStaffTimetablePdf` → base64 → Blob download, shared `downloadBase64Pdf` helper) alongside browser **Print** (`@media print` chrome hiding).
- **Deep-links** — `section-timetable?section=&standard=` and `staff-timetable?teacher=` pre-select the view; `StandardSectionSelect` accepts `initialStandardId` and emits `onStandardChange`.

### Cross-app wiring

- **Dashboard** — `today-schedule-card.tsx`: the signed-in teacher's resolved classes for today (`staffDaySchedule`), gated `read:Timetable`, hidden when there are no classes (so label lookups only mount for teachers). A **Timetable** feature link is also added to the dashboard.
- **Academics → section** — each section row on the standard-detail page has a **View timetable** link to `section-timetable`.
- **People → staff** — staff detail header links to that teacher's `staff-timetable`.
- **People → student** — student detail sidebar links to the student's section `section-timetable` (the student/parent read-only view; `read:Timetable` is granted to student/parent roles).
- **Attendance** — each non-break slot on the day-schedule page links to `/institute/attendance` pre-filled with `date`/`standard`/`section`/`period` (the numeric period label maps to the attendance period; the attendance page already reads these via nuqs).

## Deviations from the legacy (Mongo) module — intentional

1. Per-date **overrides** replace daily full snapshots — any date queryable, no cron, no storage bloat, fixes the legacy snapshot dup-teacher bug.
2. **Times as `time`** + minutes math (not `HH:mm:ss` string parsing).
3. **Transactional activate** (auto-deactivates the prior active) instead of rejecting.
4. DRAFT/ARCHIVED states added; Sunday supported via configurable `workingDays`.

## Tests

- Unit: `timetable-generation`, `timetable-schedule` (conflict detection), `timetable-view` (day resolution), `timetable-pdf` (PDF buffer + label resolution) — 24 cases.
- E2E API: `e2e/api-gateway-e2e/src/timetable.api-e2e.spec.ts` — lifecycle, teacher conflict, tenant isolation, auth (4 cases, green on the live stack).
- E2E UI: `e2e/web-institute-e2e/src/timetable.e2e.spec.ts` — list & wizard, lifecycle (activate/deactivate/archive), grid cell assignment, period add, section/staff views + PDF download, day-schedule + attendance deep-link, day override create/clear, and cross-app wiring links (dashboard, staff detail, academics section).

## RLS audit

All 5 tables FORCE RLS via `tenantPolicies()` (app select/insert/update scoped to `current_setting('app.current_tenant_id')`, hard delete blocked, reseller read for owned institutes, admin all). Soft-delete visibility via `_live` views. No table is on `RLS_EXEMPT_BASENAMES`; `check:rls-coverage`, `check:live-views`, `check:live-views-coverage` all pass.
