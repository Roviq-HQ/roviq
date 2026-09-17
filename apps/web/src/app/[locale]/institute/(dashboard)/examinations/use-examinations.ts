'use client';

/**
 * Apollo hooks for the examinations + report-cards feature.
 *
 * NOTE (codegen): result/variable types are hand-written below and mirror the
 * backend code-first schema. After `pnpm codegen` runs against the live gateway,
 * the `gql` documents are covered by `*.generated.ts`; swap the local interfaces
 * for the generated types (same shape) — the documents + hook signatures stay.
 *
 * i18n: `name` fields are raw `i18nText` JSONB — resolve with `useI18nField()`
 * at the render site, never here.
 */
import { gql, useLazyQuery, useMutation, useQuery } from '@roviq/graphql';
import type { I18nText } from '@roviq/i18n';

// ── Enum unions (mirror @roviq/common-types) ────────────────────────────────

export type ExamType =
  | 'UNIT_TEST'
  | 'PERIODIC_TEST'
  | 'MID_TERM'
  | 'HALF_YEARLY'
  | 'FINAL_TERM'
  | 'ANNUAL'
  | 'PRACTICAL'
  | 'PRE_BOARD'
  | 'BOARD'
  | 'INTERNAL_ASSESSMENT'
  | 'OTHER';
export type ExamStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'MARKS_ENTRY'
  | 'LOCKED'
  | 'RESULTS_PUBLISHED'
  | 'ARCHIVED';
export type AssessmentComponent = 'THEORY' | 'PRACTICAL' | 'INTERNAL' | 'PROJECT' | 'ORAL';
export type GradingSchemeKind = 'SCHOLASTIC' | 'CO_SCHOLASTIC';
export type CompetencyLevel = 'BEGINNER' | 'PROGRESSING' | 'PROFICIENT' | 'ADVANCED';
export type ReportCardStatus = 'DRAFT' | 'GENERATED' | 'PUBLISHED' | 'ARCHIVED';
export type ResultStatus = 'PASS' | 'FAIL' | 'COMPARTMENT' | 'ABSENT' | 'PENDING';

export const EXAM_TYPES: ExamType[] = [
  'UNIT_TEST',
  'PERIODIC_TEST',
  'MID_TERM',
  'HALF_YEARLY',
  'FINAL_TERM',
  'ANNUAL',
  'PRACTICAL',
  'PRE_BOARD',
  'BOARD',
  'INTERNAL_ASSESSMENT',
  'OTHER',
];
export const ASSESSMENT_COMPONENTS: AssessmentComponent[] = [
  'THEORY',
  'PRACTICAL',
  'INTERNAL',
  'PROJECT',
  'ORAL',
];
export const COMPETENCY_LEVELS: CompetencyLevel[] = [
  'BEGINNER',
  'PROGRESSING',
  'PROFICIENT',
  'ADVANCED',
];

// ── Entity shapes ────────────────────────────────────────────────────────────

