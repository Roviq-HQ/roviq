// libs/database/src/seed/demo/examinations.ts
//
// Examinations + report-card demo data. Grading schemes, terms, and
// co-scholastic areas seed for EVERY institute (so the config screens render
// regardless of enrolment). The exam + datesheet + marks + report-card chain
// only seeds when the institute has a populated section. Idempotent via
// natural-key onConflict (config) + fixed ids (the primary exam chain).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  coScholasticAreas,
  coScholasticAssessments,
  examMarks,
  examSchedules,
  exams,
  examTerms,
  examTopicAssessments,
  gradeBands,
  gradingSchemes,
  reportCards,
  SYSTEM_USER_ID,
  standardSubjects,
  studentAcademics,
  studentProfiles,
  subjects,
  subjectTopics,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';
import { pickPopulatedSection } from './populated-section';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const SCHOLASTIC_BANDS = [
  { grade: 'A1', minPercent: 91, maxPercent: 100, gradePoint: 10, isPassing: true, sequence: 1 },
  { grade: 'A2', minPercent: 81, maxPercent: 90, gradePoint: 9, isPassing: true, sequence: 2 },
  { grade: 'B1', minPercent: 71, maxPercent: 80, gradePoint: 8, isPassing: true, sequence: 3 },
  { grade: 'B2', minPercent: 61, maxPercent: 70, gradePoint: 7, isPassing: true, sequence: 4 },
  { grade: 'C1', minPercent: 51, maxPercent: 60, gradePoint: 6, isPassing: true, sequence: 5 },
  { grade: 'C2', minPercent: 41, maxPercent: 50, gradePoint: 5, isPassing: true, sequence: 6 },
  { grade: 'D', minPercent: 33, maxPercent: 40, gradePoint: 4, isPassing: true, sequence: 7 },
  { grade: 'E', minPercent: 0, maxPercent: 32, gradePoint: 0, isPassing: false, sequence: 8 },
];

const COSCHOLASTIC_BANDS = [
  { grade: 'A', descriptor: 'Outstanding', isPassing: true, sequence: 1 },
  { grade: 'B', descriptor: 'Very good', isPassing: true, sequence: 2 },
  { grade: 'C', descriptor: 'Good', isPassing: true, sequence: 3 },
  { grade: 'D', descriptor: 'Satisfactory', isPassing: true, sequence: 4 },
  { grade: 'E', descriptor: 'Needs improvement', isPassing: true, sequence: 5 },
];

const SCHOLASTIC_NAME = { en: 'CBSE 9-Point', hi: 'सीबीएसई 9-बिंदु' };
const COSCHOLASTIC_NAME = { en: 'Co-Scholastic A–E', hi: 'सह-शैक्षिक A–E' };

/**
 * Seed examinations for one institute. Config (schemes/terms/co-scholastic)
 * always runs; the graded exam chain runs only when `withExam` and a populated
 * section exist. `withExam` uses fixed ids so it must be the primary institute.
 */
