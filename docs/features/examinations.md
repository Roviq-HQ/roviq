# Examinations & Report Cards

Institute-scope offline examinations: configurable grade schemes, exam terms, exams with a per-section/subject datesheet, bulk marks entry with range + lifecycle guards, computed section results with dense ranking, NEP topic-wise competency assessments, co-scholastic grades, and **term-aggregated report cards** rendered to downloadable PDFs. Module: `apps/api-gateway/src/institute/examination/`. UI: `apps/web/src/app/[locale]/institute/(dashboard)/examinations/`.

This is offline-exam management only — there is **no** online quiz/test-taking engine. Marks are entered by staff after a paper-based exam.

## Data model (12 tenant-scoped tables)

All spread `tenantColumns`, have an `institutes` FK on `tenant_id`, RLS via `tenantPolicies()`, and a `<table>_live` security-invoker view (reads go through the view, writes target the base table).

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `grading_schemes` | A grade scheme (`SCHOLASTIC` or `CO_SCHOLASTIC`), e.g. "CBSE 9-Point". Optional `board` label, `isDefault` fallback flag | partial-unique name `(tenant_id, name) WHERE deleted_at IS NULL` |
| `grade_bands` | One band of a scheme: `[minPercent,maxPercent]` percent → grade + grade point + descriptor + `isPassing` | unique `(grading_scheme_id, grade) WHERE deleted_at IS NULL`; scholastic bands must tile 0–100 (service-validated) |
| `exam_terms` | A term within an academic year (Term 1, Term 2…) with `weightInFinal` for the annual roll-up | unique `(tenant_id, academic_year_id, name) WHERE deleted_at IS NULL` |
| `exams` | An exam master: type, term, grade scheme, dates, `weightInTerm`, status | FK academic_year; `CHECK start_date <= end_date`; status drives the lifecycle |
| `exam_schedules` | Datesheet row: (exam, section, subject, component) → date/time/room/max marks/pass marks/invigilator | unique cell `(exam_id, section_id, subject_id, component) WHERE deleted_at IS NULL` |
| `exam_marks` | One student's marks for a datesheet row (obtained / absent / exempted) | unique `(exam_schedule_id, student_id) WHERE deleted_at IS NULL` |
| `subject_topics` | NEP learning outcome / topic for a subject (optionally per standard) | unique `(subject_id, standard_id, code) WHERE deleted_at IS NULL` |
| `exam_topic_assessments` | One student's competency for a topic in an exam (4-level) | unique `(exam_schedule_id, student_id, subject_topic_id) WHERE deleted_at IS NULL` |
| `co_scholastic_areas` | A co-scholastic domain (Discipline, Work Education…) with its grade scheme | unique `(tenant_id, name) WHERE deleted_at IS NULL` |
| `co_scholastic_assessments` | One student's co-scholastic grade for a term | unique `(co_scholastic_area_id, student_id, exam_term_id) WHERE deleted_at IS NULL` |
| `report_cards` | Report-card template for a term (or annual): grade scheme + include toggles (`includeAttendance` / `includeCoScholastic` / `includeTopicWise`) | FK academic_year / exam_term; unique `(tenant_id, academic_year_id, name) WHERE deleted_at IS NULL` |
| `report_card_instances` | The immutable per-student snapshot (`payload` jsonb) + rollups (percentage, gpa, grade, rank, attendance, result_status) | unique `(report_card_id, student_profile_id) WHERE deleted_at IS NULL` |

Enums (single source in `@roviq/common-types`, `UPPER_SNAKE`):

| Enum | Values |
| --- | --- |
| `ExamType` | `UNIT_TEST`, `PERIODIC_TEST`, `MID_TERM`, `HALF_YEARLY`, `FINAL_TERM`, `ANNUAL`, `PRACTICAL`, `PRE_BOARD`, `BOARD`, `INTERNAL_ASSESSMENT`, `OTHER` |
| `ExamStatus` | `DRAFT`, `SCHEDULED`, `MARKS_ENTRY`, `LOCKED`, `RESULTS_PUBLISHED`, `ARCHIVED` |
| `AssessmentComponent` | `THEORY`, `PRACTICAL`, `INTERNAL`, `PROJECT`, `ORAL` |
| `GradingSchemeKind` | `SCHOLASTIC`, `CO_SCHOLASTIC` |
| `CompetencyLevel` | `BEGINNER`, `PROGRESSING`, `PROFICIENT`, `ADVANCED` |
| `ReportCardStatus` | `DRAFT`, `GENERATED`, `PUBLISHED`, `ARCHIVED` |
| `ResultStatus` | `PASS`, `FAIL`, `COMPARTMENT`, `ABSENT`, `PENDING` |