export interface GradeBand {
  id: string;
  grade: string;
  minPercent: number | null;
  maxPercent: number | null;
  gradePoint: number | null;
  descriptor: string | null;
  isPassing: boolean;
  sequence: number;
}
export interface GradingScheme {
  id: string;
  name: I18nText;
  kind: GradingSchemeKind;
  board: string | null;
  isDefault: boolean;
  bands?: GradeBand[];
}
export interface ExamTerm {
  id: string;
  academicYearId: string;
  name: I18nText;
  sequence: number;
  weightInFinal: number;
}
export interface Exam {
  id: string;
  academicYearId: string;
  examTermId: string | null;
  name: I18nText;
  type: ExamType;
  gradingSchemeId: string | null;
  status: ExamStatus;
  startDate: string | null;
  endDate: string | null;
  weightInTerm: number;
  description: string | null;
}
export interface PaginatedExams {
  docs: Exam[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
export interface ExamSchedule {
  id: string;
  examId: string;
  sectionId: string;
  subjectId: string;
  component: AssessmentComponent;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  maxMarks: number;
  passMarks: number | null;
  room: string | null;
  invigilatorId: string | null;
}
export interface MarksSheetRow {
  studentId: string;
  studentProfileId: string;
  rollNumber: string | null;
  name: string;
  obtainedMarks: number | null;
  isAbsent: boolean;
  isExempted: boolean;
  remarks: string | null;
}
export interface MarksSheet {
  schedule: ExamSchedule;
  rows: MarksSheetRow[];
}
export interface SubjectResult {
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string | null;
  gradePoint: number | null;
  isAbsent: boolean;
  isPassing: boolean;
}
export interface StudentExamResult {
  studentId: string;
  studentProfileId: string;
  rollNumber: string | null;
  name: string;
  subjects: SubjectResult[];
  maxMarks: number;
  obtainedMarks: number;
  percentage: number;
  gpa: number | null;
  resultStatus: ResultStatus;
  rank: number | null;
}
export interface ReportCard {
  id: string;
  academicYearId: string;
  examTermId: string | null;
  name: I18nText;
  gradingSchemeId: string | null;
  includeAttendance: boolean;
  includeCoScholastic: boolean;
  includeTopicWise: boolean;
  status: ReportCardStatus;
}
export interface ReportCardInstance {
  id: string;
  reportCardId: string;
  studentProfileId: string;
  sectionId: string | null;
  status: ReportCardStatus;
  percentage: number | null;
  gpa: number | null;
  grade: string | null;
  rank: number | null;
  attendancePercent: number | null;
  resultStatus: ResultStatus;
  classTeacherRemark: string | null;
  principalRemark: string | null;
  payload: ReportCardPayload;
}
export interface ReportCardPayload {
  termName: string | null;
  student: { name: string; rollNumber: string | null };
  subjects: Array<{
    subjectId: string;
    subjectName: string;
    percentage: number;
    grade: string | null;
    gradePoint: number | null;
    isAbsent: boolean;
    exams: Array<{ examName: string; percentage: number; weight: number }>;
    topics: Array<{ name: string; competency: string; descriptor: string | null }>;
  }>;
  coScholastic: Array<{ area: string; grade: string; descriptor: string | null }>;
}
export interface SubjectRef {
  id: string;
  name: I18nText;
}
export interface SubjectTopic {
  id: string;
  subjectId: string;
  standardId: string | null;
  name: I18nText;
  code: string | null;
  learningOutcome: string | null;
  sequence: number;
}
export interface CoScholasticArea {
  id: string;
  name: I18nText;
  gradingSchemeId: string | null;
  sequence: number;
}

// ── Input shapes ──────────────────────────────────────────────────────────────

export interface GradeBandInput {
  grade: string;
  minPercent?: number | null;
  maxPercent?: number | null;
  gradePoint?: number | null;
  descriptor?: string | null;
  isPassing?: boolean;
  sequence?: number;
}
export interface CreateExamInput {
  academicYearId: string;
  examTermId?: string | null;
  name: I18nText;
  type: ExamType;
  gradingSchemeId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  weightInTerm?: number;
  description?: string | null;
}
export interface ExamMarkInput {
  examScheduleId: string;
  studentId: string;
  obtainedMarks?: number | null;
  isAbsent?: boolean;
  isExempted?: boolean;
  remarks?: string | null;
}
// Update can't move a paper to another subject/section — those stay fixed on edit.
export interface UpdateExamScheduleInput {
  component?: AssessmentComponent;
  examDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  maxMarks?: number;
  passMarks?: number | null;
  room?: string | null;
  invigilatorId?: string | null;
}

// ── Documents ───────────────────────────────────────────────────────────────

const GRADING_SCHEMES = gql`
  query GradingSchemes($kind: String) {
    gradingSchemes(kind: $kind) { id name kind board isDefault }
  }
`;
const GRADING_SCHEME = gql`
  query GradingScheme($id: ID!) {
    gradingScheme(id: $id) {
      id name kind board isDefault
      bands { id grade minPercent maxPercent gradePoint descriptor isPassing sequence }
    }
  }
`;
const CREATE_GRADING_SCHEME = gql`
  mutation CreateGradingScheme($input: CreateGradingSchemeInput!) {
    createGradingScheme(input: $input) { id }
  }
`;
const REPLACE_GRADE_BANDS = gql`
  mutation ReplaceGradeBands($input: ReplaceGradeBandsInput!) {
    replaceGradeBands(input: $input) { id grade }
  }
`;
const DELETE_GRADING_SCHEME = gql`
  mutation DeleteGradingScheme($id: ID!) { deleteGradingScheme(id: $id) }
`;

const EXAM_TERMS = gql`
  query ExamTerms($academicYearId: ID!) {
    examTerms(academicYearId: $academicYearId) { id academicYearId name sequence weightInFinal }
  }
`;
const CREATE_EXAM_TERM = gql`
  mutation CreateExamTerm($input: CreateExamTermInput!) {
    createExamTerm(input: $input) { id }
  }
`;

const EXAM_FIELDS = `id academicYearId examTermId name type gradingSchemeId status startDate endDate weightInTerm description`;
const EXAMS_LIST = gql`
  query ExamsList($academicYearId: ID!, $examTermId: ID, $status: ExamStatus, $search: String, $page: Int, $perPage: Int) {
    examsList(academicYearId: $academicYearId, examTermId: $examTermId, status: $status, search: $search, page: $page, perPage: $perPage) {
      docs { ${EXAM_FIELDS} }
      total page perPage totalPages
    }
  }
`;
const EXAM = gql`query Exam($id: ID!) { exam(id: $id) { ${EXAM_FIELDS} } }`;
const CREATE_EXAM = gql`mutation CreateExam($input: CreateExamInput!) { createExam(input: $input) { id } }`;
const UPDATE_EXAM = gql`mutation UpdateExam($id: ID!, $input: UpdateExamInput!) { updateExam(id: $id, input: $input) { id } }`;
const SCHEDULE_EXAM = gql`mutation ScheduleExam($id: ID!) { scheduleExam(id: $id) { id status } }`;
const OPEN_MARKS_ENTRY = gql`mutation OpenExamMarksEntry($id: ID!) { openExamMarksEntry(id: $id) { id status } }`;
const LOCK_EXAM = gql`mutation LockExam($id: ID!) { lockExam(id: $id) { id status } }`;
const PUBLISH_RESULTS = gql`mutation PublishExamResults($id: ID!) { publishExamResults(id: $id) { id status } }`;
const ARCHIVE_EXAM = gql`mutation ArchiveExam($id: ID!) { archiveExam(id: $id) { id status } }`;
const UNARCHIVE_EXAM = gql`mutation UnarchiveExam($id: ID!) { unarchiveExam(id: $id) { id status } }`;
const DELETE_EXAM = gql`mutation DeleteExam($id: ID!) { deleteExam(id: $id) }`;

const SCHEDULE_FIELDS = `id examId sectionId subjectId component examDate startTime endTime maxMarks passMarks room invigilatorId`;
const EXAM_DATESHEET = gql`query ExamDatesheet($examId: ID!) { examDatesheet(examId: $examId) { ${SCHEDULE_FIELDS} } }`;
const ADD_EXAM_SCHEDULE = gql`mutation AddExamSchedule($input: CreateExamScheduleInput!) { addExamSchedule(input: $input) { id } }`;
const UPDATE_EXAM_SCHEDULE = gql`mutation UpdateExamSchedule($id: ID!, $input: UpdateExamScheduleInput!) { updateExamSchedule(id: $id, input: $input) { id } }`;
const REMOVE_EXAM_SCHEDULE = gql`mutation RemoveExamSchedule($id: ID!) { removeExamSchedule(id: $id) }`;
const EXAM_DATESHEET_PDF = gql`query ExamDatesheetPdf($examId: ID!) { examDatesheetPdf(examId: $examId) }`;

const EXAM_MARKS_SHEET = gql`
  query ExamMarksSheet($examScheduleId: ID!) {
    examMarksSheet(examScheduleId: $examScheduleId) {
      schedule { ${SCHEDULE_FIELDS} }
      rows { studentId studentProfileId rollNumber name obtainedMarks isAbsent isExempted remarks }
    }
  }
`;
const ENTER_EXAM_MARKS = gql`mutation EnterExamMarks($input: EnterMarksInput!) { enterExamMarks(input: $input) }`;

const EXAM_RESULTS = gql`
  query ExamResults($examId: ID!, $sectionId: ID!) {
    examResults(examId: $examId, sectionId: $sectionId) {
      studentId studentProfileId rollNumber name maxMarks obtainedMarks percentage gpa resultStatus rank
      subjects { subjectId subjectName maxMarks obtainedMarks percentage grade gradePoint isAbsent isPassing }
    }
  }
`;

const REPORT_CARD_FIELDS = `id academicYearId examTermId name gradingSchemeId includeAttendance includeCoScholastic includeTopicWise status`;
const REPORT_CARDS = gql`query ReportCards($academicYearId: ID!) { reportCards(academicYearId: $academicYearId) { ${REPORT_CARD_FIELDS} } }`;
const CREATE_REPORT_CARD = gql`mutation CreateReportCard($input: CreateReportCardInput!) { createReportCard(input: $input) { id } }`;
const GENERATE_REPORT_CARDS = gql`mutation GenerateReportCards($reportCardId: ID!, $sectionId: ID!) { generateReportCards(reportCardId: $reportCardId, sectionId: $sectionId) }`;
const PUBLISH_REPORT_CARDS = gql`mutation PublishReportCards($reportCardId: ID!) { publishReportCards(reportCardId: $reportCardId) }`;

const INSTANCE_FIELDS = `
  id reportCardId studentProfileId sectionId status percentage gpa grade rank attendancePercent resultStatus classTeacherRemark principalRemark
  payload {
    termName
    student { name rollNumber }
    subjects { subjectId subjectName percentage grade gradePoint isAbsent exams { examName percentage weight } topics { name competency descriptor } }
    coScholastic { area grade descriptor }
  }
`;
const REPORT_CARD_INSTANCES = gql`query ReportCardInstances($reportCardId: ID!) { reportCardInstances(reportCardId: $reportCardId) { ${INSTANCE_FIELDS} } }`;
const REPORT_CARD_INSTANCE = gql`query ReportCardInstance($reportCardId: ID!, $studentProfileId: ID!) { reportCardInstance(reportCardId: $reportCardId, studentProfileId: $studentProfileId) { ${INSTANCE_FIELDS} } }`;
const MY_REPORT_CARDS = gql`query MyReportCards { myReportCards { ${INSTANCE_FIELDS} } }`;
const REPORT_CARD_PDF = gql`query ReportCardPdf($instanceId: ID!) { reportCardPdf(instanceId: $instanceId) }`;

const SUBJECTS = gql`query Subjects { subjects { id name } }`;
const SUBJECT_TOPICS = gql`query SubjectTopics($subjectId: ID!, $standardId: ID) { subjectTopics(subjectId: $subjectId, standardId: $standardId) { id subjectId standardId name code learningOutcome sequence } }`;
const CREATE_SUBJECT_TOPIC = gql`mutation CreateSubjectTopic($input: CreateSubjectTopicInput!) { createSubjectTopic(input: $input) { id } }`;
const CO_SCHOLASTIC_AREAS = gql`query CoScholasticAreas { coScholasticAreas { id name gradingSchemeId sequence } }`;
const CREATE_CO_SCHOLASTIC_AREA = gql`mutation CreateCoScholasticArea($input: CreateCoScholasticAreaInput!) { createCoScholasticArea(input: $input) { id } }`;
const ENTER_TOPIC_ASSESSMENTS = gql`mutation EnterTopicAssessments($input: EnterTopicAssessmentsInput!) { enterTopicAssessments(input: $input) }`;
const ENTER_CO_SCHOLASTIC = gql`mutation EnterCoScholasticAssessments($input: EnterCoScholasticInput!) { enterCoScholasticAssessments(input: $input) }`;

// ── Query hooks ─────────────────────────────────────────────────────────────

export function useGradingSchemes(kind?: GradingSchemeKind) {
  const { data, loading, refetch } = useQuery<{ gradingSchemes: GradingScheme[] }>(
    GRADING_SCHEMES,
    {
      variables: { kind: kind ?? null },
    },
  );
  return { schemes: data?.gradingSchemes ?? [], loading, refetch };
}
export function useGradingScheme(id: string | null) {
  const { data, loading, refetch } = useQuery<{ gradingScheme: GradingScheme }>(GRADING_SCHEME, {
    variables: { id },
    skip: !id,
  });
  return { scheme: data?.gradingScheme ?? null, loading, refetch };
}
export function useExamTerms(academicYearId: string | null) {
  const { data, loading, refetch } = useQuery<{ examTerms: ExamTerm[] }>(EXAM_TERMS, {
    variables: { academicYearId },
    skip: !academicYearId,
  });
  return { terms: data?.examTerms ?? [], loading, refetch };
}
export function useExams(
  academicYearId: string | null,
  opts: {
    examTermId?: string | null;
    status?: ExamStatus | null;
    search?: string | null;
    page?: number;
    perPage?: number;
  } = {},
) {
  const { data, loading, error, refetch } = useQuery<{ examsList: PaginatedExams }>(EXAMS_LIST, {
    variables: {
      academicYearId,
      examTermId: opts.examTermId ?? null,
      status: opts.status ?? null,
      search: opts.search ?? null,
      page: opts.page ?? 1,
      perPage: opts.perPage ?? 20,
    },
    skip: !academicYearId,
    notifyOnNetworkStatusChange: true,
  });
  return {
    exams: data?.examsList.docs ?? [],
    total: data?.examsList.total ?? 0,
    totalPages: data?.examsList.totalPages ?? 1,
    loading,
    error,
    refetch,
  };
}
export function useExam(id: string | null) {
  const { data, loading, refetch } = useQuery<{ exam: Exam }>(EXAM, {
    variables: { id },
    skip: !id,
  });
  return { exam: data?.exam ?? null, loading, refetch };
}
export function useExamDatesheet(examId: string | null) {
  const { data, loading, refetch } = useQuery<{ examDatesheet: ExamSchedule[] }>(EXAM_DATESHEET, {
    variables: { examId },
    skip: !examId,
  });
  return { schedules: data?.examDatesheet ?? [], loading, refetch };
}
export function useExamMarksSheet(examScheduleId: string | null) {
  const { data, loading, refetch } = useQuery<{ examMarksSheet: MarksSheet }>(EXAM_MARKS_SHEET, {
    variables: { examScheduleId },
    skip: !examScheduleId,
  });
  return { sheet: data?.examMarksSheet ?? null, loading, refetch };
}
export function useExamResults(examId: string | null, sectionId: string | null) {
  const { data, loading, refetch } = useQuery<{ examResults: StudentExamResult[] }>(EXAM_RESULTS, {
    variables: { examId, sectionId },
    skip: !examId || !sectionId,
  });
  return { results: data?.examResults ?? [], loading, refetch };
}
export function useReportCards(academicYearId: string | null) {
  const { data, loading, refetch } = useQuery<{ reportCards: ReportCard[] }>(REPORT_CARDS, {
    variables: { academicYearId },
    skip: !academicYearId,
  });
  return { reportCards: data?.reportCards ?? [], loading, refetch };
}
export function useReportCardInstances(reportCardId: string | null) {
  const { data, loading, refetch } = useQuery<{ reportCardInstances: ReportCardInstance[] }>(
    REPORT_CARD_INSTANCES,
    { variables: { reportCardId }, skip: !reportCardId },
  );
  return { instances: data?.reportCardInstances ?? [], loading, refetch };
}
export function useReportCardInstance(
  reportCardId: string | null,
  studentProfileId: string | null,
) {
  const { data, loading } = useQuery<{ reportCardInstance: ReportCardInstance }>(
    REPORT_CARD_INSTANCE,
    { variables: { reportCardId, studentProfileId }, skip: !reportCardId || !studentProfileId },
  );
  return { instance: data?.reportCardInstance ?? null, loading };
}
export function useMyReportCards() {
  const { data, loading } = useQuery<{ myReportCards: ReportCardInstance[] }>(MY_REPORT_CARDS);
  return { instances: data?.myReportCards ?? [], loading };
}
export function useAllSubjects() {
  const { data, loading } = useQuery<{ subjects: SubjectRef[] }>(SUBJECTS);
  return { subjects: data?.subjects ?? [], loading };
}
export function useSubjectTopics(subjectId: string | null, standardId?: string | null) {
  const { data, loading, refetch } = useQuery<{ subjectTopics: SubjectTopic[] }>(SUBJECT_TOPICS, {
    variables: { subjectId, standardId: standardId ?? null },
    skip: !subjectId,
  });
  return { topics: data?.subjectTopics ?? [], loading, refetch };
}
export function useCoScholasticAreas() {
  const { data, loading, refetch } = useQuery<{ coScholasticAreas: CoScholasticArea[] }>(
    CO_SCHOLASTIC_AREAS,
  );
  return { areas: data?.coScholasticAreas ?? [], loading, refetch };
}
export function useReportCardPdf() {
  return useLazyQuery<{ reportCardPdf: string }, { instanceId: string }>(REPORT_CARD_PDF);
}
export function useExamDatesheetPdf() {
  return useLazyQuery<{ examDatesheetPdf: string }, { examId: string }>(EXAM_DATESHEET_PDF);
}

// ── Mutation hooks ──────────────────────────────────────────────────────────

export function useCreateGradingScheme() {
  const [mutate, { loading }] = useMutation(CREATE_GRADING_SCHEME, {
    refetchQueries: ['GradingSchemes'],
  });
  return { createScheme: (input: unknown) => mutate({ variables: { input } }), loading };
}
export function useReplaceGradeBands() {
  const [mutate, { loading }] = useMutation(REPLACE_GRADE_BANDS, {
    refetchQueries: ['GradingScheme'],
  });
  return {
    replaceBands: (gradingSchemeId: string, bands: GradeBandInput[]) =>
      mutate({ variables: { input: { gradingSchemeId, bands } } }),
    loading,
  };
}
export function useDeleteGradingScheme() {
  const [mutate, { loading }] = useMutation(DELETE_GRADING_SCHEME, {
    refetchQueries: ['GradingSchemes'],
  });
  return { deleteScheme: (id: string) => mutate({ variables: { id } }), loading };
}
export function useCreateExamTerm() {
  const [mutate, { loading }] = useMutation(CREATE_EXAM_TERM, { refetchQueries: ['ExamTerms'] });
  return { createTerm: (input: unknown) => mutate({ variables: { input } }), loading };
}
export function useCreateExam() {
  const [mutate, { loading }] = useMutation(CREATE_EXAM, { refetchQueries: ['ExamsList'] });
  return { createExam: (input: CreateExamInput) => mutate({ variables: { input } }), loading };
}
export function useUpdateExam() {
  const [mutate, { loading }] = useMutation(UPDATE_EXAM, { refetchQueries: ['ExamsList', 'Exam'] });
  return {
    updateExam: (id: string, input: unknown) => mutate({ variables: { id, input } }),
    loading,
  };
}
export function useExamLifecycle() {
  const refetchQueries = ['ExamsList', 'Exam'];
  const [schedule] = useMutation(SCHEDULE_EXAM, { refetchQueries });
  const [openMarks] = useMutation(OPEN_MARKS_ENTRY, { refetchQueries });
  const [lock] = useMutation(LOCK_EXAM, { refetchQueries });
  const [publish] = useMutation(PUBLISH_RESULTS, { refetchQueries });
  const [archive] = useMutation(ARCHIVE_EXAM, { refetchQueries });
  return {
    schedule: (id: string) => schedule({ variables: { id } }),
    openMarksEntry: (id: string) => openMarks({ variables: { id } }),
    lock: (id: string) => lock({ variables: { id } }),
    publishResults: (id: string) => publish({ variables: { id } }),
    archive: (id: string) => archive({ variables: { id } }),
  };
}
export function useUnarchiveExam() {
  const [mutate, { loading }] = useMutation(UNARCHIVE_EXAM, {
    refetchQueries: ['ExamsList', 'Exam'],
  });
  return { unarchive: (id: string) => mutate({ variables: { id } }), loading };
}
export function useDeleteExam() {
  const [mutate, { loading }] = useMutation(DELETE_EXAM, { refetchQueries: ['ExamsList'] });
  return { deleteExam: (id: string) => mutate({ variables: { id } }), loading };
}
export function useAddExamSchedule() {
  const [mutate, { loading }] = useMutation(ADD_EXAM_SCHEDULE, {
    refetchQueries: ['ExamDatesheet'],
  });
  return { addSchedule: (input: unknown) => mutate({ variables: { input } }), loading };
}
export function useUpdateExamSchedule() {
  const [mutate, { loading }] = useMutation(UPDATE_EXAM_SCHEDULE, {
    refetchQueries: ['ExamDatesheet'],
  });
  return {
    updateSchedule: (id: string, input: UpdateExamScheduleInput) =>
      mutate({ variables: { id, input } }),
    loading,
  };
}
export function useRemoveExamSchedule() {
  const [mutate, { loading }] = useMutation(REMOVE_EXAM_SCHEDULE, {
    refetchQueries: ['ExamDatesheet'],
  });
  return { removeSchedule: (id: string) => mutate({ variables: { id } }), loading };
}
export function useEnterExamMarks() {
  const [mutate, { loading }] = useMutation(ENTER_EXAM_MARKS, {
    refetchQueries: ['ExamMarksSheet'],
  });
  return {
    enterMarks: (examId: string, marks: ExamMarkInput[]) =>
      mutate({ variables: { input: { examId, marks } } }),
    loading,
  };
}
export function useCreateReportCard() {
  const [mutate, { loading }] = useMutation(CREATE_REPORT_CARD, {
    refetchQueries: ['ReportCards'],
  });
  return { createReportCard: (input: unknown) => mutate({ variables: { input } }), loading };
}
export function useGenerateReportCards() {
  const [mutate, { loading }] = useMutation(GENERATE_REPORT_CARDS, {
    refetchQueries: ['ReportCards', 'ReportCardInstances'],
  });
  return {
    generate: (reportCardId: string, sectionId: string) =>
      mutate({ variables: { reportCardId, sectionId } }),
    loading,
  };
}
export function usePublishReportCards() {
  const [mutate, { loading }] = useMutation(PUBLISH_REPORT_CARDS, {
    refetchQueries: ['ReportCards', 'ReportCardInstances'],
  });
  return { publish: (reportCardId: string) => mutate({ variables: { reportCardId } }), loading };
}
export function useCreateSubjectTopic() {
  const [mutate, { loading }] = useMutation(CREATE_SUBJECT_TOPIC, {
    refetchQueries: ['SubjectTopics'],
  });
  return { createTopic: (input: unknown) => mutate({ variables: { input } }), loading };
}
export function useCreateCoScholasticArea() {
  const [mutate, { loading }] = useMutation(CREATE_CO_SCHOLASTIC_AREA, {
    refetchQueries: ['CoScholasticAreas'],
  });
  return { createArea: (input: unknown) => mutate({ variables: { input } }), loading };
}
export function useEnterTopicAssessments() {
  const [mutate, { loading }] = useMutation(ENTER_TOPIC_ASSESSMENTS);
  return {
    enter: (assessments: unknown[]) => mutate({ variables: { input: { assessments } } }),
    loading,
  };
}
export function useEnterCoScholastic() {
  const [mutate, { loading }] = useMutation(ENTER_CO_SCHOLASTIC);
  return {
    enter: (assessments: unknown[]) => mutate({ variables: { input: { assessments } } }),
    loading,
  };
}
