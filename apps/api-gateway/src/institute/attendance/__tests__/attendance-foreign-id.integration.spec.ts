/**
 * ROV-293: every attendance operation that takes an id refuses a session, section, academic
 * year, class, subject, lecturer or student of another institute, returns none of its data,
 * and stores no reference to it.
 */
import { randomUUID } from 'node:crypto';
import { AcademicStatus, AdmissionType, ErrorCode, SocialCategory } from '@roviq/common-types';
import {
  academicYears,
  attendanceEntries,
  attendanceSessions,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentProfiles,
  subjects,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { asc, eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:attendance-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const SESSION = /* GraphQL */ `
  query AttendanceSession($id: ID!) {
    attendanceSession(id: $id) {
      id
    }
  }
`;
const ENTRIES = /* GraphQL */ `
  query AttendanceEntries($sessionId: ID!) {
    attendanceEntries(sessionId: $sessionId) {
      studentId
      status
    }
  }
`;
const COUNTS = /* GraphQL */ `
  query AttendanceCounts($sessionId: ID!) {
    attendanceCounts(sessionId: $sessionId) {
      status
      count
    }
  }
`;
const SESSIONS_FOR_SECTION = /* GraphQL */ `
  query AttendanceSessionsForSection($sectionId: ID!, $date: String!) {
    attendanceSessionsForSection(sectionId: $sectionId, startDate: $date, endDate: $date) {
      id
    }
  }
`;
const SECTIONS = /* GraphQL */ `
  query AttendanceSections($academicYearId: ID!) {
    attendanceSections(academicYearId: $academicYearId) {
      id
    }
  }
`;
const COUNTS_FOR_DATE = /* GraphQL */ `
  query AttendanceCountsForDate($date: String!, $sectionId: ID, $academicYearId: ID) {
    attendanceCountsForDate(date: $date, sectionId: $sectionId, academicYearId: $academicYearId) {
      sessionCount
      studentCount
      counts {
        status
        count
      }
    }
  }
`;
const ABSENTEES = /* GraphQL */ `
  query AttendanceAbsenteesReport($date: String!, $sectionId: ID, $standardId: ID) {
    attendanceAbsenteesReport(
      startDate: $date
      endDate: $date
      sectionId: $sectionId
      standardId: $standardId
    ) {
      studentId
      absentCount
    }
  }
`;
const BREAKDOWN = /* GraphQL */ `
  query AttendanceSectionDailyBreakdown($date: String!, $standardId: ID) {
    attendanceSectionDailyBreakdown(date: $date, standardId: $standardId) {
      sectionId
      absenteeIds
    }
  }
`;
const NAMED_ABSENTEES = /* GraphQL */ `
  query NamedAbsentees($date: String!, $sectionId: ID) {
    attendanceAbsenteesReport(startDate: $date, endDate: $date, sectionId: $sectionId) {
      studentId
      studentFirstName
      studentLastName
      admissionNumber
    }
  }
`;
const NAMED_BREAKDOWN = /* GraphQL */ `
  query NamedBreakdown($date: String!, $standardId: ID) {
    attendanceSectionDailyBreakdown(date: $date, standardId: $standardId) {
      lecturerFirstName
      lecturerLastName
      absentees {
        studentId
        firstName
        lastName
        admissionNumber
      }
    }
  }
`;
const HISTORY = /* GraphQL */ `
  query AttendanceStudentHistory($studentId: ID!, $date: String!) {
    attendanceStudentHistory(studentId: $studentId, startDate: $date, endDate: $date) {
      sessionId
      status
    }
  }
`;
const OPEN = /* GraphQL */ `
  mutation OpenAttendanceSession($input: CreateAttendanceSessionInput!) {
    openAttendanceSession(input: $input) {
      id
    }
  }
`;
const OVERRIDE = /* GraphQL */ `
  mutation OverrideAttendanceSession($sessionId: ID!, $lecturerId: ID!, $subjectId: ID) {
    overrideAttendanceSession(sessionId: $sessionId, lecturerId: $lecturerId, subjectId: $subjectId) {
      id
    }
  }
`;
const MARK = /* GraphQL */ `
  mutation MarkAttendance($sessionId: ID!, $studentId: ID!) {
    markAttendance(
      input: { sessionId: $sessionId, studentId: $studentId, status: ABSENT, remarks: "Fever" }
    ) {
      id
    }
  }
`;
const BULK_MARK = /* GraphQL */ `
  mutation BulkMarkAttendance($sessionId: ID!, $entries: [MarkAttendanceItem!]!) {
    bulkMarkAttendance(input: { sessionId: $sessionId, entries: $entries }) {
      id
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation DeleteAttendanceSession($id: ID!) {
    deleteAttendanceSession(id: $id)
  }
`;

interface Fixture {
  yearId: string;
  standardId: string;
  sectionId: string;
  subjectId: string;
  /** A teacher membership, the lecturer of the sessions. */
  lecturerId: string;
  /** Another teacher membership. */
  otherLecturerId: string;
  /** Membership of a student placed in the section. */
  studentId: string;
  /** Today's whole-day session of the section; the student is marked ABSENT. */
  sessionId: string;
  /** Tomorrow's whole-day session of the section, with no marks. */
  spareSessionId: string;
}

describe('attendance: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: Fixture;
  let b: Fixture;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Sessions and marks of both institutes, and every one anywhere pointing at B's rows. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const tenants = [instA.tenantId, instB.tenantId];
      const foreignMembers = [b.lecturerId, b.otherLecturerId, b.studentId, instB.membershipId];
      return {
        sessions: await tx
          .select()
          .from(attendanceSessions)
          .where(
            or(
              inArray(attendanceSessions.tenantId, tenants),
              eq(attendanceSessions.sectionId, b.sectionId),
              eq(attendanceSessions.academicYearId, b.yearId),
              eq(attendanceSessions.subjectId, b.subjectId),
              inArray(attendanceSessions.lecturerId, foreignMembers),
            ),
          )
          .orderBy(asc(attendanceSessions.id)),
        entries: await tx
          .select()
          .from(attendanceEntries)
          .where(
            or(
              inArray(attendanceEntries.tenantId, tenants),
              inArray(attendanceEntries.sessionId, [b.sessionId, b.spareSessionId]),
              inArray(attendanceEntries.studentId, foreignMembers),
            ),
          )
          .orderBy(asc(attendanceEntries.id)),
      };
    });

  const setUp = async (inst: TestInstitute): Promise<Fixture> => {
    const lecturer = await createTestTeacher(result.db, inst.tenantId);
    const otherLecturer = await createTestTeacher(result.db, inst.tenantId);
    return asAdmin(async (tx) => {
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
      const [section] = await tx
        .insert(sections)
        .values({
          tenantId,
          standardId: standard.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: 'Class 5-A',
          capacity: 40,
          ...BY,
        })
        .returning({ id: sections.id });
      const [subject] = await tx
        .insert(subjects)
        .values({ tenantId, name: 'Mathematics', ...BY })
        .returning({ id: subjects.id });

      const suffix = randomUUID().slice(0, 8);
      const [user] = await tx
        .insert(users)
        .values({
          email: `attendance_fid_${suffix}@test.local`,
          username: `attendance_fid_${suffix}`,
          passwordHash: 'not-a-real-hash',
          ...BY,
        })
        .returning({ id: users.id });
      await tx
        .insert(userProfiles)
        .values({ userId: user.id, firstName: { en: `Student ${suffix}` }, ...BY });
      await tx
        .insert(tenantUserProfiles)
        .values({ tenantId, userId: user.id, firstName: { en: `Student ${suffix}` }, ...BY });
      const [membership] = await tx
        .insert(memberships)
        .values({ userId: user.id, roleId: inst.roleId, tenantId, abilities: [], ...BY })
        .returning({ id: memberships.id });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId,
          userId: user.id,
          membershipId: membership.id,
          admissionNumber: `ADM-${suffix}`,
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
        sectionId: section.id,
        ...BY,
      });

      const [session, spare] = await tx
        .insert(attendanceSessions)
        .values(
          [TODAY, TOMORROW].map((date) => ({
            tenantId,
            sectionId: section.id,
            academicYearId: year.id,
            date,
            subjectId: subject.id,
            lecturerId: lecturer.membershipId,
            ...BY,
          })),
        )
        .returning({ id: attendanceSessions.id });
      await tx.insert(attendanceEntries).values({
        tenantId,
        sessionId: session.id,
        studentId: membership.id,
        status: 'ABSENT',
        ...BY,
      });

      return {
        yearId: year.id,
        standardId: standard.id,
        sectionId: section.id,
        subjectId: subject.id,
        lecturerId: lecturer.membershipId,
        otherLecturerId: otherLecturer.membershipId,
        studentId: membership.id,
        sessionId: session.id,
        spareSessionId: spare.id,
      };
    });
  };

  const query = async <T>(source: string, variables: Record<string, unknown>) => {
    const res = await gqlRequest<T>(result.httpServer, { query: source, variables, token: tokenA });
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

    const res = await gqlRequest(result.httpServer, { query: source, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    a = await setUp(instA);
    b = await setUp(instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('reads', () => {
    it.each([
      ['attendanceSession', SESSION, 'id'],
      ['attendanceEntries', ENTRIES, 'sessionId'],
      ['attendanceCounts', COUNTS, 'sessionId'],
    ] as const)('%s should refuse a session of another institute and return none of it', async (_operation, source, key) => {
      const res = await gqlRequest(result.httpServer, {
        query: source,
        variables: { [key]: b.sessionId },
        token: tokenA,
      });

      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.ATTENDANCE_SESSION_NOT_FOUND);
      expect(res.data).toBeNull();
    });

    it('attendanceEntries and attendanceCounts should return the marks of its own session', async () => {
      expect(await query(ENTRIES, { sessionId: a.sessionId })).toEqual({
        attendanceEntries: [{ studentId: a.studentId, status: 'ABSENT' }],
      });
      expect(await query(COUNTS, { sessionId: a.sessionId })).toEqual({
        attendanceCounts: [{ status: 'ABSENT', count: 1 }],
      });
    });

    it('attendanceSessionsForSection should list its own section and nothing of another institute section', async () => {
      expect(await query(SESSIONS_FOR_SECTION, { sectionId: a.sectionId, date: TODAY })).toEqual({
        attendanceSessionsForSection: [{ id: a.sessionId }],
      });
      expect(await query(SESSIONS_FOR_SECTION, { sectionId: b.sectionId, date: TODAY })).toEqual({
        attendanceSessionsForSection: [],
      });
    });

    it('attendanceSections should list its own year and nothing of another institute year', async () => {
      expect(await query(SECTIONS, { academicYearId: a.yearId })).toEqual({
        attendanceSections: [{ id: a.sectionId }],
      });
      expect(await query(SECTIONS, { academicYearId: b.yearId })).toEqual({
        attendanceSections: [],
      });
    });

    it.each([
      ['sectionId', 'sectionId'],
      ['academicYearId', 'yearId'],
    ] as const)('attendanceCountsForDate should count its own %s and nothing of another institute', async (filter, key) => {
      expect(await query(COUNTS_FOR_DATE, { date: TODAY, [filter]: a[key] })).toEqual({
        attendanceCountsForDate: {
          sessionCount: 1,
          studentCount: 1,
          counts: [{ status: 'ABSENT', count: 1 }],
        },
      });
      expect(await query(COUNTS_FOR_DATE, { date: TODAY, [filter]: b[key] })).toEqual({
        attendanceCountsForDate: { sessionCount: 0, studentCount: 0, counts: [] },
      });
    });

    it.each([
      ['sectionId', 'sectionId'],
      ['standardId', 'standardId'],
    ] as const)('attendanceAbsenteesReport should report its own %s and nothing of another institute', async (filter, key) => {
      expect(await query(ABSENTEES, { date: TODAY, [filter]: a[key] })).toEqual({
        attendanceAbsenteesReport: [{ studentId: a.studentId, absentCount: 1 }],
      });
      expect(await query(ABSENTEES, { date: TODAY, [filter]: b[key] })).toEqual({
        attendanceAbsenteesReport: [],
      });
    });

    it('attendanceSectionDailyBreakdown should break down its own class and nothing of another institute class', async () => {
      expect(await query(BREAKDOWN, { date: TODAY, standardId: a.standardId })).toEqual({
        attendanceSectionDailyBreakdown: [{ sectionId: a.sectionId, absenteeIds: [a.studentId] }],
      });
      expect(await query(BREAKDOWN, { date: TODAY, standardId: b.standardId })).toEqual({
        attendanceSectionDailyBreakdown: [],
      });
    });

    it("both reports should name its own people and never join in another institute's (ROV-360)", async () => {
      // A past date no other test reads. An entry cannot name B's student: the foreign key
      // carries the institute. The joined names come only from A's own copies.
      const date = '2026-05-04';
      const own = await asAdmin(async (tx) => {
        const [student] = await tx
          .select({
            firstName: tenantUserProfiles.firstName,
            admissionNumber: studentProfiles.admissionNumber,
          })
          .from(studentProfiles)
          .innerJoin(tenantUserProfiles, eq(tenantUserProfiles.userId, studentProfiles.userId))
          .where(eq(studentProfiles.membershipId, a.studentId));
        const [lecturer] = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(eq(memberships.id, a.lecturerId));
        await tx.insert(tenantUserProfiles).values([
          { tenantId: instA.tenantId, userId: lecturer.userId, firstName: { en: 'Kavita' }, ...BY },
          { tenantId: instB.tenantId, userId: lecturer.userId, firstName: { en: 'Wrong' }, ...BY },
        ]);
        const [session] = await tx
          .insert(attendanceSessions)
          .values({
            tenantId: instA.tenantId,
            sectionId: a.sectionId,
            academicYearId: a.yearId,
            date,
            subjectId: a.subjectId,
            lecturerId: a.lecturerId,
            ...BY,
          })
          .returning({ id: attendanceSessions.id });
        await tx.insert(attendanceEntries).values({
          tenantId: instA.tenantId,
          sessionId: session.id,
          studentId: a.studentId,
          status: 'ABSENT' as const,
          ...BY,
        });
        return { ...student, sessionId: session.id };
      });
      await expect(
        asAdmin((tx) =>
          tx.insert(attendanceEntries).values({
            tenantId: instA.tenantId,
            sessionId: own.sessionId,
            studentId: b.studentId,
            status: 'ABSENT' as const,
            ...BY,
          }),
        ),
      ).rejects.toMatchObject({
        cause: { code: '23503', constraint: 'attendance_entries_student_id_tenant_fkey' },
      });
      const named = {
        firstName: own.firstName,
        lastName: null,
        admissionNumber: own.admissionNumber,
      };

      expect(await query(NAMED_ABSENTEES, { date, sectionId: a.sectionId })).toEqual({
        attendanceAbsenteesReport: [
          {
            studentId: a.studentId,
            studentFirstName: named.firstName,
            studentLastName: null,
            admissionNumber: named.admissionNumber,
          },
        ],
      });

      expect(await query(NAMED_BREAKDOWN, { date, standardId: a.standardId })).toEqual({
        attendanceSectionDailyBreakdown: [
          {
            lecturerFirstName: { en: 'Kavita' },
            lecturerLastName: null,
            absentees: [{ studentId: a.studentId, ...named }],
          },
        ],
      });
    });

    it('attendanceStudentHistory should list its own student and nothing of a student of another institute', async () => {
      expect(await query(HISTORY, { studentId: a.studentId, date: TODAY })).toEqual({
        attendanceStudentHistory: [{ sessionId: a.sessionId, status: 'ABSENT' }],
      });
      expect(await query(HISTORY, { studentId: b.studentId, date: TODAY })).toEqual({
        attendanceStudentHistory: [],
      });
    });
  });

  describe('openAttendanceSession', () => {
    const input = (period: number, foreign: Record<string, string> = {}) => ({
      sectionId: a.sectionId,
      academicYearId: a.yearId,
      date: TODAY,
      period,
      subjectId: a.subjectId,
      lecturerId: a.lecturerId,
      ...foreign,
    });

    it('should open a session of its own section and seed its own student', async () => {
      const data = await query<{ openAttendanceSession: { id: string } }>(OPEN, {
        input: input(1),
      });

      const id = data?.openAttendanceSession.id ?? '';
      const stored = await asAdmin(async (tx) => ({
        session: await tx
          .select({
            tenantId: attendanceSessions.tenantId,
            sectionId: attendanceSessions.sectionId,
            subjectId: attendanceSessions.subjectId,
            lecturerId: attendanceSessions.lecturerId,
          })
          .from(attendanceSessions)
          .where(eq(attendanceSessions.id, id)),
        entries: await tx
          .select({ studentId: attendanceEntries.studentId, status: attendanceEntries.status })
          .from(attendanceEntries)
          .where(eq(attendanceEntries.sessionId, id)),
      }));
      expect(stored).toEqual({
        session: [
          {
            tenantId: instA.tenantId,
            sectionId: a.sectionId,
            subjectId: a.subjectId,
            lecturerId: a.lecturerId,
          },
        ],
        entries: [{ studentId: a.studentId, status: 'PRESENT' }],
      });
    });

    it.each([
      ['sectionId', 2, () => ({ sectionId: b.sectionId }), ErrorCode.SECTION_NOT_FOUND],
      // The section is checked against the year it names: a foreign year never matches.
      ['academicYearId', 3, () => ({ academicYearId: b.yearId }), ErrorCode.SECTION_NOT_FOUND],
      ['subjectId', 4, () => ({ subjectId: b.subjectId }), ErrorCode.SUBJECT_NOT_FOUND],
      ['lecturerId', 5, () => ({ lecturerId: b.lecturerId }), ErrorCode.MEMBERSHIP_NOT_FOUND],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, period, foreign, code) => {
      await refusesAndWritesNothing(OPEN, { input: input(period, foreign()) }, code);
    });
  });

  describe('overrideAttendanceSession', () => {
    it('should hand its own session to its own lecturer and subject', async () => {
      const [subject] = await asAdmin((tx) =>
        tx
          .insert(subjects)
          .values({ tenantId: instA.tenantId, name: 'Science', ...BY })
          .returning({ id: subjects.id }),
      );

      await query(OVERRIDE, {
        sessionId: a.spareSessionId,
        lecturerId: a.otherLecturerId,
        subjectId: subject.id,
      });

      const stored = await asAdmin((tx) =>
        tx
          .select({
            lecturerId: attendanceSessions.lecturerId,
            subjectId: attendanceSessions.subjectId,
          })
          .from(attendanceSessions)
          .where(eq(attendanceSessions.id, a.spareSessionId)),
      );
      expect(stored).toEqual([{ lecturerId: a.otherLecturerId, subjectId: subject.id }]);
    });

    it.each([
      [
        'sessionId',
        () => ({ sessionId: b.sessionId, lecturerId: a.otherLecturerId, subjectId: a.subjectId }),
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
      ],
      [
        'lecturerId',
        () => ({ sessionId: a.sessionId, lecturerId: b.lecturerId, subjectId: a.subjectId }),
        ErrorCode.MEMBERSHIP_NOT_FOUND,
      ],
      [
        'subjectId',
        () => ({ sessionId: a.sessionId, lecturerId: a.lecturerId, subjectId: b.subjectId }),
        ErrorCode.SUBJECT_NOT_FOUND,
      ],
    ] as const)('should refuse %s of another institute and write nothing', async (_field, variables, code) => {
      await refusesAndWritesNothing(OVERRIDE, variables(), code);
    });
  });

  describe('markAttendance', () => {
    it('should mark its own student in its own session', async () => {
      await query(MARK, { sessionId: a.sessionId, studentId: a.studentId });

      const stored = await asAdmin((tx) =>
        tx
          .select({ status: attendanceEntries.status, remarks: attendanceEntries.remarks })
          .from(attendanceEntries)
          .where(eq(attendanceEntries.sessionId, a.sessionId)),
      );
      expect(stored).toEqual([{ status: 'ABSENT', remarks: 'Fever' }]);
    });

    it('should refuse a session of another institute and write nothing', async () => {
      await refusesAndWritesNothing(
        MARK,
        { sessionId: b.sessionId, studentId: a.studentId },
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
      );
    });

    // FORBIDDEN, as for an own student outside the session's section: nothing of B shows.
    it('should refuse a student of another institute and write nothing', async () => {
      await refusesAndWritesNothing(
        MARK,
        { sessionId: a.sessionId, studentId: b.studentId },
        ErrorCode.FORBIDDEN,
      );
    });
  });

  describe('bulkMarkAttendance', () => {
    const entry = (studentId: string) => ({ studentId, status: 'LATE' });

    it('should refuse a session of another institute and write nothing', async () => {
      await refusesAndWritesNothing(
        BULK_MARK,
        { sessionId: b.sessionId, entries: [entry(a.studentId)] },
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
      );
    });

    it.each([
      ['alone', () => [entry(b.studentId)]],
      ['after its own', () => [entry(a.studentId), entry(b.studentId)]],
    ] as const)('should refuse a student of another institute %s and write nothing', async (_case, entries) => {
      await refusesAndWritesNothing(
        BULK_MARK,
        { sessionId: a.sessionId, entries: entries() },
        ErrorCode.FORBIDDEN,
      );
    });
  });

  it('deleteAttendanceSession should refuse a session of another institute and change neither institute', async () => {
    await refusesAndWritesNothing(
      DELETE,
      { id: b.sessionId },
      ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
    );
  });
});
