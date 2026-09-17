/**
 * Examinations & Report Cards E2E (ROV-265).
 *
 * Exercises the full offline-exam pipeline against the running stack:
 *   grading scheme + bands → exam → datesheet → marks entry → results + rank
 *   → term-aggregated, NEP-aware report card → published PDF.
 *
 * Self-bootstrapping: discovers the seeded "Class 5-A" section, its standard,
 * and a subject via the live GraphQL surface (no fixed section/subject seed IDs
 * exist), then creates everything else through mutations.
 *
 * Cross-scope rejection and cross-tenant isolation for the institute scope are
 * already covered broadly in security-invariants.api-e2e.spec.ts; the focused
 * checks here assert the examination resolvers specifically inherit them.
 */
import assert from 'node:assert';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsPlatformAdmin,
  loginAsReseller,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

// CBSE 9-point scholastic scheme — bands tile 0–100 with no gaps/overlaps so
// they pass assertValidScholasticBands. D (33–40) is the lowest passing band.
const CBSE_BANDS = [
  { grade: 'A1', minPercent: 91, maxPercent: 100, gradePoint: 10, isPassing: true },
  { grade: 'A2', minPercent: 81, maxPercent: 90, gradePoint: 9, isPassing: true },
  { grade: 'B1', minPercent: 71, maxPercent: 80, gradePoint: 8, isPassing: true },
  { grade: 'B2', minPercent: 61, maxPercent: 70, gradePoint: 7, isPassing: true },
  { grade: 'C1', minPercent: 51, maxPercent: 60, gradePoint: 6, isPassing: true },
  { grade: 'C2', minPercent: 41, maxPercent: 50, gradePoint: 5, isPassing: true },
  { grade: 'D', minPercent: 33, maxPercent: 40, gradePoint: 4, isPassing: true },
  { grade: 'E', minPercent: 0, maxPercent: 32, gradePoint: 0, isPassing: false },
];

interface ExamNode {
  id: string;
  status: string;
  name: Record<string, string>;
  type: string;
}
interface ScheduleNode {
  id: string;
  maxMarks: number;
}
interface MarksSheetRow {
  studentId: string;
  name: string;
}
interface ResultRow {
  studentId: string;
  percentage: number;
  rank: number | null;
  resultStatus: string;
  subjects: Array<{ subjectId: string; grade: string | null }>;
}
interface InstanceNode {
  id: string;
  status: string;
  percentage: number | null;
  rank: number | null;
}

const academicYearId = SEED.ACADEMIC_YEAR_INST1.id;
const tag = `e2e-${Date.now()}`;

