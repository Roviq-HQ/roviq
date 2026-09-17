import type {
  AssessmentComponent,
  CompetencyLevel,
  ExamStatus,
  ExamType,
  GradingSchemeKind,
  ReportCardStatus,
  ResultStatus,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';

// Numeric columns use Drizzle `mode: 'number'`, so they read/write as numbers.
// `null` = not set / not applicable.
type Decimal = number;

// ── Grading schemes + bands ───────────────────────────────────────────────────

export interface GradingSchemeRecord {
  id: string;
  tenantId: string;
  name: I18nContent;
  kind: GradingSchemeKind;
  board: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface GradeBandRecord {
  id: string;
  tenantId: string;
  gradingSchemeId: string;
  grade: string;
  minPercent: Decimal | null;
  maxPercent: Decimal | null;
  gradePoint: Decimal | null;
  descriptor: string | null;
  isPassing: boolean;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateGradingSchemeData {
  name: I18nContent;
  kind: GradingSchemeKind;
  board?: string | null;
  isDefault?: boolean;
}

export interface GradeBandData {
  grade: string;
  minPercent?: number | null;
  maxPercent?: number | null;
  gradePoint?: number | null;
  descriptor?: string | null;
  isPassing?: boolean;
  sequence?: number;
}

// ── Exam terms ─────────────────────────────────────────────────────────────────

export interface ExamTermRecord {
  id: string;
  tenantId: string;
  academicYearId: string;
  name: I18nContent;
  sequence: number;
  weightInFinal: Decimal;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExamTermData {
  academicYearId: string;
  name: I18nContent;
  sequence?: number;
  weightInFinal?: number;
}

// ── Exams ─────────────────────────────────────────────────────────────────────

export interface ExamRecord {
  id: string;
  tenantId: string;
  academicYearId: string;
  examTermId: string | null;
  name: I18nContent;
  type: ExamType;
  gradingSchemeId: string | null;
  status: ExamStatus;
  startDate: string | null;
  endDate: string | null;
  weightInTerm: Decimal;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExamData {
  academicYearId: string;
  examTermId?: string | null;
  name: I18nContent;
  type: ExamType;
  gradingSchemeId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  weightInTerm?: number;
  description?: string | null;
}

export interface UpdateExamData {
  name?: I18nContent;
  type?: ExamType;
  examTermId?: string | null;
  gradingSchemeId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  weightInTerm?: number;
  description?: string | null;
}

export interface ListExamsQuery {
  academicYearId?: string;
  examTermId?: string;
  status?: ExamStatus;
  sectionId?: string;
  search?: string;
  page: number;
  perPage: number;
}

export interface PaginatedExams {
  docs: ExamRecord[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ── Exam schedules (datesheet) ──────────────────────────────────────────────────

export interface ExamScheduleRecord {
  id: string;
  tenantId: string;
  examId: string;
  sectionId: string;
  subjectId: string;
  component: AssessmentComponent;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  maxMarks: Decimal;
  passMarks: Decimal | null;
  room: string | null;
  invigilatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExamScheduleData {
  examId: string;
  sectionId: string;
  subjectId: string;
  component: AssessmentComponent;
  examDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  maxMarks: number;
  passMarks?: number | null;
  room?: string | null;
  invigilatorId?: string | null;
}

export interface UpdateExamScheduleData {
  component?: AssessmentComponent;
  examDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  maxMarks?: number;
  passMarks?: number | null;
  room?: string | null;
  invigilatorId?: string | null;
}

// ── Exam marks ─────────────────────────────────────────────────────────────────

export interface ExamMarkRecord {
  id: string;
  tenantId: string;
  examScheduleId: string;
  studentId: string;
  obtainedMarks: Decimal | null;
  isAbsent: boolean;
  isExempted: boolean;
  remarks: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertExamMarkData {
  examScheduleId: string;
  studentId: string;
  obtainedMarks?: number | null;
  isAbsent?: boolean;
  isExempted?: boolean;
  remarks?: string | null;
}

// ── Subject topics + topic assessments (NEP) ─────────────────────────────────────

export interface SubjectTopicRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  standardId: string | null;
  name: I18nContent;
  code: string | null;
  learningOutcome: string | null;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubjectTopicData {
  subjectId: string;
  standardId?: string | null;
  name: I18nContent;
  code?: string | null;
  learningOutcome?: string | null;
  sequence?: number;
}

export interface ExamTopicAssessmentRecord {
  id: string;
  tenantId: string;
  examScheduleId: string;
  studentId: string;
  subjectTopicId: string;
  competencyLevel: CompetencyLevel;
  descriptor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertTopicAssessmentData {
  examScheduleId: string;
  studentId: string;
  subjectTopicId: string;
  competencyLevel: CompetencyLevel;
  descriptor?: string | null;
}

// ── Co-scholastic ────────────────────────────────────────────────────────────────

export interface CoScholasticAreaRecord {
  id: string;
  tenantId: string;
  name: I18nContent;
  gradingSchemeId: string | null;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCoScholasticAreaData {
  name: I18nContent;
  gradingSchemeId?: string | null;
  sequence?: number;
}

export interface CoScholasticAssessmentRecord {
  id: string;
  tenantId: string;
  coScholasticAreaId: string;
  studentId: string;
  examTermId: string;
  grade: string;
  descriptor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCoScholasticAssessmentData {
  coScholasticAreaId: string;
  studentId: string;
  examTermId: string;
  grade: string;
  descriptor?: string | null;
}

// ── Report cards ────────────────────────────────────────────────────────────────

export interface ReportCardRecord {
  id: string;
  tenantId: string;
  academicYearId: string;
  examTermId: string | null;
  name: I18nContent;
  gradingSchemeId: string | null;
  includeAttendance: boolean;
  includeCoScholastic: boolean;
  includeTopicWise: boolean;
  status: ReportCardStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportCardData {
  academicYearId: string;
  examTermId?: string | null;
  name: I18nContent;
  gradingSchemeId?: string | null;
  includeAttendance?: boolean;
  includeCoScholastic?: boolean;
  includeTopicWise?: boolean;
}

export interface ReportCardInstanceRecord {
  id: string;
  tenantId: string;
  reportCardId: string;
  studentProfileId: string;
  sectionId: string | null;
  academicYearId: string;
  status: ReportCardStatus;
  maxMarks: Decimal | null;
  obtainedMarks: Decimal | null;
  percentage: Decimal | null;
  gpa: Decimal | null;
  grade: string | null;
  rank: number | null;
  attendancePercent: Decimal | null;
  resultStatus: ResultStatus;
  classTeacherRemark: string | null;
  principalRemark: string | null;
  payload: Record<string, unknown>;
  generatedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertReportCardInstanceData {
  reportCardId: string;
  studentProfileId: string;
  sectionId: string | null;
  academicYearId: string;
  maxMarks: number | null;
  obtainedMarks: number | null;
  percentage: number | null;
  gpa: number | null;
  grade: string | null;
  rank: number | null;
  attendancePercent: number | null;
  resultStatus: ResultStatus;
  payload: Record<string, unknown>;
}

// ── Cross-entity read helpers ─────────────────────────────────────────────────

/** A student enrolled in a section for an academic year (exam roster row). */
export interface RosterStudent {
  studentProfileId: string;
  membershipId: string;
  rollNumber: string | null;
  firstName: I18nContent;
  lastName: I18nContent | null;
}

/** id → display label maps for rendering results / PDFs. */
export interface ExamLabelMaps {
  subjects: Record<string, string>;
  sections: Record<string, string>;
  students: Record<string, string>;
  /** staff membership id → full name (datesheet invigilator column). */
  staff: Record<string, string>;
}

/** Attendance tally for a student over a date range (report-card attendance %). */
export interface AttendanceTally {
  present: number;
  total: number;
}
