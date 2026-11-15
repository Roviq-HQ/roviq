import assert from 'node:assert/strict';
import {
  type AbilityRule,
  AttendanceStatus,
  DEFAULT_ROLE_ABILITIES,
  type DefaultRole,
  Gender,
  GuardianRelationship,
} from '@roviq/common-types';
import {
  academicYears,
  attendanceEntries,
  attendanceSessions,
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentGuardianLinks,
  studentProfiles,
  userProfiles,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

interface Actor extends TestTeacher {
  token: string;
}
interface StatusCount {
  status: string;
  count: number;
}
interface DateSummary {
  sessionCount: number;
  studentCount: number;
  counts: StatusCount[];
}

const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
// The edit window compares against today's UTC date, so fixtures use it to keep marks editable.
const TODAY = new Date().toISOString().slice(0, 10);
const SUMMARY = 'sessionCount studentCount counts { status count }';

describe('ROV-268 attendance section authorization through GraphQL and PostgreSQL', () => {
  let app: IntegrationAppResult;
  let tenant: TestInstitute;
  let foreignTenant: TestInstitute;
  const actors: Actor[] = [];
  let teacher: Actor;
  let multi: Actor;
  let unassigned: Actor;
  let admin: Actor;
  let parent: Actor;
  let unlinkedParent: Actor;
  let foreignAdmin: Actor;
  let studentA: Actor;
  let studentB: Actor;
  let studentC: Actor;
  let studentOld: Actor;
  let studentForeign: Actor;
  const ids = {
    year: '',
    oldYear: '',
    sectionA: '',
    sectionB: '',
    sectionC: '',
    sectionOld: '',
    sessionA: '',
    sessionB: '',
    sessionCDaily: '',
    sessionCPeriod: '',
    sessionOld: '',
    sessionForeign: '',
  };

  async function actor(
    role: DefaultRole,
    institute = tenant,
    abilities?: AbilityRule[],
  ): Promise<Actor> {
    const record = await createTestTeacher(app.db, institute.tenantId);
    await withAdmin(app.db, mkAdminCtx('test:attendance-authorization'), async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: abilities ?? DEFAULT_ROLE_ABILITIES[role] })
        .where(eq(roles.id, record.roleId));
      await tx
        .update(memberships)
        .set({ abilities: [] })
        .where(eq(memberships.id, record.membershipId));
    });
    const result = {
      ...record,
      token: createInstituteToken({
        sub: record.userId,
        membershipId: record.membershipId,
        roleId: record.roleId,
        tenantId: institute.tenantId,
      }),
    };
    actors.push(result);
    return result;
  }

  async function academicYear(tx: DrizzleDB, tenantId: string, label: string, active: boolean) {
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label,
        startDate: active ? '2026-04-01' : '2025-04-01',
        endDate: active ? '2027-03-31' : '2026-03-31',
        isActive: active,
        status: active ? 'ACTIVE' : 'ARCHIVED',
        ...by,
      })
      .returning();
    const [standard] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        ...by,
      })
      .returning();
    return { yearId: year.id, standardId: standard.id };
  }

  async function section(
    tx: DrizzleDB,
    tenantId: string,
    scope: { yearId: string; standardId: string },
    name: string,
    classTeacherId: string | null,
    enrolled: Actor[],
  ) {
    const [row] = await tx
      .insert(sections)
      .values({
        tenantId,
        academicYearId: scope.yearId,
        standardId: scope.standardId,
        name: { en: name },
        displayLabel: `Class 5-${name}`,
        classTeacherId,
        ...by,
      })
      .returning();
    for (const person of enrolled) {
      await tx.insert(userProfiles).values({
        userId: person.userId,
        firstName: { en: `Student ${name}` },
        gender: Gender.FEMALE,
      });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId,
          userId: person.userId,
          membershipId: person.membershipId,
          admissionNumber: `ROV268-${name}-${person.membershipId.slice(-4)}`,
          admissionDate: '2025-04-01',
          ...by,
        })
        .returning();
      await tx.insert(studentAcademics).values({
        tenantId,
        studentProfileId: profile.id,
        academicYearId: scope.yearId,
        standardId: scope.standardId,
        sectionId: row.id,
        ...by,
      });
    }
    return row.id;
  }

  async function session(
    tx: DrizzleDB,
    tenantId: string,
    values: { sectionId: string; yearId: string; period: number | null; lecturerId: string },
    marks: [Actor, AttendanceStatus][],
  ) {
    const [row] = await tx
      .insert(attendanceSessions)
      .values({
        tenantId,
        sectionId: values.sectionId,
        academicYearId: values.yearId,
        date: TODAY,
        period: values.period,
        lecturerId: values.lecturerId,
        ...by,
      })
      .returning();
    await tx.insert(attendanceEntries).values(
      marks.map(([person, status]) => ({
        tenantId,
        sessionId: row.id,
        studentId: person.membershipId,
        status,
        ...by,
      })),
    );
    return row.id;
  }

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(app.db);
    foreignTenant = await createTestInstitute(app.db);
    teacher = await actor('class_teacher');
    multi = await actor('class_teacher');
    unassigned = await actor('class_teacher');
    admin = await actor('institute_admin');
    parent = await actor('parent');
    unlinkedParent = await actor('parent');
    foreignAdmin = await actor('institute_admin', foreignTenant);
    studentA = await actor('student');
    studentB = await actor('student');
    studentC = await actor('student');
    studentOld = await actor('student');
    studentForeign = await actor('student', foreignTenant);

    await withAdmin(app.db, mkAdminCtx('test:attendance-authorization'), async (tx) => {
      const current = await academicYear(tx, tenant.tenantId, '2026-27', true);
      const old = await academicYear(tx, tenant.tenantId, '2025-26', false);
      const foreign = await academicYear(tx, foreignTenant.tenantId, '2026-27', true);
      ids.year = current.yearId;
      ids.oldYear = old.yearId;
      const t = tenant.tenantId;
      ids.sectionA = await section(tx, t, current, 'A', teacher.membershipId, [studentA]);
      ids.sectionB = await section(tx, t, current, 'B', multi.membershipId, [studentB]);
      ids.sectionC = await section(tx, t, current, 'C', multi.membershipId, [studentC]);
      ids.sectionOld = await section(tx, t, old, 'OLD', teacher.membershipId, [studentOld]);
      const foreignSection = await section(tx, foreignTenant.tenantId, foreign, 'F', null, [
        studentForeign,
      ]);

      const lecturer = admin.membershipId;
      ids.sessionA = await session(
        tx,
        t,
        { sectionId: ids.sectionA, yearId: ids.year, period: null, lecturerId: lecturer },
        [[studentA, AttendanceStatus.PRESENT]],
      );
      ids.sessionB = await session(
        tx,
        t,
        { sectionId: ids.sectionB, yearId: ids.year, period: null, lecturerId: lecturer },
        [[studentB, AttendanceStatus.ABSENT]],
      );
      ids.sessionCDaily = await session(
        tx,
        t,
        { sectionId: ids.sectionC, yearId: ids.year, period: null, lecturerId: lecturer },
        [[studentC, AttendanceStatus.PRESENT]],
      );
      ids.sessionCPeriod = await session(
        tx,
        t,
        { sectionId: ids.sectionC, yearId: ids.year, period: 2, lecturerId: lecturer },
        [[studentC, AttendanceStatus.ABSENT]],
      );
      ids.sessionOld = await session(
        tx,
        t,
        { sectionId: ids.sectionOld, yearId: ids.oldYear, period: null, lecturerId: lecturer },
        [[studentOld, AttendanceStatus.LEAVE]],
      );
      const [childProfile] = await tx
        .select({ id: studentProfiles.id })
        .from(studentProfiles)
        .where(eq(studentProfiles.membershipId, studentA.membershipId));
      for (const person of [parent, unlinkedParent]) {
        await tx
          .insert(userProfiles)
          .values({ userId: person.userId, firstName: { en: 'Parent' } });
        const [guardian] = await tx
          .insert(guardianProfiles)
          .values({ tenantId: t, userId: person.userId, membershipId: person.membershipId, ...by })
          .returning();
        if (person === parent) {
          await tx.insert(studentGuardianLinks).values({
            tenantId: t,
            guardianProfileId: guardian.id,
            studentProfileId: childProfile.id,
            relationship: GuardianRelationship.MOTHER,
          });
        }
      }
      ids.sessionForeign = await session(
        tx,
        foreignTenant.tenantId,
        {
          sectionId: foreignSection,
          yearId: foreign.yearId,
          period: null,
          lecturerId: foreignAdmin.membershipId,
        },
        [[studentForeign, AttendanceStatus.ABSENT]],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    if (tenant && foreignTenant) {
      await withAdmin(app.db, mkAdminCtx('test:attendance-authorization'), async (tx) => {
        const tenantIds = [tenant.tenantId, foreignTenant.tenantId];
        await tx.delete(attendanceEntries).where(inArray(attendanceEntries.tenantId, tenantIds));
        await tx.delete(attendanceSessions).where(inArray(attendanceSessions.tenantId, tenantIds));
        await tx
          .delete(studentGuardianLinks)
          .where(inArray(studentGuardianLinks.tenantId, tenantIds));
        await tx.delete(guardianProfiles).where(inArray(guardianProfiles.tenantId, tenantIds));
        await tx.delete(studentAcademics).where(inArray(studentAcademics.tenantId, tenantIds));
        await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
        await tx.delete(sections).where(inArray(sections.tenantId, tenantIds));
        await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
        await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
        await tx.delete(userProfiles).where(
          inArray(
            userProfiles.userId,
            actors.map((entry) => entry.userId),
          ),
        );
      });
    }
    for (const entry of actors.reverse()) await cleanupTestTeacher(app.db, entry);
    if (tenant) await cleanupTestInstitute(app.db, tenant);
    if (foreignTenant) await cleanupTestInstitute(app.db, foreignTenant);
    await app.close();
  });

  async function query<T>(person: Actor, source: string, variables: Record<string, unknown> = {}) {
    const response = await gqlRequest<T>(app.httpServer, {
      token: person.token,
      query: source,
      variables,
    });
    expect(response.errors).toBeUndefined();
    assert(response.data);
    return response.data;
  }

  async function errorCodes(person: Actor, source: string, variables: Record<string, unknown>) {
    const response = await gqlRequest(app.httpServer, {
      token: person.token,
      query: source,
      variables,
    });
    return response.errors?.map((error) => error.extensions?.code);
  }

  async function summary(
    person: Actor,
    variables: { sectionId?: string; academicYearId?: string } = {},
  ) {
    const data = await query<{ attendanceCountsForDate: DateSummary }>(
      person,
      `query($date: String!, $sectionId: ID, $academicYearId: ID) {
        attendanceCountsForDate(date: $date, sectionId: $sectionId, academicYearId: $academicYearId) { ${SUMMARY} }
      }`,
      { date: TODAY, ...variables },
    );
    return data.attendanceCountsForDate;
  }

  async function sectionIds(person: Actor, academicYearId = ids.year) {
    const data = await query<{ attendanceSections: { id: string }[] }>(
      person,
      'query($y: ID!) { attendanceSections(academicYearId: $y) { id } }',
      { y: academicYearId },
    );
    return data.attendanceSections.map((row) => row.id);
  }

  async function storedStatus(sessionId: string, person: Actor) {
    const rows = await withAdmin(app.db, mkAdminCtx('test:attendance-authorization'), (tx) =>
      tx
        .select({ status: attendanceEntries.status })
        .from(attendanceEntries)
        .where(
          and(
            eq(attendanceEntries.sessionId, sessionId),
            eq(attendanceEntries.studentId, person.membershipId),
          ),
        ),
    );
    return rows.map((row) => row.status);
  }

  describe('section options', () => {
    it('offers each teacher only their assigned sections in the requested year', async () => {
      expect(await sectionIds(teacher)).toEqual([ids.sectionA]);
      expect((await sectionIds(multi)).sort()).toEqual([ids.sectionB, ids.sectionC].sort());
      expect(await sectionIds(unassigned)).toEqual([]);
      expect(await sectionIds(teacher, ids.oldYear)).toEqual([ids.sectionOld]);
    });

    it('keeps institute-wide options for broader access', async () => {
      expect((await sectionIds(admin)).sort()).toEqual(
        [ids.sectionA, ids.sectionB, ids.sectionC].sort(),
      );
      expect(await sectionIds(foreignAdmin)).toEqual([]);
    });
  });

  describe('date summary', () => {
    it('counts only the selected authorized section', async () => {
      expect(await summary(teacher, { sectionId: ids.sectionA, academicYearId: ids.year })).toEqual(
        { sessionCount: 1, studentCount: 1, counts: [{ status: 'PRESENT', count: 1 }] },
      );
      expect(await summary(multi, { sectionId: ids.sectionB, academicYearId: ids.year })).toEqual({
        sessionCount: 1,
        studentCount: 1,
        counts: [{ status: 'ABSENT', count: 1 }],
      });
    });

    it('never widens beyond authorized sections when filters are omitted or tampered', async () => {
      expect(await summary(teacher, { academicYearId: ids.year })).toEqual({
        sessionCount: 1,
        studentCount: 1,
        counts: [{ status: 'PRESENT', count: 1 }],
      });
      expect(await summary(teacher, { sectionId: ids.sectionB })).toEqual({
        sessionCount: 0,
        studentCount: 0,
        counts: [],
      });
      expect(await summary(unassigned)).toEqual({ sessionCount: 0, studentCount: 0, counts: [] });
    });

    it('reports marks per session separately from distinct students', async () => {
      const result = await summary(multi, { sectionId: ids.sectionC });
      expect(result.sessionCount).toBe(2);
      expect(result.studentCount).toBe(1);
      expect([...result.counts].sort((x, y) => x.status.localeCompare(y.status))).toEqual([
        { status: 'ABSENT', count: 1 },
        { status: 'PRESENT', count: 1 },
      ]);
    });

    it('separates academic years', async () => {
      expect(await summary(teacher, { academicYearId: ids.oldYear })).toEqual({
        sessionCount: 1,
        studentCount: 1,
        counts: [{ status: 'LEAVE', count: 1 }],
      });
      const all = await summary(admin, { academicYearId: ids.year });
      expect(all.sessionCount).toBe(4);
      expect(all.studentCount).toBe(3);
    });
  });

  describe('session reads', () => {
    it('hides another section and another institute from session lookups', async () => {
      const lists = await query<{ attendanceSessionsForSection: { id: string }[] }>(
        teacher,
        'query($s: ID!, $d: String!) { attendanceSessionsForSection(sectionId: $s, startDate: $d, endDate: $d) { id } }',
        { s: ids.sectionB, d: TODAY },
      );
      expect(lists.attendanceSessionsForSection).toEqual([]);
      for (const sessionId of [ids.sessionB, ids.sessionForeign]) {
        for (const source of [
          'query($id: ID!) { attendanceSession(id: $id) { id } }',
          'query($id: ID!) { attendanceEntries(sessionId: $id) { id } }',
          'query($id: ID!) { attendanceCounts(sessionId: $id) { count } }',
        ]) {
          expect(await errorCodes(teacher, source, { id: sessionId })).toEqual([
            'ATTENDANCE_SESSION_NOT_FOUND',
          ]);
        }
      }
    });

    it('returns the assigned section session and its entries', async () => {
      const data = await query<{ attendanceEntries: { studentId: string }[] }>(
        teacher,
        'query($id: ID!) { attendanceEntries(sessionId: $id) { studentId } }',
        { id: ids.sessionA },
      );
      expect(data.attendanceEntries).toEqual([{ studentId: studentA.membershipId }]);
    });
  });

  describe('reports', () => {
    const absentees =
      'query($s: ID, $d: String!) { attendanceAbsenteesReport(sectionId: $s, startDate: $d, endDate: $d) { studentId absentCount } }';
    const breakdown =
      'query($d: String!, $std: ID) { attendanceSectionDailyBreakdown(date: $d, standardId: $std) { sectionId absenteeIds } }';
    const history =
      'query($id: ID!, $d: String!) { attendanceStudentHistory(studentId: $id, startDate: $d, endDate: $d) { sectionId status } }';

    it('limits absentee rows to authorized sections', async () => {
      type Rows = { attendanceAbsenteesReport: { studentId: string }[] };
      const own = await query<Rows>(teacher, absentees, { s: null, d: TODAY });
      expect(own.attendanceAbsenteesReport.map((row) => row.studentId).sort()).toEqual(
        [studentA.membershipId, studentOld.membershipId].sort(),
      );
      const tampered = await query<Rows>(teacher, absentees, { s: ids.sectionB, d: TODAY });
      expect(tampered.attendanceAbsenteesReport).toEqual([]);
      const all = await query<Rows>(admin, absentees, { s: null, d: TODAY });
      expect(all.attendanceAbsenteesReport).toHaveLength(4);
    });

    it('limits daily breakdown rows and absentee ids', async () => {
      type Rows = {
        attendanceSectionDailyBreakdown: { sectionId: string; absenteeIds: string[] }[];
      };
      const own = await query<Rows>(teacher, breakdown, { d: TODAY, std: null });
      expect(own.attendanceSectionDailyBreakdown.map((row) => row.sectionId).sort()).toEqual(
        [ids.sectionA, ids.sectionOld].sort(),
      );
      expect(own.attendanceSectionDailyBreakdown.flatMap((row) => row.absenteeIds)).toEqual([]);
      const unassignedRows = await query<Rows>(unassigned, breakdown, { d: TODAY, std: null });
      expect(unassignedRows.attendanceSectionDailyBreakdown).toEqual([]);
      const all = await query<Rows>(admin, breakdown, { d: TODAY, std: null });
      expect(all.attendanceSectionDailyBreakdown).toHaveLength(5);
    });

    it('limits another student history to authorized sections', async () => {
      type Rows = { attendanceStudentHistory: { sectionId: string }[] };
      const other = await query<Rows>(teacher, history, { id: studentB.membershipId, d: TODAY });
      expect(other.attendanceStudentHistory).toEqual([]);
      const foreign = await query<Rows>(admin, history, {
        id: studentForeign.membershipId,
        d: TODAY,
      });
      expect(foreign.attendanceStudentHistory).toEqual([]);
      const own = await query<Rows>(teacher, history, { id: studentA.membershipId, d: TODAY });
      expect(own.attendanceStudentHistory).toEqual([
        { sectionId: ids.sectionA, status: 'PRESENT' },
      ]);
    });
  });

  describe('writes', () => {
    const mark =
      'mutation($s: ID!, $st: ID!) { markAttendance(input: { sessionId: $s, studentId: $st, status: PRESENT }) { status } }';
    const bulk =
      'mutation($s: ID!, $st: ID!) { bulkMarkAttendance(input: { sessionId: $s, entries: [{ studentId: $st, status: PRESENT }] }) { status } }';
    const open =
      'mutation($s: ID!, $y: ID!, $d: String!, $l: ID!) { openAttendanceSession(input: { sectionId: $s, academicYearId: $y, date: $d, period: 7, lecturerId: $l }) { id } }';

    it('rejects direct writes to another section without changing data', async () => {
      const variables = { s: ids.sessionB, st: studentB.membershipId };
      expect(await errorCodes(teacher, mark, variables)).toEqual(['ATTENDANCE_SESSION_NOT_FOUND']);
      expect(await errorCodes(teacher, bulk, variables)).toEqual(['ATTENDANCE_SESSION_NOT_FOUND']);
      expect(
        await errorCodes(
          teacher,
          'mutation($id: ID!, $l: ID!) { overrideAttendanceSession(sessionId: $id, lecturerId: $l) { id } }',
          { id: ids.sessionB, l: teacher.membershipId },
        ),
      ).toEqual(['ATTENDANCE_SESSION_NOT_FOUND']);
      expect(
        await errorCodes(teacher, 'mutation($id: ID!) { deleteAttendanceSession(id: $id) }', {
          id: ids.sessionB,
        }),
      ).toEqual(['ATTENDANCE_SESSION_NOT_FOUND']);
      expect(
        await errorCodes(teacher, open, {
          s: ids.sectionB,
          y: ids.year,
          d: TODAY,
          l: teacher.membershipId,
        }),
      ).toEqual(['FORBIDDEN']);
      expect(await storedStatus(ids.sessionB, studentB)).toEqual(['ABSENT']);
    });

    it('rejects marking a student from another section into an assigned session', async () => {
      expect(
        await errorCodes(teacher, mark, { s: ids.sessionA, st: studentB.membershipId }),
      ).toEqual(['FORBIDDEN']);
      expect(await storedStatus(ids.sessionA, studentB)).toEqual([]);
    });

    it('rejects opening a session with an academic year that does not own the section', async () => {
      expect(
        await errorCodes(teacher, open, {
          s: ids.sectionA,
          y: ids.oldYear,
          d: TODAY,
          l: teacher.membershipId,
        }),
      ).toEqual(['SECTION_NOT_FOUND']);
    });

    it('lets the other section owner change B without changing A totals', async () => {
      await query(multi, mark, { s: ids.sessionB, st: studentB.membershipId });
      expect(await summary(teacher, { sectionId: ids.sectionA })).toEqual({
        sessionCount: 1,
        studentCount: 1,
        counts: [{ status: 'PRESENT', count: 1 }],
      });
      expect(await summary(multi, { sectionId: ids.sectionB })).toEqual({
        sessionCount: 1,
        studentCount: 1,
        counts: [{ status: 'PRESENT', count: 1 }],
      });
    });

    it('allows the assigned teacher to mark their own section', async () => {
      const data = await query<{ markAttendance: { status: string } }>(teacher, mark, {
        s: ids.sessionA,
        st: studentA.membershipId,
      });
      expect(data.markAttendance.status).toBe('PRESENT');
    });

    it('accepts bulk marks for the assigned section', async () => {
      const data = await query<{ bulkMarkAttendance: { status: string }[] }>(teacher, bulk, {
        s: ids.sessionA,
        st: studentA.membershipId,
      });
      expect(data.bulkMarkAttendance).toEqual([{ status: 'PRESENT' }]);
    });
  });

  describe('guardians', () => {
    it('sees only the linked child attendance, even with omitted or tampered filters', async () => {
      expect(await sectionIds(parent)).toEqual([ids.sectionA]);
      expect(await summary(parent)).toEqual({
        sessionCount: 1,
        studentCount: 1,
        counts: [{ status: 'PRESENT', count: 1 }],
      });
      expect(await summary(parent, { sectionId: ids.sectionB })).toEqual({
        sessionCount: 0,
        studentCount: 0,
        counts: [],
      });
      type History = { attendanceStudentHistory: { status: string }[] };
      const history =
        'query($id: ID!, $d: String!) { attendanceStudentHistory(studentId: $id, startDate: $d, endDate: $d) { status } }';
      const other = await query<History>(parent, history, { id: studentB.membershipId, d: TODAY });
      expect(other.attendanceStudentHistory).toEqual([]);
      const own = await query<History>(parent, history, { id: studentA.membershipId, d: TODAY });
      expect(own.attendanceStudentHistory).toEqual([{ status: 'PRESENT' }]);
      expect(
        await errorCodes(parent, 'query($id: ID!) { attendanceEntries(sessionId: $id) { id } }', {
          id: ids.sessionB,
        }),
      ).toEqual(['ATTENDANCE_SESSION_NOT_FOUND']);
    });

    it('sees nothing without a linked child', async () => {
      expect(await sectionIds(unlinkedParent)).toEqual([]);
      expect(await summary(unlinkedParent)).toEqual({
        sessionCount: 0,
        studentCount: 0,
        counts: [],
      });
      const rows = await query<{ attendanceAbsenteesReport: unknown[] }>(
        unlinkedParent,
        'query($d: String!) { attendanceAbsenteesReport(sectionId: null, startDate: $d, endDate: $d) { studentId } }',
        { d: TODAY },
      );
      expect(rows.attendanceAbsenteesReport).toEqual([]);
    });
  });

  it('rejects platform-scope tokens', async () => {
    const response = await gqlRequest(app.httpServer, {
      token: createPlatformToken({
        sub: admin.userId,
        membershipId: admin.membershipId,
        roleId: admin.roleId,
      }),
      query: 'query($y: ID!) { attendanceSections(academicYearId: $y) { id } }',
      variables: { y: ids.year },
    });
    expect(response.errors?.map((error) => error.extensions?.code)).toEqual(['FORBIDDEN']);
  });
});