describe('Examinations & Report Cards E2E', () => {
  let token: string;
  let sectionId: string;
  let subjectId: string;
  let gradingSchemeId: string;
  let examTermId: string;

  beforeAll(async () => {
    ({ accessToken: token } = await loginAsInstituteAdmin());

    // Discover the seeded "Class 5-A" section + its standard.
    const stds = await gql<{ standards: Array<{ id: string }> }>(
      `query Stds($ay: ID!) { standards(academicYearId: $ay) { id } }`,
      { ay: academicYearId },
      token,
    );
    expect(stds.errors).toBeUndefined();
    const standards = stds.data?.standards ?? [];
    assert(standards.length > 0, 'seed must have standards for institute 1');

    for (const std of standards) {
      const secs = await gql<{ sections: Array<{ id: string; displayLabel: string | null }> }>(
        `query Secs($s: ID!) { sections(standardId: $s) { id displayLabel } }`,
        { s: std.id },
        token,
      );
      const match = secs.data?.sections?.find((s) => s.displayLabel === 'Class 5-A');
      if (match) {
        sectionId = match.id;
        break;
      }
    }
    assert(sectionId, 'seeded "Class 5-A" section must exist');

    const subs = await gql<{ subjects: Array<{ id: string }> }>(
      `query { subjects { id } }`,
      undefined,
      token,
    );
    assert(subs.data?.subjects?.length, 'seed must have subjects');
    subjectId = subs.data.subjects[0].id;

    // A SCHOLASTIC scheme + a term to aggregate into.
    const scheme = await gql<{ createGradingScheme: { id: string } }>(
      `mutation Create($input: CreateGradingSchemeInput!) {
        createGradingScheme(input: $input) { id }
      }`,
      {
        input: {
          name: { en: `CBSE 9-Point ${tag}` },
          kind: 'SCHOLASTIC',
          board: 'CBSE',
          isDefault: false,
          bands: CBSE_BANDS,
        },
      },
      token,
    );
    expect(scheme.errors).toBeUndefined();
    assert(scheme.data?.createGradingScheme.id);
    gradingSchemeId = scheme.data.createGradingScheme.id;

    const term = await gql<{ createExamTerm: { id: string } }>(
      `mutation Create($input: CreateExamTermInput!) {
        createExamTerm(input: $input) { id }
      }`,
      {
        input: { academicYearId, name: { en: `Term 1 ${tag}` }, sequence: 1, weightInFinal: 50 },
      },
      token,
    );
    expect(term.errors).toBeUndefined();
    assert(term.data?.createExamTerm.id);
    examTermId = term.data.createExamTerm.id;
  });

  // ── Grading schemes ────────────────────────────────────────────────────────

  it('rejects a scholastic scheme whose bands do not cover 0–100', async () => {
    const res = await gql(
      `mutation Create($input: CreateGradingSchemeInput!) {
        createGradingScheme(input: $input) { id }
      }`,
      {
        input: {
          name: { en: `Bad ${tag}` },
          kind: 'SCHOLASTIC',
          isDefault: false,
          // Leaves 0–49 uncovered → must be rejected.
          bands: [{ grade: 'A', minPercent: 50, maxPercent: 100, gradePoint: 10, isPassing: true }],
        },
      },
      token,
    );
    expect(res.errors).toBeDefined();
    expect(JSON.stringify(res.errors)).toMatch(/cover 0|0.*100|band/i);
  });

  it('lists the created scheme with its bands', async () => {
    const res = await gql<{ gradingScheme: { id: string; bands: Array<{ grade: string }> } }>(
      `query Scheme($id: ID!) { gradingScheme(id: $id) { id bands { grade } } }`,
      { id: gradingSchemeId },
      token,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.gradingScheme.bands).toHaveLength(CBSE_BANDS.length);
  });

  // ── Exam lifecycle (happy path) ──────────────────────────────────────────────

  let examId: string;
  let scheduleId: string;

  it('creates an exam in DRAFT', async () => {
    const res = await gql<{ createExam: ExamNode }>(
      `mutation Create($input: CreateExamInput!) {
        createExam(input: $input) { id status type }
      }`,
      {
        input: {
          academicYearId,
          examTermId,
          name: { en: `Mid Term ${tag}` },
          type: 'MID_TERM',
          gradingSchemeId,
          startDate: '2026-05-04',
          endDate: '2026-05-10',
          weightInTerm: 100,
        },
      },
      token,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data?.createExam);
    expect(res.data.createExam.status).toBe('DRAFT');
    examId = res.data.createExam.id;
  });

  it('adds a datesheet row (section + subject + THEORY, max 100)', async () => {
    const res = await gql<{ addExamSchedule: ScheduleNode }>(
      `mutation Add($input: CreateExamScheduleInput!) {
        addExamSchedule(input: $input) { id maxMarks }
      }`,
      {
        input: {
          examId,
          sectionId,
          subjectId,
          component: 'THEORY',
          examDate: '2026-05-04',
          startTime: '09:00',
          endTime: '12:00',
          maxMarks: 100,
          passMarks: 33,
        },
      },
      token,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data?.addExamSchedule);
    expect(res.data.addExamSchedule.maxMarks).toBe(100);
    scheduleId = res.data.addExamSchedule.id;
  });

  it('rejects publishing results directly from DRAFT (invalid transition)', async () => {
    const res = await gql(
      `mutation Pub($id: ID!) { publishExamResults(id: $id) { id status } }`,
      { id: examId },
      token,
    );
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('schedules the exam then opens marks entry', async () => {
    const sched = await gql<{ scheduleExam: ExamNode }>(
      `mutation S($id: ID!) { scheduleExam(id: $id) { status } }`,
      { id: examId },
      token,
    );
    expect(sched.errors).toBeUndefined();
    expect(sched.data?.scheduleExam.status).toBe('SCHEDULED');

    const open = await gql<{ openExamMarksEntry: ExamNode }>(
      `mutation O($id: ID!) { openExamMarksEntry(id: $id) { status } }`,
      { id: examId },
      token,
    );
    expect(open.errors).toBeUndefined();
    expect(open.data?.openExamMarksEntry.status).toBe('MARKS_ENTRY');
  });

  it('rejects out-of-range marks', async () => {
    const res = await gql(
      `mutation Enter($input: EnterMarksInput!) { enterExamMarks(input: $input) }`,
      {
        input: {
          examId,
          marks: [
            {
              examScheduleId: scheduleId,
              studentId: SEED.STUDENT_PROFILE_1.id,
              obtainedMarks: 150,
            },
          ],
        },
      },
      token,
    );
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.extensions?.code).toBe('EXAM_MARKS_OUT_OF_RANGE');
  });

  let rosterIds: string[] = [];

  it('returns the section roster on the marks sheet', async () => {
    const res = await gql<{ examMarksSheet: { rows: MarksSheetRow[] } }>(
      `query Sheet($s: ID!) { examMarksSheet(examScheduleId: $s) { rows { studentId name } } }`,
      { s: scheduleId },
      token,
    );
    expect(res.errors).toBeUndefined();
    const rows = res.data?.examMarksSheet.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    rosterIds = rows.map((r) => r.studentId);
  });

  it('enters valid marks for the whole roster', async () => {
    // Spread marks across bands so ranks and grades differ.
    const spread = [95, 82, 71, 58, 30];
    const marks = rosterIds.map((studentId, i) => ({
      examScheduleId: scheduleId,
      studentId,
      obtainedMarks: spread[i % spread.length],
    }));
    const res = await gql<{ enterExamMarks: number }>(
      `mutation Enter($input: EnterMarksInput!) { enterExamMarks(input: $input) }`,
      { input: { examId, marks } },
      token,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.enterExamMarks).toBe(rosterIds.length);
  });

  it('computes results with dense rank and grades', async () => {
    const res = await gql<{ examResults: ResultRow[] }>(
      `query Results($e: ID!, $s: ID!) {
        examResults(examId: $e, sectionId: $s) {
          studentId percentage rank resultStatus subjects { subjectId grade }
        }
      }`,
      { e: examId, s: sectionId },
      token,
    );
    expect(res.errors).toBeUndefined();
    const results = res.data?.examResults ?? [];
    expect(results.length).toBe(rosterIds.length);
    // Sorted highest-first, rank 1 at the top, every row ranked.
    expect(results[0].rank).toBe(1);
    for (const r of results) {
      expect(r.rank).not.toBeNull();
      expect(r.percentage).toBeGreaterThanOrEqual(0);
    }
    // The top scorer (95) lands in A1.
    expect(results[0].subjects[0]?.grade).toBe('A1');
  });

  it('locks then publishes the exam', async () => {
    const lock = await gql<{ lockExam: ExamNode }>(
      `mutation L($id: ID!) { lockExam(id: $id) { status } }`,
      { id: examId },
      token,
    );
    expect(lock.errors).toBeUndefined();
    expect(lock.data?.lockExam.status).toBe('LOCKED');

    const pub = await gql<{ publishExamResults: ExamNode }>(
      `mutation P($id: ID!) { publishExamResults(id: $id) { status } }`,
      { id: examId },
      token,
    );
    expect(pub.errors).toBeUndefined();
    expect(pub.data?.publishExamResults.status).toBe('RESULTS_PUBLISHED');
  });

  // ── Report cards ──────────────────────────────────────────────────────────────

  it('rejects generation for a report card with no term', async () => {
    const card = await gql<{ createReportCard: { id: string } }>(
      `mutation C($input: CreateReportCardInput!) { createReportCard(input: $input) { id } }`,
      { input: { academicYearId, name: { en: `Annual ${tag}` } } },
      token,
    );
    expect(card.errors).toBeUndefined();
    const id = card.data?.createReportCard.id;
    assert(id);
    const gen = await gql(
      `mutation G($r: ID!, $s: ID!) { generateReportCards(reportCardId: $r, sectionId: $s) }`,
      { r: id, s: sectionId },
      token,
    );
    expect(gen.errors).toBeDefined();
    expect(gen.errors?.[0]?.extensions?.code).toBe('REPORT_CARD_GENERATION_FAILED');
  });

  let reportCardId: string;

  it('creates a term-targeted report card, generates and publishes instances', async () => {
    const card = await gql<{ createReportCard: { id: string; status: string } }>(
      `mutation C($input: CreateReportCardInput!) {
        createReportCard(input: $input) { id status }
      }`,
      {
        input: {
          academicYearId,
          examTermId,
          name: { en: `Term 1 Report ${tag}` },
          gradingSchemeId,
          includeAttendance: true,
          includeCoScholastic: true,
          includeTopicWise: true,
        },
      },
      token,
    );
    expect(card.errors).toBeUndefined();
    assert(card.data?.createReportCard);
    expect(card.data.createReportCard.status).toBe('DRAFT');
    reportCardId = card.data.createReportCard.id;

    const gen = await gql<{ generateReportCards: number }>(
      `mutation G($r: ID!, $s: ID!) { generateReportCards(reportCardId: $r, sectionId: $s) }`,
      { r: reportCardId, s: sectionId },
      token,
    );
    expect(gen.errors).toBeUndefined();
    expect(gen.data?.generateReportCards).toBe(rosterIds.length);

    const pub = await gql<{ publishReportCards: number }>(
      `mutation P($r: ID!) { publishReportCards(reportCardId: $r) }`,
      { r: reportCardId },
      token,
    );
    expect(pub.errors).toBeUndefined();
    expect(pub.data?.publishReportCards).toBe(rosterIds.length);
  });

  it('downloads a published report-card PDF (base64 %PDF)', async () => {
    const list = await gql<{ reportCardInstances: InstanceNode[] }>(
      `query I($r: ID!) {
        reportCardInstances(reportCardId: $r) { id status percentage rank }
      }`,
      { r: reportCardId },
      token,
    );
    expect(list.errors).toBeUndefined();
    const instances = list.data?.reportCardInstances ?? [];
    expect(instances.length).toBe(rosterIds.length);
    expect(instances.every((i) => i.status === 'PUBLISHED')).toBe(true);

    const pdf = await gql<{ reportCardPdf: string }>(
      `query Pdf($id: ID!) { reportCardPdf(instanceId: $id) }`,
      { id: instances[0].id },
      token,
    );
    expect(pdf.errors).toBeUndefined();
    const base64 = pdf.data?.reportCardPdf ?? '';
    expect(base64.length).toBeGreaterThan(100);
    // "%PDF" base64-encodes to "JVBER".
    expect(base64.startsWith('JVBER')).toBe(true);
  });

  // ── Auth & scope ────────────────────────────────────────────────────────────

  it('rejects an unauthenticated request', async () => {
    const res = await gql(`query Ex($ay: ID!) { examsList(academicYearId: $ay) { total } }`, {
      ay: academicYearId,
    });
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a platform-scope token', async () => {
    const { accessToken } = await loginAsPlatformAdmin();
    const res = await gql(
      `query Ex($ay: ID!) { examsList(academicYearId: $ay) { total } }`,
      { ay: academicYearId },
      accessToken,
    );
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('rejects a reseller-scope token', async () => {
    const { accessToken } = await loginAsReseller();
    const res = await gql(
      `query Ex($ay: ID!) { examsList(academicYearId: $ay) { total } }`,
      { ay: academicYearId },
      accessToken,
    );
    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────────

  it('does not leak institute-1 exams to institute-2', async () => {
    const { accessToken } = await loginAsInstituteAdminSecondInstitute();
    const res = await gql(
      `query Ex($id: ID!) { exam(id: $id) { id } }`,
      { id: examId },
      accessToken,
    );
    // RLS hides the row → resolver throws EXAM_NOT_FOUND for the other tenant.
    expect(res.errors).toBeDefined();
    expect(JSON.stringify(res.errors)).toMatch(/not found|NOT_FOUND/i);
  });
});