export async function seedExaminations(
  tx: DrizzleDB,
  instId: string,
  academicYearId: string,
  withExam: boolean,
): Promise<void> {
  const tableExists = await tx.execute(
    sql.raw(`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='exams' LIMIT 1`),
  );
  if ((tableExists as { rows: unknown[] }).rows.length === 0) return;

  // ── Grading schemes (natural-key idempotent) ─────────────────────────────────
  await tx
    .insert(gradingSchemes)
    .values([
      {
        tenantId: instId,
        name: SCHOLASTIC_NAME,
        kind: 'SCHOLASTIC',
        board: 'CBSE',
        isDefault: true,
        ...BY,
      },
      {
        tenantId: instId,
        name: COSCHOLASTIC_NAME,
        kind: 'CO_SCHOLASTIC',
        board: 'CBSE',
        isDefault: true,
        ...BY,
      },
    ])
    .onConflictDoNothing();

  const scholasticId = await schemeId(tx, instId, 'SCHOLASTIC');
  const coScholasticId = await schemeId(tx, instId, 'CO_SCHOLASTIC');
  if (!scholasticId || !coScholasticId) return;

  await tx
    .insert(gradeBands)
    .values([
      ...SCHOLASTIC_BANDS.map((b) => ({
        tenantId: instId,
        gradingSchemeId: scholasticId,
        descriptor: null,
        ...b,
        ...BY,
      })),
      ...COSCHOLASTIC_BANDS.map((b) => ({
        tenantId: instId,
        gradingSchemeId: coScholasticId,
        minPercent: null,
        maxPercent: null,
        gradePoint: null,
        ...b,
        ...BY,
      })),
    ])
    .onConflictDoNothing();

  // ── Terms ────────────────────────────────────────────────────────────────────
  await tx
    .insert(examTerms)
    .values([
      {
        tenantId: instId,
        academicYearId,
        name: { en: 'Term 1', hi: 'सत्र 1' },
        sequence: 1,
        weightInFinal: 50,
        ...BY,
      },
      {
        tenantId: instId,
        academicYearId,
        name: { en: 'Term 2', hi: 'सत्र 2' },
        sequence: 2,
        weightInFinal: 50,
        ...BY,
      },
    ])
    .onConflictDoNothing();
  const term1Id = await termId(tx, instId, academicYearId);

  // ── Co-scholastic areas ──────────────────────────────────────────────────────
  await tx
    .insert(coScholasticAreas)
    .values([
      {
        tenantId: instId,
        name: { en: 'Discipline', hi: 'अनुशासन' },
        gradingSchemeId: coScholasticId,
        sequence: 1,
        ...BY,
      },
      {
        tenantId: instId,
        name: { en: 'Work Education', hi: 'कार्य शिक्षा' },
        gradingSchemeId: coScholasticId,
        sequence: 2,
        ...BY,
      },
    ])
    .onConflictDoNothing();

  // ── Report-card template (needs a term) ──────────────────────────────────────
  if (term1Id) {
    await tx
      .insert(reportCards)
      .values({
        tenantId: instId,
        academicYearId,
        examTermId: term1Id,
        name: { en: 'Term 1 Report Card', hi: 'सत्र 1 रिपोर्ट कार्ड' },
        gradingSchemeId: scholasticId,
        includeAttendance: true,
        includeCoScholastic: true,
        includeTopicWise: true,
        status: 'DRAFT',
        ...BY,
      })
      .onConflictDoNothing();
  }

  if (!withExam || !term1Id) return;

  // ── Graded exam chain (primary institute only — fixed ids) ───────────────────
  const section = await pickPopulatedSection(tx, instId);
  if (!section) return;

  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(standardSubjects)
    .innerJoin(subjects, eq(subjects.id, standardSubjects.subjectId))
    .where(
      and(
        eq(standardSubjects.tenantId, instId),
        eq(standardSubjects.standardId, section.standardId),
        isNull(subjects.deletedAt),
      ),
    )
    .orderBy(asc(subjects.id))
    .limit(3);
  if (subjectRows.length === 0) return;

  await tx
    .insert(exams)
    .values({
      id: SEED_IDS.EXAM_MIDTERM_INST1,
      tenantId: instId,
      academicYearId,
      examTermId: term1Id,
      name: { en: 'Mid Term Examination', hi: 'मध्यावधि परीक्षा' },
      type: 'MID_TERM',
      status: 'RESULTS_PUBLISHED',
      gradingSchemeId: scholasticId,
      startDate: '2026-05-04',
      endDate: '2026-05-10',
      weightInTerm: 100,
      description: 'Half-yearly mid-term across core subjects.',
      ...BY,
    })
    .onConflictDoNothing();

  const scheduleIds = [
    SEED_IDS.EXAM_SCHEDULE_1_INST1,
    SEED_IDS.EXAM_SCHEDULE_2_INST1,
    SEED_IDS.EXAM_SCHEDULE_3_INST1,
  ];
  const datesheet = subjectRows.slice(0, 3).map((s, i) => ({
    id: scheduleIds[i],
    tenantId: instId,
    examId: SEED_IDS.EXAM_MIDTERM_INST1,
    sectionId: section.id,
    subjectId: s.id,
    component: 'THEORY' as const,
    examDate: ['2026-05-04', '2026-05-06', '2026-05-08'][i],
    startTime: '09:00',
    endTime: '12:00',
    maxMarks: 100,
    passMarks: 33,
    room: 'Hall A',
    ...BY,
  }));
  await tx.insert(examSchedules).values(datesheet).onConflictDoNothing();

  const enrolled = await tx
    .select({ membershipId: studentProfiles.membershipId })
    .from(studentAcademics)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentAcademics.studentProfileId))
    .where(and(eq(studentAcademics.sectionId, section.id), isNull(studentProfiles.deletedAt)));

  // Marks — the last enrolled student is ABSENT in the final subject (so results
  // exercise the ABSENT / COMPARTMENT paths, not just clean passes).
  const baseBySubject = [88, 74, 61];
  const lastIdx = enrolled.length - 1;
  const markRows = enrolled.flatMap((student, sIdx) =>
    datesheet.map((row, subjIdx) => {
      const absent = sIdx === lastIdx && subjIdx === datesheet.length - 1;
      return {
        tenantId: instId,
        examScheduleId: row.id,
        studentId: student.membershipId,
        obtainedMarks: absent
          ? null
          : Math.max(0, Math.min(100, baseBySubject[subjIdx] - sIdx * 7)),
        isAbsent: absent,
        isExempted: false,
        remarks: absent ? 'Absent — medical leave' : null,
        ...BY,
      };
    }),
  );
  if (markRows.length > 0) await tx.insert(examMarks).values(markRows).onConflictDoNothing();

  // A second exam still in MARKS_ENTRY (a lower-weight unit test) so the exam
  // list shows multiple lifecycle states and marks-entry can be exercised live.
  await tx
    .insert(exams)
    .values({
      id: SEED_IDS.EXAM_UNIT_TEST_INST1,
      tenantId: instId,
      academicYearId,
      examTermId: term1Id,
      name: { en: 'Unit Test 1', hi: 'इकाई परीक्षा 1' },
      type: 'UNIT_TEST',
      status: 'MARKS_ENTRY',
      gradingSchemeId: scholasticId,
      startDate: '2026-04-20',
      endDate: '2026-04-20',
      weightInTerm: 25,
      description: 'First unit test — marks entry is open.',
      ...BY,
    })
    .onConflictDoNothing();
  await tx
    .insert(examSchedules)
    .values({
      id: SEED_IDS.EXAM_UT_SCHEDULE_1_INST1,
      tenantId: instId,
      examId: SEED_IDS.EXAM_UNIT_TEST_INST1,
      sectionId: section.id,
      subjectId: subjectRows[0].id,
      component: 'THEORY' as const,
      examDate: '2026-04-20',
      startTime: '09:00',
      endTime: '10:00',
      maxMarks: 25,
      passMarks: 8,
      room: 'Room 101',
      ...BY,
    })
    .onConflictDoNothing();

  // NEP topics for the first subject.
  await tx
    .insert(subjectTopics)
    .values([
      {
        tenantId: instId,
        subjectId: subjectRows[0].id,
        standardId: section.standardId,
        name: { en: 'Number Sense', hi: 'संख्या बोध' },
        code: 'LO-1',
        learningOutcome: 'Reads, writes, and compares numbers up to 6 digits.',
        sequence: 1,
        ...BY,
      },
      {
        tenantId: instId,
        subjectId: subjectRows[0].id,
        standardId: section.standardId,
        name: { en: 'Problem Solving', hi: 'समस्या समाधान' },
        code: 'LO-2',
        learningOutcome: 'Applies operations to solve multi-step word problems.',
        sequence: 2,
        ...BY,
      },
    ])
    .onConflictDoNothing();

  // Per-student co-scholastic grades + NEP topic competencies for the term, so a
  // generated report card actually renders its co-scholastic and topic-wise sections.
  const areas = await tx
    .select({ id: coScholasticAreas.id })
    .from(coScholasticAreas)
    .where(and(eq(coScholasticAreas.tenantId, instId), isNull(coScholasticAreas.deletedAt)))
    .orderBy(asc(coScholasticAreas.sequence));
  const coGrades = ['A', 'B', 'A', 'C', 'B'];
  const coRows = enrolled.flatMap((student, sIdx) =>
    areas.map((area, aIdx) => ({
      tenantId: instId,
      coScholasticAreaId: area.id,
      studentId: student.membershipId,
      examTermId: term1Id,
      grade: coGrades[(sIdx + aIdx) % coGrades.length],
      descriptor: null,
      ...BY,
    })),
  );
  if (coRows.length > 0)
    await tx.insert(coScholasticAssessments).values(coRows).onConflictDoNothing();

  const topics = await tx
    .select({ id: subjectTopics.id })
    .from(subjectTopics)
    .where(
      and(
        eq(subjectTopics.tenantId, instId),
        eq(subjectTopics.subjectId, subjectRows[0].id),
        isNull(subjectTopics.deletedAt),
      ),
    )
    .orderBy(asc(subjectTopics.sequence));
  const levels = ['ADVANCED', 'PROFICIENT', 'PROGRESSING', 'BEGINNER'] as const;
  const topicRows = enrolled.flatMap((student, sIdx) =>
    topics.map((topic, tIdx) => ({
      tenantId: instId,
      examScheduleId: datesheet[0].id,
      studentId: student.membershipId,
      subjectTopicId: topic.id,
      competencyLevel: levels[(sIdx + tIdx) % levels.length],
      descriptor: null,
      ...BY,
    })),
  );
  if (topicRows.length > 0)
    await tx.insert(examTopicAssessments).values(topicRows).onConflictDoNothing();
}

async function schemeId(tx: DrizzleDB, tenantId: string, kind: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: gradingSchemes.id })
    .from(gradingSchemes)
    .where(
      and(
        eq(gradingSchemes.tenantId, tenantId),
        eq(gradingSchemes.kind, kind as 'SCHOLASTIC'),
        isNull(gradingSchemes.deletedAt),
      ),
    )
    .orderBy(asc(gradingSchemes.id))
    .limit(1);
  return row?.id ?? null;
}

async function termId(
  tx: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: examTerms.id })
    .from(examTerms)
    .where(
      and(
        eq(examTerms.tenantId, tenantId),
        eq(examTerms.academicYearId, academicYearId),
        eq(examTerms.sequence, 1),
        isNull(examTerms.deletedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
