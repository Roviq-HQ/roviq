import type {
  AppAbility,
  ExamStatus,
  GradingSchemeKind,
  ReportCardStatus,
} from '@roviq/common-types';
import type {
  AttendanceTally,
  CoScholasticAreaRecord,
  CoScholasticAssessmentRecord,
  CreateCoScholasticAreaData,
  CreateExamData,
  CreateExamScheduleData,
  CreateExamTermData,
  CreateGradingSchemeData,
  CreateReportCardData,
  CreateSubjectTopicData,
  ExamLabelMaps,
  ExamMarkRecord,
  ExamRecord,
  ExamRefKind,
  ExamRefs,
  ExamScheduleRecord,
  ExamTermRecord,
  ExamTopicAssessmentRecord,
  GradeBandData,
  GradeBandRecord,
  GradingSchemeRecord,
  ListExamsQuery,
  PaginatedExams,
  ReportCardInstanceRecord,
  ReportCardRecord,
  RosterStudent,
  SubjectTopicRecord,
  UpdateExamData,
  UpdateExamScheduleData,
  UpsertCoScholasticAssessmentData,
  UpsertExamMarkData,
  UpsertReportCardInstanceData,
  UpsertTopicAssessmentData,
} from './types';

/**
 * Persistence for the examination aggregate (grade schemes, terms, exams,
 * datesheet, marks) plus the cross-entity reads results computation needs
 * (section roster, display labels, attendance tally). Report cards + NEP topics
 * + co-scholastic land in a Phase 4 extension. Plumbing only — grading math and
 * state transitions live in the services.
 */
export abstract class ExaminationRepository {
  /**
   * Reads caller-supplied ids under the caller's institute and names the first kind that has a
   * missing row. The foreign keys of the examination tables accept any institute's row.
   */
  abstract findMissingRef(refs: ExamRefs): Promise<ExamRefKind | null>;

  // ── Grading schemes + bands ──────────────────────────────────────────────
  abstract createGradingScheme(
    data: CreateGradingSchemeData,
    bands: GradeBandData[],
  ): Promise<GradingSchemeRecord>;
  abstract updateGradingScheme(
    id: string,
    data: Partial<CreateGradingSchemeData>,
  ): Promise<GradingSchemeRecord>;
  abstract replaceBands(
    gradingSchemeId: string,
    bands: GradeBandData[],
  ): Promise<GradeBandRecord[]>;
  abstract findGradingSchemeById(id: string): Promise<GradingSchemeRecord | null>;
  abstract listGradingSchemes(kind?: GradingSchemeKind): Promise<GradingSchemeRecord[]>;
  abstract findBands(gradingSchemeId: string): Promise<GradeBandRecord[]>;
  abstract findDefaultScheme(kind: GradingSchemeKind): Promise<GradingSchemeRecord | null>;
  abstract softDeleteGradingScheme(id: string): Promise<void>;
  /** Count of exams + co-scholastic areas + report cards referencing a scheme. */
  abstract countSchemeReferences(gradingSchemeId: string): Promise<number>;

  // ── Exam terms ────────────────────────────────────────────────────────────
  abstract createExamTerm(data: CreateExamTermData): Promise<ExamTermRecord>;
  abstract updateExamTerm(id: string, data: Partial<CreateExamTermData>): Promise<ExamTermRecord>;
  abstract listExamTerms(academicYearId: string): Promise<ExamTermRecord[]>;
  abstract findExamTermById(id: string): Promise<ExamTermRecord | null>;
  abstract softDeleteExamTerm(id: string): Promise<void>;

  // ── Exams ─────────────────────────────────────────────────────────────────
  abstract createExam(data: CreateExamData): Promise<ExamRecord>;
  abstract findExamById(id: string): Promise<ExamRecord | null>;
  abstract listExams(query: ListExamsQuery): Promise<PaginatedExams>;
  abstract updateExam(id: string, data: UpdateExamData): Promise<ExamRecord>;
  abstract setExamStatus(id: string, status: ExamStatus): Promise<ExamRecord>;
  abstract softDeleteExam(id: string): Promise<void>;
  abstract restoreExam(id: string): Promise<ExamRecord>;

  // ── Exam schedules (datesheet) ──────────────────────────────────────────────
  abstract createSchedule(data: CreateExamScheduleData): Promise<ExamScheduleRecord>;
  abstract updateSchedule(id: string, data: UpdateExamScheduleData): Promise<ExamScheduleRecord>;
  abstract findScheduleById(id: string): Promise<ExamScheduleRecord | null>;
  abstract findSchedulesByExam(examId: string): Promise<ExamScheduleRecord[]>;
  abstract findSchedulesByExamSection(
    examId: string,
    sectionId: string,
  ): Promise<ExamScheduleRecord[]>;
  abstract softDeleteSchedule(id: string): Promise<void>;

