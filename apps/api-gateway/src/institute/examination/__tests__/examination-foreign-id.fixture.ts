/**
 * ROV-293: the rows of one institute that the examination and report-card foreign-id specs
 * point at, and a snapshot of every examination row of two institutes or pointing at the second.
 */
import { randomUUID } from 'node:crypto';
import { AcademicStatus, AdmissionType, Gender, SocialCategory } from '@roviq/common-types';
import {
  academicYears,
  coScholasticAreas,
  coScholasticAssessments,
  type DrizzleDB,
  examMarks,
  examSchedules,
  exams,
  examTerms,
  examTopicAssessments,
  files,
  gradeBands,
  gradingSchemes,
  memberships,
  mkAdminCtx,
  reportCardInstances,
  reportCards,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  subjects,
  subjectTopics,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { createTestTeacher, type TestInstitute } from '@roviq/testing/integration';
import { asc, inArray, or } from 'drizzle-orm';

const ORIGIN = 'test:examination-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export interface ExamFixture {
  yearId: string;
  standardId: string;
  /** Section of `student`; `marksScheduleId` is set for it. */
  sectionId: string;
  /** Section of `otherStudent`; covered only by `spareScheduleId`. */
  otherSectionId: string;
  subjectId: string;
  /** Student membership (marks and assessments) and profile (report cards), in `sectionId`. */
  student: { membershipId: string; profileId: string };
  /** In `otherSectionId`: not on the roster of `marksScheduleId`. */
  otherStudent: { membershipId: string; profileId: string };
  teacherMembershipId: string;
  schemeId: string;
  coSchemeId: string;
  /** Referenced by nothing, so it can be deleted. */
  spareSchemeId: string;
  termId: string;
  spareTermId: string;
  /** MARKS_ENTRY, in `termId`, with `marksScheduleId`, one mark and one topic assessment. */
  marksExamId: string;
  marksScheduleId: string;
  draftExamId: string;
  /** On `draftExamId`, for `otherSectionId`. */
  spareScheduleId: string;
  scheduledExamId: string;
  lockedExamId: string;
  publishedExamId: string;
  archivedExamId: string;
  deletedExamId: string;
  spareExamId: string;
  topicId: string;
  spareTopicId: string;
  areaId: string;
  spareAreaId: string;
  /** GENERATED, in `termId`, with `instanceId` for `student`. */
  generatedCardId: string;
  instanceId: string;
  /** DRAFT, in `termId`, no instances. */
  draftCardId: string;
  spareCardId: string;
}

export const asAdmin = <T>(db: DrizzleDB, fn: (tx: DrizzleDB) => Promise<T>) =>
  withAdmin(db, mkAdminCtx(ORIGIN), fn);

