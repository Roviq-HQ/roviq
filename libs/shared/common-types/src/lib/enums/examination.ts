/**
 * Examination & report-card domain enums — single source of truth.
 *
 * Consumed by:
 *   - `libs/database` → `pgEnum(...)` column types
 *   - `apps/api-gateway` → `registerEnumType(...)` + `@IsEnum(...)` + `@Field(() => ...)`
 *   - `apps/web` → Zod schemas, Select options, runtime comparisons
 */

// ─── ExamType ─────────────────────────────────────────────────────────────────

export const EXAM_TYPE_VALUES = [
  // Short class test (low weight)
  'UNIT_TEST',
  // Periodic/formative test (CBSE PT1–PT4)
  'PERIODIC_TEST',
  // Mid-term / first-term summative
  'MID_TERM',
  // Half-yearly summative
  'HALF_YEARLY',
  // End-of-term summative
  'FINAL_TERM',
  // Annual / yearly summative
  'ANNUAL',
  // Practical / lab examination
  'PRACTICAL',
  // Pre-board mock (classes 10/12)
  'PRE_BOARD',
  // External board examination
  'BOARD',
  // Continuous internal assessment / project work
  'INTERNAL_ASSESSMENT',
  // Anything not covered above
  'OTHER',
] as const;

export type ExamType = (typeof EXAM_TYPE_VALUES)[number];

export const ExamType = Object.fromEntries(EXAM_TYPE_VALUES.map((v) => [v, v])) as {
  readonly [K in ExamType]: K;
};

// ─── ExamStatus ───────────────────────────────────────────────────────────────

export const EXAM_STATUS_VALUES = [
  // Being configured (scope, schedule, scheme) — fully editable
  'DRAFT',
  // Datesheet published; awaiting the exam window
  'SCHEDULED',
  // Marks entry is open for teachers
  'MARKS_ENTRY',
  // Marks frozen; pending result computation/publish
  'LOCKED',
  // Results computed and visible to students/parents
  'RESULTS_PUBLISHED',
  // Permanently retired; terminal, read-only
  'ARCHIVED',
] as const;

export type ExamStatus = (typeof EXAM_STATUS_VALUES)[number];

export const ExamStatus = Object.fromEntries(EXAM_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in ExamStatus]: K;
};

// ─── AssessmentComponent ────────────────────────────────────────────────────────

export const ASSESSMENT_COMPONENT_VALUES = [
  // Written theory paper (maps to subjects.theoryMarks)
  'THEORY',
  // Practical/lab component (maps to subjects.practicalMarks)
  'PRACTICAL',
  // Internal assessment (maps to subjects.internalMarks)
  'INTERNAL',
  // Project work
  'PROJECT',
  // Oral / viva
  'ORAL',
] as const;

export type AssessmentComponent = (typeof ASSESSMENT_COMPONENT_VALUES)[number];

export const AssessmentComponent = Object.fromEntries(
  ASSESSMENT_COMPONENT_VALUES.map((v) => [v, v]),
) as { readonly [K in AssessmentComponent]: K };

// ─── GradingSchemeKind ──────────────────────────────────────────────────────────

export const GRADING_SCHEME_KIND_VALUES = [
  // Marks → grade bands with grade points (scholastic subjects)
  'SCHOLASTIC',
  // Qualitative grade-only bands, no marks (co-scholastic / work-education / discipline)
  'CO_SCHOLASTIC',
] as const;

export type GradingSchemeKind = (typeof GRADING_SCHEME_KIND_VALUES)[number];

export const GradingSchemeKind = Object.fromEntries(
  GRADING_SCHEME_KIND_VALUES.map((v) => [v, v]),
) as { readonly [K in GradingSchemeKind]: K };

// ─── CompetencyLevel (NEP topic-wise attainment) ─────────────────────────────────

export const COMPETENCY_LEVEL_VALUES = [
  // Yet to grasp the learning outcome
  'BEGINNER',
  // Developing — partial attainment
  'PROGRESSING',
  // Meets the expected learning outcome
  'PROFICIENT',
  // Exceeds the expected learning outcome
  'ADVANCED',
] as const;

export type CompetencyLevel = (typeof COMPETENCY_LEVEL_VALUES)[number];

export const CompetencyLevel = Object.fromEntries(COMPETENCY_LEVEL_VALUES.map((v) => [v, v])) as {
  readonly [K in CompetencyLevel]: K;
};

// ─── ReportCardStatus ───────────────────────────────────────────────────────────

export const REPORT_CARD_STATUS_VALUES = [
  // Template configured; no student instances generated yet
  'DRAFT',
  // Per-student instances computed but not yet visible to parents
  'GENERATED',
  // Released to students/parents
  'PUBLISHED',
  // Retired; terminal, read-only
  'ARCHIVED',
] as const;

export type ReportCardStatus = (typeof REPORT_CARD_STATUS_VALUES)[number];

export const ReportCardStatus = Object.fromEntries(
  REPORT_CARD_STATUS_VALUES.map((v) => [v, v]),
) as { readonly [K in ReportCardStatus]: K };

// ─── ResultStatus ─────────────────────────────────────────────────────────────

export const RESULT_STATUS_VALUES = [
  // Cleared all mandatory subjects
  'PASS',
  // Below the pass band in one or more mandatory subjects
  'FAIL',
  // Eligible for a supplementary/compartment exam
  'COMPARTMENT',
  // Absent for the whole exam
  'ABSENT',
  // Not yet computed
  'PENDING',
] as const;

export type ResultStatus = (typeof RESULT_STATUS_VALUES)[number];

export const ResultStatus = Object.fromEntries(RESULT_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in ResultStatus]: K;
};