  // ── Exam marks ────────────────────────────────────────────────────────────
  /** Bulk upsert by (examScheduleId, studentId); bumps `version` on update. */
  abstract upsertMarks(data: UpsertExamMarkData[]): Promise<ExamMarkRecord[]>;
  abstract findMarksBySchedule(examScheduleId: string): Promise<ExamMarkRecord[]>;
  /** All marks across every schedule of an exam for one section (results). */
  abstract findMarksByExamSection(examId: string, sectionId: string): Promise<ExamMarkRecord[]>;

  // ── Cross-entity reads ──────────────────────────────────────────────────────
  abstract listSectionRoster(sectionId: string, academicYearId: string): Promise<RosterStudent[]>;
  abstract resolveLabels(input: {
    subjectIds: string[];
    sectionIds: string[];
    studentMembershipIds: string[];
    staffMembershipIds: string[];
  }): Promise<ExamLabelMaps>;
  abstract attendanceTally(
    studentId: string,
    academicYearId: string,
    fromDate: string,
    toDate: string,
  ): Promise<AttendanceTally>;

  // ── NEP subject topics + topic assessments ──────────────────────────────────
  abstract createSubjectTopic(data: CreateSubjectTopicData): Promise<SubjectTopicRecord>;
  abstract listSubjectTopics(subjectId: string, standardId?: string): Promise<SubjectTopicRecord[]>;
  abstract softDeleteSubjectTopic(id: string): Promise<void>;
  abstract upsertTopicAssessments(
    data: UpsertTopicAssessmentData[],
  ): Promise<ExamTopicAssessmentRecord[]>;
  abstract findTopicAssessmentsByExamSection(
    examId: string,
    sectionId: string,
  ): Promise<ExamTopicAssessmentRecord[]>;

  // ── Co-scholastic ────────────────────────────────────────────────────────────
  abstract createCoScholasticArea(
    data: CreateCoScholasticAreaData,
  ): Promise<CoScholasticAreaRecord>;
  abstract listCoScholasticAreas(): Promise<CoScholasticAreaRecord[]>;
  abstract softDeleteCoScholasticArea(id: string): Promise<void>;
  abstract upsertCoScholasticAssessments(
    data: UpsertCoScholasticAssessmentData[],
  ): Promise<CoScholasticAssessmentRecord[]>;
  abstract findCoScholasticAssessments(examTermId: string): Promise<CoScholasticAssessmentRecord[]>;

  // ── Report cards + instances ──────────────────────────────────────────────────
  abstract createReportCard(data: CreateReportCardData): Promise<ReportCardRecord>;
  abstract updateReportCard(
    id: string,
    data: Partial<CreateReportCardData>,
  ): Promise<ReportCardRecord>;
  /** The year's report cards the ability may read. */
  abstract listReportCards(
    academicYearId: string,
    ability: AppAbility,
  ): Promise<ReportCardRecord[]>;
  /** A report card the ability may read; null when it is missing or outside the ability. */
  abstract findReadableReportCardById(
    id: string,
    ability: AppAbility,
  ): Promise<ReportCardRecord | null>;
  /** For callers that manage report cards: no row rule is applied. */
  abstract findReportCardById(id: string): Promise<ReportCardRecord | null>;
  abstract setReportCardStatus(id: string, status: ReportCardStatus): Promise<ReportCardRecord>;
  abstract softDeleteReportCard(id: string): Promise<void>;

  abstract upsertReportCardInstances(
    data: UpsertReportCardInstanceData[],
  ): Promise<ReportCardInstanceRecord[]>;
  abstract findReportCardInstanceById(
    id: string,
    ability: AppAbility,
  ): Promise<ReportCardInstanceRecord | null>;
  /** Null also when the ability does not cover the instance (another student's card). */
  abstract findReportCardInstance(
    reportCardId: string,
    studentProfileId: string,
    ability: AppAbility,
  ): Promise<ReportCardInstanceRecord | null>;
  abstract listReportCardInstances(
    reportCardId: string,
    ability: AppAbility,
  ): Promise<ReportCardInstanceRecord[]>;
  abstract listReportCardInstancesByStudent(
    studentProfileId: string,
  ): Promise<ReportCardInstanceRecord[]>;
  abstract publishReportCardInstances(reportCardId: string): Promise<number>;

  // ── Generation helpers ─────────────────────────────────────────────────────────
  abstract listExamsInTerm(examTermId: string): Promise<ExamRecord[]>;
  abstract listSubjectTopicsForSubjects(subjectIds: string[]): Promise<SubjectTopicRecord[]>;
  /** Resolve the student-profile id for a membership (student portal). */
  abstract findStudentProfileIdByMembership(membershipId: string): Promise<string | null>;
}