export async function setUpExamFixture(db: DrizzleDB, inst: TestInstitute): Promise<ExamFixture> {
  const teacher = await createTestTeacher(db, inst.tenantId);
  return asAdmin(db, async (tx) => {
    const tenantId = inst.tenantId;
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        isActive: true,
        status: 'ACTIVE',
        ...BY,
      })
      .returning({ id: academicYears.id });
    const [standard] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        level: 'PRIMARY',
        ...BY,
      })
      .returning({ id: standards.id });
    const [section, otherSection] = await tx
      .insert(sections)
      .values(
        ['A', 'B'].map((name) => ({
          tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: name },
          displayLabel: `Class 5-${name}`,
          capacity: 40,
          ...BY,
        })),
      )
      .returning({ id: sections.id });
    const [subject] = await tx
      .insert(subjects)
      .values({ tenantId, name: 'Mathematics', ...BY })
      .returning({ id: subjects.id });
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student ${randomUUID().slice(0, 8)}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        ...BY,
      })
      .returning({ id: roles.id });

    const addStudent = async (firstName: string, sectionId: string, rollNumber: string) => {
      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx
        .insert(users)
        .values({
          email: `exam_stu_${suffix}@test.local`,
          username: `exam_stu_${suffix}`,
          passwordHash: 'not-a-real-hash',
          ...BY,
        })
        .returning({ id: users.id });
      const name = { firstName: { en: firstName }, lastName: { en: 'Verma' } };
      await tx
        .insert(userProfiles)
        .values({ userId: user.id, ...name, gender: Gender.FEMALE, ...BY });
      await tx
        .insert(tenantUserProfiles)
        .values({ tenantId, userId: user.id, ...name, gender: Gender.FEMALE, ...BY });
      const [membership] = await tx
        .insert(memberships)
        .values({ userId: user.id, roleId: role.id, tenantId, abilities: [], ...BY })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `EXAM-ADM-${suffix}`,
          admissionDate: '2026-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
          ...BY,
        })
        .returning({ id: studentProfiles.id });
      await tx.insert(studentAcademics).values({
        tenantId,
        studentProfileId: profile.id,
        academicYearId: year.id,
        standardId: standard.id,
        sectionId,
        rollNumber,
        ...BY,
      });
      return { membershipId: membership.id, profileId: profile.id };
    };
    const student = await addStudent('Asha', section.id, '1');
    const otherStudent = await addStudent('Bela', otherSection.id, '2');

    const addScheme = async (name: string, kind: 'SCHOLASTIC' | 'CO_SCHOLASTIC') => {
      const [scheme] = await tx
        .insert(gradingSchemes)
        .values({ tenantId, name: { en: name }, kind, ...BY })
        .returning({ id: gradingSchemes.id });
      await tx.insert(gradeBands).values([
        {
          tenantId,
          gradingSchemeId: scheme.id,
          grade: 'A',
          minPercent: 50,
          maxPercent: 100,
          gradePoint: 10,
          sequence: 0,
          ...BY,
        },
        {
          tenantId,
          gradingSchemeId: scheme.id,
          grade: 'E',
          minPercent: 0,
          maxPercent: 49.99,
          gradePoint: 0,
          isPassing: false,
          sequence: 1,
          ...BY,
        },
      ]);
      return scheme.id;
    };
    const schemeId = await addScheme('CBSE 9-point', 'SCHOLASTIC');
    const coSchemeId = await addScheme('Co-scholastic', 'CO_SCHOLASTIC');
    const spareSchemeId = await addScheme('Spare', 'SCHOLASTIC');

    const addTerm = async (name: string) => {
      const [term] = await tx
        .insert(examTerms)
        .values({ tenantId, academicYearId: year.id, name: { en: name }, ...BY })
        .returning({ id: examTerms.id });
      return term.id;
    };
    const termId = await addTerm('Term 1');
    const spareTermId = await addTerm('Spare term');

    const addExam = async (
      name: string,
      status: 'DRAFT' | 'SCHEDULED' | 'MARKS_ENTRY' | 'LOCKED' | 'RESULTS_PUBLISHED' | 'ARCHIVED',
      deletedAt: Date | null = null,
    ) => {
      const [exam] = await tx
        .insert(exams)
        .values({
          tenantId,
          academicYearId: year.id,
          examTermId: termId,
          name: { en: name },
          type: 'UNIT_TEST',
          gradingSchemeId: schemeId,
          status,
          deletedAt,
          ...BY,
        })
        .returning({ id: exams.id });
      return exam.id;
    };
    const addSchedule = async (examId: string, sectionId: string) => {
      const [schedule] = await tx
        .insert(examSchedules)
        .values({
          tenantId,
          examId,
          sectionId,
          subjectId: subject.id,
          component: 'THEORY',
          examDate: '2026-12-10',
          startTime: '09:00',
          endTime: '12:00',
          maxMarks: 100,
          room: 'R1',
          invigilatorId: teacher.membershipId,
          ...BY,
        })
        .returning({ id: examSchedules.id });
      return schedule.id;
    };
    const marksExamId = await addExam('Unit test 1', 'MARKS_ENTRY');
    const marksScheduleId = await addSchedule(marksExamId, section.id);
    await tx.insert(examMarks).values({
      tenantId,
      examScheduleId: marksScheduleId,
      studentId: student.membershipId,
      obtainedMarks: 80,
      ...BY,
    });
    const draftExamId = await addExam('Unit test 2', 'DRAFT');
    const spareScheduleId = await addSchedule(draftExamId, otherSection.id);

    const [topic, spareTopic] = await tx
      .insert(subjectTopics)
      .values(
        ['Fractions', 'Decimals'].map((name) => ({
          tenantId,
          subjectId: subject.id,
          standardId: standard.id,
          name: { en: name },
          ...BY,
        })),
      )
      .returning({ id: subjectTopics.id });
    await tx.insert(examTopicAssessments).values({
      tenantId,
      examScheduleId: marksScheduleId,
      studentId: student.membershipId,
      subjectTopicId: topic.id,
      competencyLevel: 'PROFICIENT',
      ...BY,
    });

    const [area, spareArea] = await tx
      .insert(coScholasticAreas)
      .values(
        ['Art education', 'Health'].map((name) => ({
          tenantId,
          name: { en: name },
          gradingSchemeId: coSchemeId,
          ...BY,
        })),
      )
      .returning({ id: coScholasticAreas.id });
    await tx.insert(coScholasticAssessments).values({
      tenantId,
      coScholasticAreaId: area.id,
      studentId: student.membershipId,
      examTermId: termId,
      grade: 'A',
      ...BY,
    });

    const addCard = async (name: string, status: 'DRAFT' | 'GENERATED') => {
      const [card] = await tx
        .insert(reportCards)
        .values({
          tenantId,
          academicYearId: year.id,
          examTermId: termId,
          name: { en: name },
          gradingSchemeId: schemeId,
          status,
          ...BY,
        })
        .returning({ id: reportCards.id });
      return card.id;
    };
    const generatedCardId = await addCard('Term 1 card', 'GENERATED');
    const [instance] = await tx
      .insert(reportCardInstances)
      .values({
        tenantId,
        reportCardId: generatedCardId,
        studentProfileId: student.profileId,
        sectionId: section.id,
        academicYearId: year.id,
        status: 'GENERATED',
        percentage: 80,
        grade: 'A',
        ...BY,
      })
      .returning({ id: reportCardInstances.id });

    return {
      yearId: year.id,
      standardId: standard.id,
      sectionId: section.id,
      otherSectionId: otherSection.id,
      subjectId: subject.id,
      student,
      otherStudent,
      teacherMembershipId: teacher.membershipId,
      schemeId,
      coSchemeId,
      spareSchemeId,
      termId,
      spareTermId,
      marksExamId,
      marksScheduleId,
      draftExamId,
      spareScheduleId,
      scheduledExamId: await addExam('Unit test 3', 'SCHEDULED'),
      lockedExamId: await addExam('Unit test 4', 'LOCKED'),
      publishedExamId: await addExam('Unit test 5', 'RESULTS_PUBLISHED'),
      archivedExamId: await addExam('Unit test 6', 'ARCHIVED'),
      deletedExamId: await addExam('Unit test 7', 'DRAFT', new Date()),
      spareExamId: await addExam('Unit test 8', 'DRAFT'),
      topicId: topic.id,
      spareTopicId: spareTopic.id,
      areaId: area.id,
      spareAreaId: spareArea.id,
      generatedCardId,
      instanceId: instance.id,
      draftCardId: await addCard('Term 1 draft', 'DRAFT'),
      spareCardId: await addCard('Spare card', 'DRAFT'),
    };
  });
}

