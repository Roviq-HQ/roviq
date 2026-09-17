import type { ExamStatus, ReportCardStatus } from '../enums/examination';
import { defineStateMachine } from '../state-machine';

/**
 * DRAFT → SCHEDULED (publish datesheet) / ARCHIVED.
 * SCHEDULED → MARKS_ENTRY (open entry) / ARCHIVED.
 * MARKS_ENTRY → LOCKED (freeze marks) / ARCHIVED.
 * LOCKED → MARKS_ENTRY (re-open for correction) / RESULTS_PUBLISHED / ARCHIVED.
 * RESULTS_PUBLISHED → ARCHIVED.
 * ARCHIVED → RESULTS_PUBLISHED (unarchive restores the exam to its published state).
 */
export const EXAM_STATE_MACHINE = defineStateMachine<ExamStatus>('Exam', {
  DRAFT: ['SCHEDULED', 'ARCHIVED'],
  SCHEDULED: ['MARKS_ENTRY', 'ARCHIVED'],
  MARKS_ENTRY: ['LOCKED', 'ARCHIVED'],
  LOCKED: ['MARKS_ENTRY', 'RESULTS_PUBLISHED', 'ARCHIVED'],
  RESULTS_PUBLISHED: ['ARCHIVED'],
  // Unarchive is reversible: admins restore an archived exam to its prior published state.
  ARCHIVED: ['RESULTS_PUBLISHED'],
});

/**
 * DRAFT → GENERATED (compute per-student instances) / ARCHIVED.
 * GENERATED → PUBLISHED (release to parents) / DRAFT (regenerate) / ARCHIVED.
 * PUBLISHED → ARCHIVED.
 * ARCHIVED is terminal.
 */
export const REPORT_CARD_STATE_MACHINE = defineStateMachine<ReportCardStatus>('ReportCard', {
  DRAFT: ['GENERATED', 'ARCHIVED'],
  GENERATED: ['PUBLISHED', 'DRAFT', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
});
