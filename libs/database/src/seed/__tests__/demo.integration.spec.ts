import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  academicYears,
  institutes,
  memberships,
  roles,
  staffProfiles,
  studentAcademics,
  studentGuardianLinks,
  studentProfiles,
  timetableEntries,
  users,
} from '../../schema';
import { seedDemo } from '../demo';
import { SEED_CREDENTIALS } from '../fixtures';
import { SEED_IDS } from '../ids';
import {
  expectSeededAdmissionsMatchSeries,
  makeSeedTestDb,
  SEED_HOOK_TIMEOUT_MS,
} from './seed-test-helpers';

describe('seedDemo', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await seedDemo(db);
  }, SEED_HOOK_TIMEOUT_MS);

  it('numbers the demo students from the Nursery series and sets its counter past them (ROV-276)', async () => {
    await expectSeededAdmissionsMatchSeries(db, ['STUDENT_1', 'STUDENT_6', 'STUDENT_7']);
  });

  it('creates 2 institutes', async () => {
    const rows = await db.select({ id: institutes.id }).from(institutes);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('creates an active academic year for Institute 1', async () => {
    const rows = await db
      .select({ id: academicYears.id, isActive: academicYears.isActive })
      .from(academicYears)
      .where(eq(academicYears.id, SEED_IDS.ACADEMIC_YEAR_INST1));
    expect(rows[0]?.isActive).toBe(true);
  });

  it('creates the demo users', async () => {
    const expectedUsernames = [
      'admin',
      'teacher1',
      'student1',
      'guardian1',
      'reseller1',
      SEED_CREDENTIALS.SUBJECT_TEACHER.username,
      SEED_CREDENTIALS.GUARDIAN_4.username,
      SEED_CREDENTIALS.STUDENT_6.username,
      SEED_CREDENTIALS.STUDENT_7.username,
    ];
    for (const username of expectedUsernames) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username));
      expect(rows, `${username} must exist`).toHaveLength(1);
    }
  });

  it('creates a staff_profile for teacher1 (demo gap fix)', async () => {
    const rows = await db
      .select({ id: staffProfiles.id, designation: staffProfiles.designation })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.designation).toBe('PGT Mathematics');
  });

  it('creates student_profile + student_academic for student1', async () => {
    const profile = await db
      .select({ id: studentProfiles.id })
      .from(studentProfiles)
      .where(eq(studentProfiles.id, SEED_IDS.STUDENT_PROFILE_1));
    expect(profile).toHaveLength(1);
  });

  it('links guardian1 to student1 (FATHER, primary)', async () => {
    const rows = await db
      .select({
        relationship: studentGuardianLinks.relationship,
        isPrimary: studentGuardianLinks.isPrimaryContact,
      })
      .from(studentGuardianLinks)
      .where(
        and(
          eq(studentGuardianLinks.studentProfileId, SEED_IDS.STUDENT_PROFILE_1),
          eq(studentGuardianLinks.guardianProfileId, SEED_IDS.GUARDIAN_PROFILE_1),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relationship).toBe('FATHER');
    expect(rows[0]?.isPrimary).toBe(true);
  });

  it('gives subjectteacher1 the subject_teacher role and a staff profile that is not a class teacher', async () => {
    const [membership] = await db
      .select({ tenantId: memberships.tenantId, roleName: roles.name })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(memberships.id, SEED_IDS.MEMBERSHIP_SUBJECT_TEACHER_INST1));
    const [staff] = await db
      .select({
        membershipId: staffProfiles.membershipId,
        isClassTeacher: staffProfiles.isClassTeacher,
      })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_SUBJECT_TEACHER));

    expect(membership).toEqual({
      tenantId: SEED_IDS.INSTITUTE_1,
      roleName: { en: 'subject_teacher' },
    });
    expect(staff).toEqual({
      membershipId: SEED_IDS.MEMBERSHIP_SUBJECT_TEACHER_INST1,
      isClassTeacher: false,
    });
  });

  it('assigns subjectteacher1 periods in the demo timetable', async () => {
    const rows = await db
      .select({ id: timetableEntries.id })
      .from(timetableEntries)
      .where(
        and(
          eq(timetableEntries.timetableId, SEED_IDS.TIMETABLE_INST1),
          eq(timetableEntries.teacherId, SEED_IDS.MEMBERSHIP_SUBJECT_TEACHER_INST1),
        ),
      );

    expect(rows.length).toBeGreaterThan(0);
  });

  it('links guardian4 to exactly student6 and student7, enrolled beside student1', async () => {
    const links = await db
      .select({ studentProfileId: studentGuardianLinks.studentProfileId })
      .from(studentGuardianLinks)
      .where(eq(studentGuardianLinks.guardianProfileId, SEED_IDS.GUARDIAN_PROFILE_4));
    const enrolments = await db
      .select({
        studentProfileId: studentAcademics.studentProfileId,
        sectionId: studentAcademics.sectionId,
        academicYearId: studentAcademics.academicYearId,
      })
      .from(studentAcademics)
      .where(
        inArray(studentAcademics.studentProfileId, [
          SEED_IDS.STUDENT_PROFILE_1,
          SEED_IDS.STUDENT_PROFILE_6,
          SEED_IDS.STUDENT_PROFILE_7,
        ]),
      );

    expect(links.map((link) => link.studentProfileId).sort()).toEqual(
      [SEED_IDS.STUDENT_PROFILE_6, SEED_IDS.STUDENT_PROFILE_7].sort(),
    );
    expect(enrolments).toHaveLength(3);
    expect(new Set(enrolments.map((row) => row.sectionId)).size).toBe(1);
    expect(new Set(enrolments.map((row) => row.academicYearId))).toEqual(
      new Set([SEED_IDS.ACADEMIC_YEAR_INST1]),
    );
  });

  it('is idempotent — running twice does not duplicate institutes', async () => {
    await seedDemo(db);
    const rows = await db.select({ id: institutes.id }).from(institutes);
    const seedCount = rows.filter(
      (r) => r.id === SEED_IDS.INSTITUTE_1 || r.id === SEED_IDS.INSTITUTE_2,
    ).length;
    expect(seedCount).toBe(2);
  });
});