/** Every id of the fixture, nested ones included. */
export function fixtureIds(fixture: ExamFixture): string[] {
  return Object.values(fixture).flatMap((value) =>
    typeof value === 'string' ? [value] : [value.membershipId, value.profileId],
  );
}

/**
 * Examination rows and files of both institutes, and every examination row of any institute
 * that points at one of B's ids.
 */
export function examSnapshot(
  db: DrizzleDB,
  tenants: string[],
  foreign: string[],
  uploaders: string[],
) {
  return asAdmin(db, async (tx) => ({
    schemes: await tx
      .select()
      .from(gradingSchemes)
      .where(inArray(gradingSchemes.tenantId, tenants))
      .orderBy(asc(gradingSchemes.id)),
    bands: await tx
      .select()
      .from(gradeBands)
      .where(
        or(inArray(gradeBands.tenantId, tenants), inArray(gradeBands.gradingSchemeId, foreign)),
      )
      .orderBy(asc(gradeBands.id)),
    terms: await tx
      .select()
      .from(examTerms)
      .where(or(inArray(examTerms.tenantId, tenants), inArray(examTerms.academicYearId, foreign)))
      .orderBy(asc(examTerms.id)),
    exams: await tx
      .select()
      .from(exams)
      .where(
        or(
          inArray(exams.tenantId, tenants),
          inArray(exams.academicYearId, foreign),
          inArray(exams.examTermId, foreign),
          inArray(exams.gradingSchemeId, foreign),
        ),
      )
      .orderBy(asc(exams.id)),
    schedules: await tx
      .select()
      .from(examSchedules)
      .where(
        or(
          inArray(examSchedules.tenantId, tenants),
          inArray(examSchedules.examId, foreign),
          inArray(examSchedules.sectionId, foreign),
          inArray(examSchedules.subjectId, foreign),
          inArray(examSchedules.invigilatorId, foreign),
        ),
      )
      .orderBy(asc(examSchedules.id)),
    marks: await tx
      .select()
      .from(examMarks)
      .where(
        or(
          inArray(examMarks.tenantId, tenants),
          inArray(examMarks.examScheduleId, foreign),
          inArray(examMarks.studentId, foreign),
        ),
      )
      .orderBy(asc(examMarks.id)),
    topics: await tx
      .select()
      .from(subjectTopics)
      .where(
        or(
          inArray(subjectTopics.tenantId, tenants),
          inArray(subjectTopics.subjectId, foreign),
          inArray(subjectTopics.standardId, foreign),
        ),
      )
      .orderBy(asc(subjectTopics.id)),
    topicAssessments: await tx
      .select()
      .from(examTopicAssessments)
      .where(
        or(
          inArray(examTopicAssessments.tenantId, tenants),
          inArray(examTopicAssessments.examScheduleId, foreign),
          inArray(examTopicAssessments.studentId, foreign),
          inArray(examTopicAssessments.subjectTopicId, foreign),
        ),
      )
      .orderBy(asc(examTopicAssessments.id)),
    areas: await tx
      .select()
      .from(coScholasticAreas)
      .where(
        or(
          inArray(coScholasticAreas.tenantId, tenants),
          inArray(coScholasticAreas.gradingSchemeId, foreign),
        ),
      )
      .orderBy(asc(coScholasticAreas.id)),
    coAssessments: await tx
      .select()
      .from(coScholasticAssessments)
      .where(
        or(
          inArray(coScholasticAssessments.tenantId, tenants),
          inArray(coScholasticAssessments.coScholasticAreaId, foreign),
          inArray(coScholasticAssessments.studentId, foreign),
          inArray(coScholasticAssessments.examTermId, foreign),
        ),
      )
      .orderBy(asc(coScholasticAssessments.id)),
    cards: await tx
      .select()
      .from(reportCards)
      .where(
        or(
          inArray(reportCards.tenantId, tenants),
          inArray(reportCards.academicYearId, foreign),
          inArray(reportCards.examTermId, foreign),
          inArray(reportCards.gradingSchemeId, foreign),
        ),
      )
      .orderBy(asc(reportCards.id)),
    instances: await tx
      .select()
      .from(reportCardInstances)
      .where(
        or(
          inArray(reportCardInstances.tenantId, tenants),
          inArray(reportCardInstances.reportCardId, foreign),
          inArray(reportCardInstances.studentProfileId, foreign),
          inArray(reportCardInstances.sectionId, foreign),
        ),
      )
      .orderBy(asc(reportCardInstances.id)),
    files: await tx
      .select()
      .from(files)
      .where(or(inArray(files.tenantId, tenants), inArray(files.uploadedBy, uploaders)))
      .orderBy(asc(files.id)),
  }));
}
