/**
 * ROV-293: every exam, term, datesheet, marks, grading, topic and co-scholastic operation that
 * takes an id refuses a row of another institute, returns none of its data and stores no
 * reference to it.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import { TemporalClientService } from '@roviq/temporal';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { Connection } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests, pdfWithoutStamp } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';
import { ExaminationDrizzleRepository } from '../repositories/examination.drizzle-repository';
import {
  type ExamFixture,
  examSnapshot,
  fixtureIds,
  setUpExamFixture,
} from './examination-foreign-id.fixture';

const unique = (label: string) => ({ en: `${label} ${randomUUID().slice(0, 8)}` });

const GRADING_SCHEME = 'query ($id: ID!) { gradingScheme(id: $id) { id } }';
const UPDATE_SCHEME =
  'mutation ($id: ID!) { updateGradingScheme(id: $id, input: { board: "CBSE" }) { id } }';
const REPLACE_BANDS = /* GraphQL */ `
  mutation ($id: ID!) {
    replaceGradeBands(
      input: { gradingSchemeId: $id, bands: [{ grade: "A", minPercent: 0, maxPercent: 100 }] }
    ) {
      id
    }
  }
`;
const DELETE_SCHEME = 'mutation ($id: ID!) { deleteGradingScheme(id: $id) }';
const EXAM_TERMS = 'query ($yearId: ID!) { examTerms(academicYearId: $yearId) { id } }';
const CREATE_TERM =
  'mutation ($input: CreateExamTermInput!) { createExamTerm(input: $input) { id } }';
const UPDATE_TERM =
  'mutation ($id: ID!) { updateExamTerm(id: $id, input: { sequence: 3 }) { id } }';
const DELETE_TERM = 'mutation ($id: ID!) { deleteExamTerm(id: $id) }';
const EXAMS_LIST = /* GraphQL */ `
  query ($yearId: ID!, $termId: ID, $sectionId: ID) {
    examsList(academicYearId: $yearId, examTermId: $termId, sectionId: $sectionId) {
      total
      docs {
        id
      }
    }
  }
`;
const EXAM = 'query ($id: ID!) { exam(id: $id) { id } }';
const CREATE_EXAM = 'mutation ($input: CreateExamInput!) { createExam(input: $input) { id } }';
const UPDATE_EXAM =
  'mutation ($id: ID!, $input: UpdateExamInput!) { updateExam(id: $id, input: $input) { id } }';
const byId = (operation: string) => `mutation ($id: ID!) { ${operation}(id: $id) { id } }`;
const DELETE_EXAM = 'mutation ($id: ID!) { deleteExam(id: $id) }';
const DATESHEET = 'query ($examId: ID!) { examDatesheet(examId: $examId) { id } }';
const DATESHEET_PDF = /* GraphQL */ `
  query ($examId: ID!, $sectionId: ID, $staffId: ID) {
    examDatesheetPdf(examId: $examId, sectionId: $sectionId, staffId: $staffId)
  }
`;
const ADD_SCHEDULE =
  'mutation ($input: CreateExamScheduleInput!) { addExamSchedule(input: $input) { id } }';
const UPDATE_SCHEDULE = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateExamScheduleInput!) {
    updateExamSchedule(id: $id, input: $input) {
      id
    }
  }
`;
const REMOVE_SCHEDULE = 'mutation ($id: ID!) { removeExamSchedule(id: $id) }';
const MARKS_SHEET = /* GraphQL */ `
  query ($id: ID!) {
    examMarksSheet(examScheduleId: $id) {
      rows {
        studentId
        obtainedMarks
      }
    }
  }
`;
const ENTER_MARKS = 'mutation ($input: EnterMarksInput!) { enterExamMarks(input: $input) }';
const RESULTS = /* GraphQL */ `
  query ($examId: ID!, $sectionId: ID!) {
    examResults(examId: $examId, sectionId: $sectionId) {
      studentId
      obtainedMarks
    }
  }
`;
const SUBJECT_TOPICS = /* GraphQL */ `
  query ($subjectId: ID!, $standardId: ID) {
    subjectTopics(subjectId: $subjectId, standardId: $standardId) {
      id
    }
  }