Migration: `libs/database/migrations/20260527024000_blue_owl` (12 tables, 7 enums, 12 `_live` views, RLS policies + grants).

## State machines (`@roviq/common-types`)

- `EXAM_STATE_MACHINE`: `DRAFT → SCHEDULED → MARKS_ENTRY → LOCKED → RESULTS_PUBLISHED → ARCHIVED`. `LOCKED` can reopen to `MARKS_ENTRY` (correction window); any non-terminal state can jump straight to `ARCHIVED`. Enforced by named transitions, never a raw `updateStatus`.
- `REPORT_CARD_STATE_MACHINE`: `DRAFT → GENERATED → PUBLISHED → ARCHIVED`. `generate` flips `DRAFT → GENERATED`; `GENERATED` can also fall back to `DRAFT` (regenerate); `publish` flips `GENERATED → PUBLISHED`.

Forbidden transitions throw `BusinessException(ErrorCode.INVALID_STATE_TRANSITION)` (HTTP 422).

## Services

- `examination-grading.service.ts` — **pure** grading + aggregation math (no DB): `percentage`, `gradeForPercent`, `subjectResult` (sum-of-components, exempt-aware, absent-aware), `weightedTermPercentage` (Σ pct·weight / Σweight, absent exams excluded from the base), `gpa`, `denseRank` (1,1,2 ties), `overallResult` (PASS / COMPARTMENT ≤2 fails / FAIL / ABSENT / PENDING when no subjects), and `assertValidScholasticBands` (bands must tile 0–100 with no gaps/overlaps). 9 unit tests.
- `examination-config.service.ts` — grade schemes + bands (scholastic bands validated on create/replace), exam terms, NEP subject topics, co-scholastic areas. `deleteGradingScheme` blocks while referenced (`GRADING_SCHEME_IN_USE`).
- `examination.service.ts` — exam master CRUD, **named lifecycle transitions** via `EXAM_STATE_MACHINE`, and the datesheet (schedule add/update/remove). Soft-delete/restore.
- `examination-marks.service.ts` — `getMarksSheet` (section roster merged with existing marks), `enterMarks` (only while `MARKS_ENTRY` else `EXAM_NOT_IN_MARKS_ENTRY`; every mark range-checked `0..maxMarks` else `EXAM_MARKS_OUT_OF_RANGE`), `computeSectionResults` (per-subject component aggregation → grade from the exam's scheme → GPA → overall result → dense rank), and topic / co-scholastic upserts.
- `report-card-generation.service.ts` — for a term-targeted card, aggregates every non-DRAFT/non-ARCHIVED exam in the term (weighted by `weightInTerm`), grades the aggregate, pulls attendance % over the exam span (when `includeAttendance`), folds in NEP topic-wise competency (when `includeTopicWise`) and co-scholastic grades (when `includeCoScholastic`), and persists one immutable `payload` snapshot per student with a dense rank. Re-runnable (upsert); flips a `DRAFT` card to `GENERATED`. `publish` flips `GENERATED → PUBLISHED` and stamps every instance.
- `report-card-pdf.service.ts` — renders an instance's snapshot to a **real downloadable PDF** (pdfkit, A4 portrait: header + summary, scholastic table, NEP topic-wise block, co-scholastic table, remarks, footer). Returns a `Buffer`; the resolver base64-encodes it. Follows the EE invoice-PDF / timetable-PDF pattern.
- `report-card.service.ts` — report-card CRUD + delegates `generate`/`publish`; `listForMembership` surfaces a student/parent's own published cards (resolves the student profile from the membership id).

## GraphQL surface (institute scope)

Both resolvers guard with `@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)`. Each operation carries a granular `@CheckAbility(action, subject)` — `read`/`create`/`update`/`delete`/`manage` against `GradingScheme` | `Exam` | `ReportCard` (not blanket `manage`).

**Grading & config** — Queries: `gradingSchemes`, `gradingScheme`, `examTerms`, `subjectTopics`, `coScholasticAreas`. Mutations: `createGradingScheme`, `updateGradingScheme`, `replaceGradeBands`, `deleteGradingScheme`, `createExamTerm`, `updateExamTerm`, `deleteExamTerm`, `createSubjectTopic`, `deleteSubjectTopic`, `createCoScholasticArea`, `deleteCoScholasticArea` (config mutations require `manage`).

**Exams & marks** — Queries: `examsList` (paginated, filters `examTermId` / `status` / `sectionId` / `search`), `exam`, `examDatesheet`, `examMarksSheet`, `examResults`. Mutations: `createExam` (`create`), `updateExam` (`update`), **`scheduleExam` / `openExamMarksEntry` / `lockExam` / `publishExamResults` / `archiveExam`** (named transitions, `update`), `deleteExam` (`delete`), `restoreExam` (`manage`), `addExamSchedule` / `updateExamSchedule` / `removeExamSchedule` (`update`), `enterExamMarks` (`update`, returns the saved count), `enterTopicAssessments`, `enterCoScholasticAssessments` (return the upserted count).

**Report cards** — Queries: `reportCards`, `reportCard`, `reportCardInstances`, `reportCardInstance`, `myReportCards` (signed-in student/parent), **`reportCardPdf`** (arg `instanceId`, base64 `String`). Mutations: `createReportCard`, `updateReportCard`, `deleteReportCard`, `generateReportCards` (returns the instance count), `publishReportCards` (returns the published count) — all `manage`.

## CASL

Subjects `Exam`, `GradingScheme`, `ReportCard`. `manage` on all three is granted to `principal`, `vice_principal`, `academic_coordinator`, and `exam_coordinator` (plus `institute_admin` via `manage:all`). `subject_teacher` additionally gets `manage:Exam` (so subject teachers can run the exam → marks → results flow for their subjects). `read:ReportCard` is granted to `student` and `parent` (own cards via `myReportCards`). Both directions are enforced by `apps/api-gateway/src/__tests__/ability-coverage.spec.ts`.

## Frontend

`apps/web/src/app/[locale]/institute/(dashboard)/examinations/`:

- `page.tsx` — exam list (per academic year) + create dialog.
- `[examId]/page.tsx` — exam detail: datesheet builder, lifecycle controls, marks-entry grid dialog, computed results table.
- `grading-schemes/page.tsx` — scheme + band editor (defaults to CBSE 9-point).
- `report-cards/page.tsx` — report-card create, generate-for-section, publish, instances table, per-student PDF download.
- `use-examinations.ts` — the feature's GraphQL hooks.

i18n namespace `examinations` (`apps/web/messages/{en,hi}/examinations.json`). Nav slugs `examinations` / `reportCards` / `gradingSchemes` live in the **Academic** sidebar group. Testid group `instituteExaminations` in `@roviq/ui/testing/testid-registry`.

## Events

NATS event emission (`EVENT_PATTERNS.EXAM.*` / `REPORT_CARD.*`) is **not yet wired** — tracked as deferred work. There is no `EXAM`/`REPORT_CARD` stream registered and no `eventBus.emit` in any examination service. All mutations are transactional + RLS-scoped; cross-service consumers do not yet observe exam/report-card changes.

## Tests

- Unit: `examination-grading.service.spec.ts` (9 cases — the pure math).
- E2E API: `e2e/api-gateway-e2e/src/examination.api-e2e.spec.ts` — full pipeline (scheme + band validation → exam lifecycle → marks range/lifecycle guards → results + rank → term-aggregated report card → published PDF) plus auth/scope rejection and cross-tenant isolation.
- E2E UI: `e2e/web-institute-e2e/src/examinations.e2e.spec.ts` — the Playwright walkthrough across the examination pages.

## Demo seed data

`seedExaminations` (`libs/database/src/seed/demo/examinations.ts`) populates Institute 1 so every examination screen renders real data out of the box. It is idempotent (fixed `SEED_IDS` + `onConflictDoNothing`) and targets the **populated section** (`pickPopulatedSection` — the section with the most enrolled students, so marks/rosters are meaningful), using up to 3 subjects taught in that standard. It creates:

- **Grading schemes + bands** — a default `SCHOLASTIC` "CBSE 9-Point" scheme (board `CBSE`) with the 8 standard bands `A1…E` tiling 0–100 (A1 = 91–100 @ 10 GP down to E = 0–32 @ 0 GP, non-passing), and a default `CO_SCHOLASTIC` "Co-Scholastic A–E" descriptive scheme (grades A–E, no numeric range).
- **Terms** — `Term 1` (sequence 1) and `Term 2` (sequence 2), each `weightInFinal` 50.
- **A published Mid-Term exam** — "Mid Term Examination" (`type: MID_TERM`, `status: RESULTS_PUBLISHED`, the CBSE scheme, May 4–10 2026, `weightInTerm` 100) with a 3-row `THEORY` datesheet (max 100, pass 33, Hall A) and `exam_marks` for every enrolled student — marks are staggered per student so dense-rank produces distinct totals.
- **NEP topics** — two `subject_topics` ("Number Sense", "Problem Solving") on the first subject, with learning outcomes.
- **Co-scholastic areas** — "Discipline" and "Work Education", both on the co-scholastic scheme.
- **A Term-1 report-card template** — "Term 1 Report Card" in `DRAFT`, targeting Term 1, with `includeAttendance` / `includeCoScholastic` / `includeTopicWise` all on. Instances are **not** pre-generated — staff generate and publish them from the report-cards page.

The timetable seeder targets the same populated section for a coherent demo (see `docs/features/timetable.md`).
