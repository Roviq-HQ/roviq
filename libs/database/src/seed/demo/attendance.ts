// libs/database/src/seed/demo/attendance.ts
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  attendanceEntries,
  attendanceSessions,
  holidays,
  leaves,
  memberships,
  SYSTEM_USER_ID,
  sections,
  studentAcademics,
  studentProfiles,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedAttendanceAndLeaves(tx: DrizzleDB, inst1Id: string) {
  const exists = await tx.execute(
    sql.raw(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'attendance_sessions' LIMIT 1`,
    ),
  );
  if ((exists as { rows: unknown[] }).rows.length === 0) {
    return;
  }

  // Find a section + academic year + standard in inst1.
  const sectionRows = await tx
    .select({
      id: sections.id,
      academicYearId: sections.academicYearId,
      standardId: sections.standardId,
    })
    .from(sections)
    .where(and(eq(sections.tenantId, inst1Id), isNull(sections.deletedAt)))
    .orderBy(sections.displayOrder)
    .limit(1);
  const section = sectionRows[0];
  if (!section) {
    return;
  }
  const sectionId = section.id;
  const academicYearId = section.academicYearId;
  const standardId = section.standardId;

  const teacherMembershipId = SEED_IDS.MEMBERSHIP_TEACHER_INST1;
  const studentMembershipId = SEED_IDS.MEMBERSHIP_STUDENT_INST1;

  const membershipCheckRows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        inArray(memberships.id, [teacherMembershipId, studentMembershipId]),
        isNull(memberships.deletedAt),
      ),
    );
  if (membershipCheckRows.length < 2) {
    return;
  }

  const studentProfileRows = await tx
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.tenantId, inst1Id),
        eq(studentProfiles.membershipId, studentMembershipId),
        isNull(studentProfiles.deletedAt),
      ),
    )
    .limit(1);
  const studentProfile = studentProfileRows[0];
  if (studentProfile) {
    await tx
      .insert(studentAcademics)
      .values({
        id: SEED_IDS.STUDENT_ACADEMIC_1,
        tenantId: inst1Id,
        studentProfileId: studentProfile.id,
        academicYearId,
        standardId,
        sectionId,
        rollNumber: '01',
        ...BY,
      })
      .onConflictDoNothing();
  }

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return iso(d);
  };

  const sessionRows = [
    { date: iso(today), id: SEED_IDS.ATTENDANCE_SESSION_1 },
    { date: daysAgo(1), id: SEED_IDS.ATTENDANCE_SESSION_2 },
    { date: daysAgo(2), id: SEED_IDS.ATTENDANCE_SESSION_3 },
  ];

  for (const s of sessionRows) {
    await tx
      .insert(attendanceSessions)
      .values({
        id: s.id,
        tenantId: inst1Id,
        sectionId,
        academicYearId,
        date: s.date,
        period: null,
        subjectId: null,
        lecturerId: teacherMembershipId,
        overrideCheck: false,
        ...BY,
      })
      .onConflictDoNothing();

    await tx
      .insert(attendanceEntries)
      .values({
        tenantId: inst1Id,
        sessionId: s.id,
        studentId: studentMembershipId,
        status: s.id === SEED_IDS.ATTENDANCE_SESSION_3 ? 'ABSENT' : 'PRESENT',
        mode: 'MANUAL',
        remarks: null,
        ...BY,
      })
      .onConflictDoNothing();
  }

  await tx
    .insert(leaves)
    .values([
      {
        id: SEED_IDS.LEAVE_APPROVED,
        tenantId: inst1Id,
        userId: studentMembershipId,
        startDate: daysAgo(7),
        endDate: daysAgo(5),
        type: 'MEDICAL',
        reason: 'Fever — seen doctor on the 2nd day. Certificate attached.',
        status: 'APPROVED',
        fileUrls: ['https://example.com/sample-medical-cert.pdf'],
        decidedBy: teacherMembershipId,
        ...BY,
      },
      {
        id: SEED_IDS.LEAVE_PENDING,
        tenantId: inst1Id,
        userId: studentMembershipId,
        startDate: daysAgo(-2),
        endDate: daysAgo(-2),
        type: 'CASUAL',
        reason: 'Family wedding.',
        status: 'PENDING',
        fileUrls: [],
        decidedBy: null,
        ...BY,
      },
    ])
    .onConflictDoNothing();

  const yyyy = today.getFullYear();
  await tx
    .insert(holidays)
    .values([
      {
        id: SEED_IDS.HOLIDAY_REPUBLIC_DAY,
        tenantId: inst1Id,
        name: { en: 'Republic Day', hi: 'गणतंत्र दिवस' },
        description: 'National holiday — adoption of the Constitution of India.',
        type: 'NATIONAL',
        startDate: `${yyyy}-01-26`,
        endDate: `${yyyy}-01-26`,
        tags: ['national', 'gazetted'],
        isPublic: true,
        ...BY,
      },
      {
        id: SEED_IDS.HOLIDAY_INDEPENDENCE,
        tenantId: inst1Id,
        name: { en: 'Independence Day', hi: 'स्वतंत्रता दिवस' },
        description: 'National holiday — Independence Day of India.',
        type: 'NATIONAL',
        startDate: `${yyyy}-08-15`,
        endDate: `${yyyy}-08-15`,
        tags: ['national', 'gazetted'],
        isPublic: true,
        ...BY,
      },
      {
        id: SEED_IDS.HOLIDAY_FOUNDERS,
        tenantId: inst1Id,
        name: { en: 'Founder’s Day', hi: 'संस्थापक दिवस' },
        description: 'Institute-declared closure to honour the founding trust.',
        type: 'INSTITUTE',
        startDate: daysAgo(-21),
        endDate: daysAgo(-21),
        tags: ['institute'],
        isPublic: true,
        ...BY,
      },
      {
        id: SEED_IDS.HOLIDAY_SUMMER_BREAK,
        tenantId: inst1Id,
        name: { en: 'Summer Break', hi: 'ग्रीष्मकालीन अवकाश' },
        description: 'Annual summer break.',
        type: 'SUMMER_BREAK',
        startDate: `${yyyy}-05-15`,
        endDate: `${yyyy}-06-30`,
        tags: ['break'],
        isPublic: true,
        ...BY,
      },
    ])
    .onConflictDoNothing();
}