`;
const CREATE_TOPIC =
  'mutation ($input: CreateSubjectTopicInput!) { createSubjectTopic(input: $input) { id } }';
const DELETE_TOPIC = 'mutation ($id: ID!) { deleteSubjectTopic(id: $id) }';
const ENTER_TOPICS =
  'mutation ($input: EnterTopicAssessmentsInput!) { enterTopicAssessments(input: $input) }';
const CREATE_AREA =
  'mutation ($input: CreateCoScholasticAreaInput!) { createCoScholasticArea(input: $input) { id } }';
const DELETE_AREA = 'mutation ($id: ID!) { deleteCoScholasticArea(id: $id) }';
const ENTER_CO =
  'mutation ($input: EnterCoScholasticInput!) { enterCoScholasticAssessments(input: $input) }';

describe('examination: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: ExamFixture;
  let b: ExamFixture;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [instB, b],
    specFile: __filename,
    normalize: { examDatesheetPdf: pdfWithoutStamp },
  });
  const storage = new FakeStorageClient();

  const snapshot = () =>
    examSnapshot(result.db, [instA.tenantId, instB.tenantId], fixtureIds(b), [
      instA.userId,
      instB.userId,
    ]);

  const query = async <T>(source: string, variables: Record<string, unknown>) => {
    const res = await request<T>({ query: source, variables, token: tokenA });
    expect(res.errors).toBeUndefined();
    return res.data;
  };

  const refusesAndWritesNothing = async (
    source: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const put = vi.spyOn(storage, 'put');
    const connect = vi
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal must not be reached'));
    const startWorkflow = vi
      .spyOn(TemporalClientService.prototype, 'startWorkflow')
      .mockRejectedValue(new Error('No workflow may start'));

    const res = await request({ query: source, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
  };

  const ids = (rows: ReadonlyArray<{ id: string }> | undefined) =>
    rows?.map((row) => row.id).sort();

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: StorageClient, useValue: storage }],
    });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    a = await setUpExamFixture(result.db, instA);
    b = await setUpExamFixture(result.db, instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('grading schemes', () => {
    it('gradingScheme should refuse a scheme of another institute', async () => {
      await refusesAndWritesNothing(
        GRADING_SCHEME,
        { id: b.schemeId },
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      );
    });

    it('updateGradingScheme should refuse a scheme of another institute', async () => {
      await refusesAndWritesNothing(
        UPDATE_SCHEME,
        { id: b.schemeId },
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      );
    });

    it('replaceGradeBands should refuse a scheme of another institute', async () => {
      await refusesAndWritesNothing(
        REPLACE_BANDS,
        { id: b.schemeId },
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      );
    });

    it('deleteGradingScheme should refuse a scheme of another institute', async () => {
      await refusesAndWritesNothing(DELETE_SCHEME, { id: b.spareSchemeId }, ErrorCode.NOT_FOUND);
    });
  });

  describe('exam terms', () => {
    it('examTerms should list its own year and nothing of another institute', async () => {
      const own = await query<{ examTerms: { id: string }[] }>(EXAM_TERMS, { yearId: a.yearId });

      expect(ids(own?.examTerms)).toEqual([a.termId, a.spareTermId].sort());
      expect(await query(EXAM_TERMS, { yearId: b.yearId })).toEqual({ examTerms: [] });
    });

    it('createExamTerm should create a term in its own year', async () => {
      const data = await query<{ createExamTerm: { id: string } }>(CREATE_TERM, {
        input: { academicYearId: a.yearId, name: unique('Term') },
      });

      expect(data?.createExamTerm.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('createExamTerm should refuse a year of another institute', async () => {
      await refusesAndWritesNothing(
        CREATE_TERM,
        { input: { academicYearId: b.yearId, name: unique('Term') } },
        ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
      );
    });

    it('updateExamTerm should refuse a term of another institute', async () => {
      await refusesAndWritesNothing(UPDATE_TERM, { id: b.termId }, ErrorCode.EXAM_TERM_NOT_FOUND);
    });

    it('deleteExamTerm should refuse a term of another institute', async () => {
      await refusesAndWritesNothing(DELETE_TERM, { id: b.spareTermId }, ErrorCode.NOT_FOUND);
    });
  });

  describe('exams', () => {
    it('examsList should list its own year, term and section and nothing of another institute', async () => {
      type Page = { examsList: { total: number; docs: { id: string }[] } };
      const empty = { examsList: { total: 0, docs: [] } };

      const byTerm = await query<Page>(EXAMS_LIST, { yearId: a.yearId, termId: a.termId });
      const bySection = await query<Page>(EXAMS_LIST, {
        yearId: a.yearId,
        sectionId: a.sectionId,
      });

      expect(ids(byTerm?.examsList.docs)).toEqual(
        [
          a.marksExamId,
          a.draftExamId,
          a.scheduledExamId,
          a.lockedExamId,
          a.publishedExamId,
          a.archivedExamId,
          a.spareExamId,
        ].sort(),
      );
      expect(ids(bySection?.examsList.docs)).toEqual([a.marksExamId]);
      expect(await query(EXAMS_LIST, { yearId: b.yearId })).toEqual(empty);
      expect(await query(EXAMS_LIST, { yearId: a.yearId, termId: b.termId })).toEqual(empty);
      expect(await query(EXAMS_LIST, { yearId: a.yearId, sectionId: b.sectionId })).toEqual(empty);
    });

    it('exam should refuse an exam of another institute', async () => {
      await refusesAndWritesNothing(EXAM, { id: b.marksExamId }, ErrorCode.EXAM_NOT_FOUND);
    });

    it('createExam should create an exam with its own year, term and scheme', async () => {
      const data = await query<{ createExam: { id: string } }>(CREATE_EXAM, {
        input: {
          academicYearId: a.yearId,
          examTermId: a.termId,
          gradingSchemeId: a.schemeId,
          name: unique('Exam'),
          type: 'UNIT_TEST',
        },
      });

      expect(data?.createExam.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it.each([
      ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
      [
        'examTermId',
        () => ({ academicYearId: a.yearId, examTermId: b.termId }),
        ErrorCode.EXAM_TERM_NOT_FOUND,
      ],
      [
        'gradingSchemeId',
        () => ({ academicYearId: a.yearId, gradingSchemeId: b.schemeId }),
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      ],
    ] as const)('createExam should refuse %s of another institute and store nothing', async (_field, refs, code) => {
      await refusesAndWritesNothing(
        CREATE_EXAM,
        { input: { ...refs(), name: unique('Exam'), type: 'UNIT_TEST' } },
        code,
      );
    });

    it('updateExam should set its own term and scheme', async () => {
      const data = await query<{ updateExam: { id: string } }>(UPDATE_EXAM, {
        id: a.spareExamId,
        input: { examTermId: a.spareTermId, gradingSchemeId: a.schemeId },
      });

      expect(data?.updateExam.id).toBe(a.spareExamId);
    });

    it.each([
      ['id', () => ({ id: b.draftExamId, input: { description: 'x' } }), ErrorCode.EXAM_NOT_FOUND],
      [
        'examTermId',
        () => ({ id: a.draftExamId, input: { examTermId: b.termId } }),
        ErrorCode.EXAM_TERM_NOT_FOUND,
      ],
      [
        'gradingSchemeId',
        () => ({ id: a.draftExamId, input: { gradingSchemeId: b.schemeId } }),
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      ],
    ] as const)('updateExam should refuse %s of another institute and change nothing', async (_field, variables, code) => {
      await refusesAndWritesNothing(UPDATE_EXAM, variables(), code);
    });

    it.each([
      ['scheduleExam', (f: ExamFixture) => f.draftExamId],
      ['openExamMarksEntry', (f: ExamFixture) => f.scheduledExamId],
      ['lockExam', (f: ExamFixture) => f.marksExamId],
      ['publishExamResults', (f: ExamFixture) => f.lockedExamId],
      ['archiveExam', (f: ExamFixture) => f.publishedExamId],
      ['unarchiveExam', (f: ExamFixture) => f.archivedExamId],
      ['restoreExam', (f: ExamFixture) => f.deletedExamId],
    ] as const)('%s should refuse an exam of another institute and change nothing', async (operation, exam) => {
      await refusesAndWritesNothing(byId(operation), { id: exam(b) }, ErrorCode.EXAM_NOT_FOUND);
    });

    it('deleteExam should refuse an exam of another institute', async () => {
      await refusesAndWritesNothing(DELETE_EXAM, { id: b.spareExamId }, ErrorCode.NOT_FOUND);
    });
  });

  describe('datesheet', () => {
    it('examDatesheet should list its own exam and nothing of another institute', async () => {
      const own = await query<{ examDatesheet: { id: string }[] }>(DATESHEET, {
        examId: a.marksExamId,
      });

      expect(ids(own?.examDatesheet)).toEqual([a.marksScheduleId]);
      expect(await query(DATESHEET, { examId: b.marksExamId })).toEqual({ examDatesheet: [] });
    });

    it('examDatesheetPdf should refuse an exam of another institute', async () => {
      await refusesAndWritesNothing(
        DATESHEET_PDF,
        { examId: b.marksExamId },
        ErrorCode.EXAM_NOT_FOUND,
      );
    });

    it.each([
      ['sectionId', () => ({ sectionId: b.sectionId })],
      ['staffId', () => ({ staffId: b.teacherMembershipId })],
    ] as const)('examDatesheetPdf should print nothing for %s of another institute', async (_field, filter) => {
      const labels = vi.spyOn(ExaminationDrizzleRepository.prototype, 'resolveLabels');
      const before = await snapshot();

      const data = await query<{ examDatesheetPdf: string }>(DATESHEET_PDF, {
        examId: a.marksExamId,
        ...filter(),
      });

      expect(
        Buffer.from(data?.examDatesheetPdf ?? '', 'base64')
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
      // Printed twice: for the other institute's id and for an id of no row.
      expect(labels.mock.calls.map(([input]) => input)).toEqual([
        { subjectIds: [], sectionIds: [], studentMembershipIds: [], staffMembershipIds: [] },
        { subjectIds: [], sectionIds: [], studentMembershipIds: [], staffMembershipIds: [] },
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('addExamSchedule should add a row with its own exam, section, subject and invigilator', async () => {
      const data = await query<{ addExamSchedule: { id: string } }>(ADD_SCHEDULE, {
        input: {
          examId: a.draftExamId,
          sectionId: a.sectionId,
          subjectId: a.subjectId,
          component: 'PRACTICAL',
          maxMarks: 20,
          invigilatorId: a.teacherMembershipId,
        },
      });

      expect(data?.addExamSchedule.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it.each([
      [
        'examId',
        () => ({ examId: b.draftExamId, sectionId: a.sectionId, subjectId: a.subjectId }),
        ErrorCode.EXAM_NOT_FOUND,
      ],
      [
        'sectionId',
        () => ({ examId: a.draftExamId, sectionId: b.sectionId, subjectId: a.subjectId }),
        ErrorCode.SECTION_NOT_FOUND,
      ],
      [
        'subjectId',
        () => ({ examId: a.draftExamId, sectionId: a.sectionId, subjectId: b.subjectId }),
        ErrorCode.SUBJECT_NOT_FOUND,
      ],
      [
        'invigilatorId',
        () => ({
          examId: a.draftExamId,
          sectionId: a.otherSectionId,
          subjectId: a.subjectId,
          component: 'PROJECT',
          invigilatorId: b.teacherMembershipId,
        }),
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      ],
    ] as const)('addExamSchedule should refuse %s of another institute and store nothing', async (_field, refs, code) => {
      await refusesAndWritesNothing(
        ADD_SCHEDULE,
        { input: { component: 'THEORY', maxMarks: 50, ...refs() } },
        code,
      );
    });

    it('updateExamSchedule should refuse a row of another institute', async () => {
      await refusesAndWritesNothing(
        UPDATE_SCHEDULE,
        { id: b.spareScheduleId, input: { room: 'R9' } },
        ErrorCode.EXAM_NOT_FOUND,
      );
    });

    it('updateExamSchedule should refuse an invigilator of another institute', async () => {
      await refusesAndWritesNothing(
        UPDATE_SCHEDULE,
        { id: a.spareScheduleId, input: { invigilatorId: b.teacherMembershipId } },
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      );
    });

    it('removeExamSchedule should refuse a row of another institute', async () => {
      await refusesAndWritesNothing(
        REMOVE_SCHEDULE,
        { id: b.spareScheduleId },
        ErrorCode.NOT_FOUND,
      );
    });
  });

  describe('marks and results', () => {
    it('examMarksSheet should show its own row and refuse a row of another institute', async () => {
      expect(await query(MARKS_SHEET, { id: a.marksScheduleId })).toEqual({
        examMarksSheet: { rows: [{ studentId: a.student.membershipId, obtainedMarks: 80 }] },
      });
      await refusesAndWritesNothing(
        MARKS_SHEET,
        { id: b.marksScheduleId },
        ErrorCode.EXAM_NOT_FOUND,
      );
    });

    it('enterExamMarks should save a mark of its own student', async () => {
      const data = await query<{ enterExamMarks: number }>(ENTER_MARKS, {
        input: {
          examId: a.marksExamId,
          marks: [
            {
              examScheduleId: a.marksScheduleId,
              studentId: a.student.membershipId,
              obtainedMarks: 81,
            },
          ],
        },
      });

      expect(data?.enterExamMarks).toBe(1);
    });

    const mark = (examScheduleId: string, studentId: string) => ({
      examScheduleId,
      studentId,
      obtainedMarks: 40,
    });

    it.each([
      [
        'examId',
        () => ({ examId: b.marksExamId, marks: [mark(b.marksScheduleId, b.student.membershipId)] }),
        ErrorCode.EXAM_NOT_FOUND,
      ],
      [
        'marks[].examScheduleId',
        () => ({ examId: a.marksExamId, marks: [mark(b.marksScheduleId, a.student.membershipId)] }),
        ErrorCode.EXAM_INVALID_CONFIG,
      ],
      [
        'marks[].studentId',
        () => ({ examId: a.marksExamId, marks: [mark(a.marksScheduleId, b.student.membershipId)] }),
        ErrorCode.STUDENT_NOT_FOUND,
      ],
      [
        'marks[].studentId after its own',
        () => ({
          examId: a.marksExamId,
          marks: [
            mark(a.marksScheduleId, a.student.membershipId),
            mark(a.marksScheduleId, b.otherStudent.membershipId),
          ],
        }),
        ErrorCode.STUDENT_NOT_FOUND,
      ],
    ] as const)('enterExamMarks should refuse %s of another institute and store nothing', async (_field, input, code) => {
      await refusesAndWritesNothing(ENTER_MARKS, { input: input() }, code);
    });

    it('enterExamMarks should refuse its own student who does not sit the paper', async () => {
      await refusesAndWritesNothing(
        ENTER_MARKS,
        {
          input: {
            examId: a.marksExamId,
            marks: [mark(a.marksScheduleId, a.otherStudent.membershipId)],
          },
        },
        ErrorCode.STUDENT_NOT_FOUND,
      );
    });

    it('examResults should show its own section and nothing of another institute', async () => {
      const own = await query<{ examResults: { studentId: string }[] }>(RESULTS, {
        examId: a.marksExamId,
        sectionId: a.sectionId,
      });

      expect(own?.examResults.map((row) => row.studentId)).toEqual([a.student.membershipId]);
      expect(await query(RESULTS, { examId: a.marksExamId, sectionId: b.sectionId })).toEqual({
        examResults: [],
      });
      await refusesAndWritesNothing(
        RESULTS,
        { examId: b.marksExamId, sectionId: a.sectionId },
        ErrorCode.EXAM_NOT_FOUND,
      );
    });
  });

  describe('NEP topics', () => {
    it('subjectTopics should list its own subject and standard and nothing of another institute', async () => {
      const own = await query<{ subjectTopics: { id: string }[] }>(SUBJECT_TOPICS, {
        subjectId: a.subjectId,
        standardId: a.standardId,
      });

      expect(ids(own?.subjectTopics)).toEqual([a.topicId, a.spareTopicId].sort());
      expect(await query(SUBJECT_TOPICS, { subjectId: b.subjectId })).toEqual({
        subjectTopics: [],
      });
      expect(
        await query(SUBJECT_TOPICS, { subjectId: a.subjectId, standardId: b.standardId }),
      ).toEqual({ subjectTopics: [] });
    });

    it('createSubjectTopic should create a topic of its own subject and standard', async () => {
      const data = await query<{ createSubjectTopic: { id: string } }>(CREATE_TOPIC, {
        input: { subjectId: a.subjectId, standardId: a.standardId, name: unique('Topic') },
      });

      expect(data?.createSubjectTopic.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it.each([
      ['subjectId', () => ({ subjectId: b.subjectId }), ErrorCode.SUBJECT_NOT_FOUND],
      [
        'standardId',
        () => ({ subjectId: a.subjectId, standardId: b.standardId }),
        ErrorCode.STANDARD_NOT_FOUND,
      ],
    ] as const)('createSubjectTopic should refuse %s of another institute', async (_field, refs, code) => {
      await refusesAndWritesNothing(
        CREATE_TOPIC,
        { input: { ...refs(), name: unique('Topic') } },
        code,
      );
    });

    it('deleteSubjectTopic should refuse a topic of another institute', async () => {
      await refusesAndWritesNothing(DELETE_TOPIC, { id: b.spareTopicId }, ErrorCode.NOT_FOUND);
    });

    const topic = (examScheduleId: string, studentId: string, subjectTopicId: string) => ({
      examScheduleId,
      studentId,
      subjectTopicId,
      competencyLevel: 'ADVANCED',
    });

    it('enterTopicAssessments should save an assessment of its own student', async () => {
      const data = await query<{ enterTopicAssessments: number }>(ENTER_TOPICS, {
        input: {
          assessments: [topic(a.marksScheduleId, a.student.membershipId, a.spareTopicId)],
        },
      });

      expect(data?.enterTopicAssessments).toBe(1);
    });

    it.each([
      [
        'examScheduleId',
        () => [topic(b.marksScheduleId, a.student.membershipId, a.topicId)],
        ErrorCode.EXAM_SCHEDULE_NOT_FOUND,
      ],
      [
        'studentId',
        () => [topic(a.marksScheduleId, b.student.membershipId, a.topicId)],
        ErrorCode.STUDENT_NOT_FOUND,
      ],
      [
        'subjectTopicId',
        () => [topic(a.marksScheduleId, a.student.membershipId, b.topicId)],
        ErrorCode.NOT_FOUND,
      ],
      [
        'studentId after its own',
        () => [
          topic(a.marksScheduleId, a.student.membershipId, a.topicId),
          topic(a.marksScheduleId, b.otherStudent.membershipId, a.topicId),
        ],
        ErrorCode.STUDENT_NOT_FOUND,
      ],
      [
        'subjectTopicId after its own',
        () => [
          topic(a.marksScheduleId, a.student.membershipId, a.topicId),
          topic(a.marksScheduleId, a.student.membershipId, b.spareTopicId),
        ],
        ErrorCode.NOT_FOUND,
      ],
    ] as const)('enterTopicAssessments should refuse %s of another institute', async (_field, assessments, code) => {
      await refusesAndWritesNothing(ENTER_TOPICS, { input: { assessments: assessments() } }, code);
    });

    it('enterTopicAssessments should refuse its own student who does not sit the paper', async () => {
      await refusesAndWritesNothing(
        ENTER_TOPICS,
        {
          input: {
            assessments: [topic(a.marksScheduleId, a.otherStudent.membershipId, a.topicId)],
          },
        },
        ErrorCode.STUDENT_NOT_FOUND,
      );
    });
  });

  describe('co-scholastic', () => {
    it('createCoScholasticArea should create an area with its own scheme', async () => {
      const data = await query<{ createCoScholasticArea: { id: string } }>(CREATE_AREA, {
        input: { name: unique('Area'), gradingSchemeId: a.coSchemeId },
      });

      expect(data?.createCoScholasticArea.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('createCoScholasticArea should refuse a scheme of another institute', async () => {
      await refusesAndWritesNothing(
        CREATE_AREA,
        { input: { name: unique('Area'), gradingSchemeId: b.coSchemeId } },
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      );
    });

    it('deleteCoScholasticArea should refuse an area of another institute', async () => {
      await refusesAndWritesNothing(DELETE_AREA, { id: b.spareAreaId }, ErrorCode.NOT_FOUND);
    });

    const grade = (coScholasticAreaId: string, studentId: string, examTermId: string) => ({
      coScholasticAreaId,
      studentId,
      examTermId,
      grade: 'B',
    });

    it('enterCoScholasticAssessments should save a grade of its own student', async () => {
      const data = await query<{ enterCoScholasticAssessments: number }>(ENTER_CO, {
        input: { assessments: [grade(a.spareAreaId, a.student.membershipId, a.termId)] },
      });

      expect(data?.enterCoScholasticAssessments).toBe(1);
    });

    it.each([
      [
        'coScholasticAreaId',
        () => [grade(b.areaId, a.student.membershipId, a.termId)],
        ErrorCode.NOT_FOUND,
      ],
      [
        'studentId',
        () => [grade(a.areaId, b.student.membershipId, a.termId)],
        ErrorCode.STUDENT_NOT_FOUND,
      ],
      [
        'examTermId',
        () => [grade(a.areaId, a.student.membershipId, b.termId)],
        ErrorCode.EXAM_TERM_NOT_FOUND,
      ],
      [
        'studentId after its own',
        () => [
          grade(a.areaId, a.student.membershipId, a.termId),
          grade(a.areaId, b.otherStudent.membershipId, a.termId),
        ],
        ErrorCode.STUDENT_NOT_FOUND,
      ],
    ] as const)('enterCoScholasticAssessments should refuse %s of another institute', async (_field, assessments, code) => {
      await refusesAndWritesNothing(ENTER_CO, { input: { assessments: assessments() } }, code);
    });
  });
});
