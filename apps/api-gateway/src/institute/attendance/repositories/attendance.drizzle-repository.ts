import { Inject, Injectable } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  attendanceEntries,
  attendanceEntriesLive,
  attendanceSessions,
  attendanceSessionsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  membershipsLive,
  mkInstituteCtx,
  sectionsLive,
  softDelete,
  standardsLive,
  studentAcademicsLive,
  studentProfilesLive,
  subjectsLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import {
  and,
  asc,
  between,
  count,
  countDistinct,
  desc,
  eq,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import { AttendanceRepository } from './attendance.repository';
import { entryInScope, sectionInScope, sessionInScope } from './attendance-scope';
import type {
  AbsenteeReportRow,
  AbsenteesReportQuery,
  AttendanceEntryRecord,
  AttendanceSectionRow,
  AttendanceSectionScope,
  AttendanceSessionRecord,
  CreateSessionData,
  DateSummaryQuery,
  DateSummaryRow,
  SectionDailyBreakdownQuery,
  SectionDailyBreakdownRow,
  SessionDateRangeQuery,
  SessionQuery,
  StudentHistoryQuery,
  StudentHistoryRow,
  UpsertEntryData,
} from './types';

// Read projection — pulls from `attendance_sessions_live` (security_invoker
// view that hides soft-deleted rows). INSERT … RETURNING and
// UPDATE … RETURNING below target the base `attendanceSessions` table since
// views can't be used as RETURNING targets.
const sessionLiveColumns = {
  id: attendanceSessionsLive.id,
  tenantId: attendanceSessionsLive.tenantId,
  sectionId: attendanceSessionsLive.sectionId,
  academicYearId: attendanceSessionsLive.academicYearId,
  date: attendanceSessionsLive.date,
  period: attendanceSessionsLive.period,
  subjectId: attendanceSessionsLive.subjectId,
  lecturerId: attendanceSessionsLive.lecturerId,
  overrideCheck: attendanceSessionsLive.overrideCheck,
  createdAt: attendanceSessionsLive.createdAt,
  updatedAt: attendanceSessionsLive.updatedAt,
} as const;

// Mirror projection against the base table for INSERT/UPDATE … RETURNING.
const sessionWriteReturning = {
  id: attendanceSessions.id,
  tenantId: attendanceSessions.tenantId,
  sectionId: attendanceSessions.sectionId,
  academicYearId: attendanceSessions.academicYearId,
  date: attendanceSessions.date,
  period: attendanceSessions.period,
  subjectId: attendanceSessions.subjectId,
  lecturerId: attendanceSessions.lecturerId,
  overrideCheck: attendanceSessions.overrideCheck,
  createdAt: attendanceSessions.createdAt,
  updatedAt: attendanceSessions.updatedAt,
} as const;

const entryLiveColumns = {
  id: attendanceEntriesLive.id,
  tenantId: attendanceEntriesLive.tenantId,
  sessionId: attendanceEntriesLive.sessionId,
  studentId: attendanceEntriesLive.studentId,
  status: attendanceEntriesLive.status,
  mode: attendanceEntriesLive.mode,
  remarks: attendanceEntriesLive.remarks,
  markedAt: attendanceEntriesLive.markedAt,
  createdAt: attendanceEntriesLive.createdAt,
  updatedAt: attendanceEntriesLive.updatedAt,
} as const;

const entryWriteReturning = {
  id: attendanceEntries.id,
  tenantId: attendanceEntries.tenantId,
  sessionId: attendanceEntries.sessionId,
  studentId: attendanceEntries.studentId,
  status: attendanceEntries.status,
  mode: attendanceEntries.mode,
  remarks: attendanceEntries.remarks,
  markedAt: attendanceEntries.markedAt,
  createdAt: attendanceEntries.createdAt,
  updatedAt: attendanceEntries.updatedAt,
} as const;

const countWhere = (condition: SQL | undefined) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

@Injectable()
export class AttendanceDrizzleRepository extends AttendanceRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async findSessionById(
    id: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord | null> {
    return withTenant(this.db, access.user, async (tx) => {
      const rows = await tx
        .select(sessionLiveColumns)
        .from(attendanceSessionsLive)
        .where(
          and(
            eq(attendanceSessionsLive.id, id),
            sessionInScope(access.ability, 'read', attendanceSessionsLive.id),
          ),
        );
      return (rows[0] as AttendanceSessionRecord | undefined) ?? null;
    });
  }

  async findSession(query: SessionQuery): Promise<AttendanceSessionRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const periodCondition =
        query.period === undefined || query.period === null
          ? isNull(attendanceSessionsLive.period)
          : eq(attendanceSessionsLive.period, query.period);
      const rows = await tx
        .select(sessionLiveColumns)
        .from(attendanceSessionsLive)
        .where(
          and(
            eq(attendanceSessionsLive.sectionId, query.sectionId),
            eq(attendanceSessionsLive.date, query.date),
            periodCondition,
          ),
        );
      return (rows[0] as AttendanceSessionRecord | undefined) ?? null;
    });
  }

  async findSessionsInRange(
    query: SessionDateRangeQuery,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord[]> {
    return withTenant(this.db, access.user, async (tx) => {
      const conditions = [
        between(attendanceSessionsLive.date, query.startDate, query.endDate),
        sessionInScope(access.ability, 'read', attendanceSessionsLive.id),
      ];
      if (query.sectionId) conditions.push(eq(attendanceSessionsLive.sectionId, query.sectionId));
      return tx
        .select(sessionLiveColumns)
        .from(attendanceSessionsLive)
        .where(and(...conditions)) as Promise<AttendanceSessionRecord[]>;
    });
  }

  async findMissingSessionRef(refs: {
    lecturerId?: string;
    subjectId?: string | null;
  }): Promise<'lecturer' | 'subject' | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      if (refs.lecturerId) {
        const [row] = await tx
          .select({ id: membershipsLive.id })
          .from(membershipsLive)
          .where(eq(membershipsLive.id, refs.lecturerId))
          .limit(1);
        if (!row) return 'lecturer';
      }
      if (refs.subjectId) {
        const [row] = await tx
          .select({ id: subjectsLive.id })
          .from(subjectsLive)
          .where(eq(subjectsLive.id, refs.subjectId))
          .limit(1);
        if (!row) return 'subject';
      }
      return null;
    });
  }

  async findSectionScope(sectionId: string): Promise<AttendanceSectionScope | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const rows = await tx
        .select({
          sectionId: sectionsLive.id,
          standardId: sectionsLive.standardId,
          academicYearId: sectionsLive.academicYearId,
        })
        .from(sectionsLive)
        .where(eq(sectionsLive.id, sectionId));
      return rows[0] ?? null;
    });
  }

  async listSections(
    academicYearId: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceSectionRow[]> {
    return withTenant(this.db, access.user, async (tx) =>
      tx
        .select({
          id: sectionsLive.id,
          name: sectionsLive.name,
          displayLabel: sectionsLive.displayLabel,
          standardId: sectionsLive.standardId,
          standardName: standardsLive.name,
          classTeacherId: sectionsLive.classTeacherId,
        })
        .from(sectionsLive)
        .innerJoin(standardsLive, eq(standardsLive.id, sectionsLive.standardId))
        .where(
          and(
            eq(sectionsLive.academicYearId, academicYearId),
            sectionInScope(access.ability, 'read', sectionsLive.id),
          ),
        )
        .orderBy(
          asc(standardsLive.numericOrder),
          asc(sectionsLive.displayOrder),
          asc(sectionsLive.id),
        ),
    );
  }

  async isStudentInSession(session: AttendanceSessionRecord, studentId: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const marked = await tx
        .select({ id: attendanceEntriesLive.id })
        .from(attendanceEntriesLive)
        .where(
          and(
            eq(attendanceEntriesLive.sessionId, session.id),
            eq(attendanceEntriesLive.studentId, studentId),
          ),
        )
        .limit(1);
      if (marked.length > 0) return true;
      const enrolled = await tx
        .select({ id: studentAcademicsLive.id })
        .from(studentAcademicsLive)
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
        )
        .where(
          and(
            eq(studentProfilesLive.membershipId, studentId),
            eq(studentAcademicsLive.sectionId, session.sectionId),
            eq(studentAcademicsLive.academicYearId, session.academicYearId),
          ),
        )
        .limit(1);
      return enrolled.length > 0;
    });
  }

  async createSession(data: CreateSessionData): Promise<AttendanceSessionRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const rows = await tx
        .insert(attendanceSessions)
        .values({
          tenantId,
          sectionId: data.sectionId,
          academicYearId: data.academicYearId,
          date: data.date,
          period: data.period ?? null,
          subjectId: data.subjectId ?? null,
          lecturerId: data.lecturerId,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(sessionWriteReturning);
      return rows[0] as AttendanceSessionRecord;
    });
  }

  async assignLecturer(sessionId: string, lecturerId: string): Promise<AttendanceSessionRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const rows = await tx
        .update(attendanceSessions)
        .set({ lecturerId, updatedBy: userId })
        .where(and(eq(attendanceSessions.id, sessionId), isNull(attendanceSessions.deletedAt)))
        .returning(sessionWriteReturning);
      if (rows.length === 0)
        throw new BusinessException(
          ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
          `Attendance session ${sessionId} not found`,
        );
      return rows[0] as AttendanceSessionRecord;
    });
  }

  async setSubject(sessionId: string, subjectId: string | null): Promise<AttendanceSessionRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const rows = await tx
        .update(attendanceSessions)
        .set({ subjectId, updatedBy: userId })
        .where(and(eq(attendanceSessions.id, sessionId), isNull(attendanceSessions.deletedAt)))
        .returning(sessionWriteReturning);
      if (rows.length === 0)
        throw new BusinessException(
          ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
          `Attendance session ${sessionId} not found`,
        );
      return rows[0] as AttendanceSessionRecord;
    });
  }

  async findEntriesBySession(
    sessionId: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord[]> {
    return withTenant(this.db, access.user, async (tx) => {
      return tx
        .select(entryLiveColumns)
        .from(attendanceEntriesLive)
        .where(
          and(
            eq(attendanceEntriesLive.sessionId, sessionId),
            entryInScope(access.ability, 'read', attendanceEntriesLive.id),
          ),
        ) as Promise<AttendanceEntryRecord[]>;
    });
  }

  async findEntry(sessionId: string, studentId: string): Promise<AttendanceEntryRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const rows = await tx
        .select(entryLiveColumns)
        .from(attendanceEntriesLive)
        .where(
          and(
            eq(attendanceEntriesLive.sessionId, sessionId),
            eq(attendanceEntriesLive.studentId, studentId),
          ),
        );
      return (rows[0] as AttendanceEntryRecord | undefined) ?? null;
    });
  }

  async bulkInsertEntries(
    entries: Array<Omit<UpsertEntryData, 'sessionId'> & { sessionId: string }>,
  ): Promise<AttendanceEntryRecord[]> {
    if (entries.length === 0) return [];
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      return tx
        .insert(attendanceEntries)
        .values(
          entries.map((entry) => ({
            tenantId,
            sessionId: entry.sessionId,
            studentId: entry.studentId,
            status: entry.status,
            mode: entry.mode ?? 'MANUAL',
            remarks: entry.remarks ?? null,
            createdBy: userId,
            updatedBy: userId,
          })),
        )
        .returning(entryWriteReturning) as Promise<AttendanceEntryRecord[]>;
    });
  }

  async upsertEntry(data: UpsertEntryData): Promise<AttendanceEntryRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      const existing = await tx
        .select(entryLiveColumns)
        .from(attendanceEntriesLive)
        .where(
          and(
            eq(attendanceEntriesLive.sessionId, data.sessionId),
            eq(attendanceEntriesLive.studentId, data.studentId),
          ),
        );

      if (existing.length > 0) {
        const rows = await tx
          .update(attendanceEntries)
          .set({
            status: data.status,
            ...(data.mode !== undefined && { mode: data.mode }),
            ...(data.remarks !== undefined && { remarks: data.remarks }),
            markedAt: new Date(),
            updatedBy: userId,
          })
          .where(
            and(
              eq(attendanceEntries.id, (existing[0] as AttendanceEntryRecord).id),
              isNull(attendanceEntries.deletedAt),
            ),
          )
          .returning(entryWriteReturning);
        return rows[0] as AttendanceEntryRecord;
      }

      const rows = await tx
        .insert(attendanceEntries)
        .values({
          tenantId,
          sessionId: data.sessionId,
          studentId: data.studentId,
          status: data.status,
          mode: data.mode ?? 'MANUAL',
          remarks: data.remarks ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(entryWriteReturning);
      return rows[0] as AttendanceEntryRecord;
    });
  }

  async countByStatus(
    sessionId: string,
    access: InstituteReadAccess,
  ): Promise<Record<string, number>> {
    return withTenant(this.db, access.user, async (tx) => {
      const rows = await tx
        .select({
          status: attendanceEntriesLive.status,
          count: count(),
        })
        .from(attendanceEntriesLive)
        .where(
          and(
            eq(attendanceEntriesLive.sessionId, sessionId),
            entryInScope(access.ability, 'read', attendanceEntriesLive.id),
          ),
        )
        .groupBy(attendanceEntriesLive.status);
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    });
  }

  async dateSummary(query: DateSummaryQuery, access: InstituteReadAccess): Promise<DateSummaryRow> {
    const sessionFilter = and(
      eq(attendanceSessionsLive.date, query.date),
      query.sectionId ? eq(attendanceSessionsLive.sectionId, query.sectionId) : undefined,
      query.academicYearId
        ? eq(attendanceSessionsLive.academicYearId, query.academicYearId)
        : undefined,
    );
    const entryFilter = and(
      sessionFilter,
      entryInScope(access.ability, 'read', attendanceEntriesLive.id),
    );
    return withTenant(this.db, access.user, async (tx) => {
      const [sessions] = await tx
        .select({ total: count() })
        .from(attendanceSessionsLive)
        .where(
          and(sessionFilter, sessionInScope(access.ability, 'read', attendanceSessionsLive.id)),
        );
      const [students] = await tx
        .select({ total: countDistinct(attendanceEntriesLive.studentId) })
        .from(attendanceEntriesLive)
        .innerJoin(
          attendanceSessionsLive,
          eq(attendanceSessionsLive.id, attendanceEntriesLive.sessionId),
        )
        .where(entryFilter);
      const marks = await tx
        .select({ status: attendanceEntriesLive.status, total: count() })
        .from(attendanceEntriesLive)
        .innerJoin(
          attendanceSessionsLive,
          eq(attendanceSessionsLive.id, attendanceEntriesLive.sessionId),
        )
        .where(entryFilter)
        .groupBy(attendanceEntriesLive.status);
      return {
        sessionCount: sessions?.total ?? 0,
        studentCount: students?.total ?? 0,
        counts: Object.fromEntries(marks.map((row) => [row.status, row.total])),
      };
    });
  }

  async absenteesReport(
    query: AbsenteesReportQuery,
    access: InstituteReadAccess,
  ): Promise<AbsenteeReportRow[]> {
    const status = attendanceEntriesLive.status;
    return withTenant(this.db, access.user, async (tx) => {
      const rows = await tx
        .select({
          studentId: attendanceEntriesLive.studentId,
          totalSessions: count(),
          presentCount: countWhere(eq(status, 'PRESENT')),
          absentCount: countWhere(eq(status, 'ABSENT')),
          leaveCount: countWhere(eq(status, 'LEAVE')),
          lateCount: countWhere(eq(status, 'LATE')),
          absentDates: sql<string[]>`coalesce(
            array_agg(distinct ${attendanceSessionsLive.date}::text order by ${attendanceSessionsLive.date}::text)
              filter (where ${eq(status, 'ABSENT')}),
            array[]::text[]
          )`,
        })
        .from(attendanceSessionsLive)
        .innerJoin(
          attendanceEntriesLive,
          eq(attendanceEntriesLive.sessionId, attendanceSessionsLive.id),
        )
        .innerJoin(sectionsLive, eq(sectionsLive.id, attendanceSessionsLive.sectionId))
        .where(
          and(
            between(attendanceSessionsLive.date, query.startDate, query.endDate),
            query.sectionId ? eq(attendanceSessionsLive.sectionId, query.sectionId) : undefined,
            query.standardId ? eq(sectionsLive.standardId, query.standardId) : undefined,
            entryInScope(access.ability, 'read', attendanceEntriesLive.id),
          ),
        )
        .groupBy(attendanceEntriesLive.studentId)
        .orderBy(asc(attendanceEntriesLive.studentId));
      return rows;
    });
  }

  async sectionDailyBreakdown(
    query: SectionDailyBreakdownQuery,
    access: InstituteReadAccess,
  ): Promise<SectionDailyBreakdownRow[]> {
    const status = attendanceEntriesLive.status;
    return withTenant(this.db, access.user, async (tx) => {
      const rows = await tx
        .select({
          sessionId: attendanceSessionsLive.id,
          sectionId: attendanceSessionsLive.sectionId,
          sectionName: sectionsLive.name,
          period: attendanceSessionsLive.period,
          subjectId: attendanceSessionsLive.subjectId,
          lecturerId: attendanceSessionsLive.lecturerId,
          presentCount: countWhere(eq(status, 'PRESENT')),
          absentCount: countWhere(eq(status, 'ABSENT')),
          leaveCount: countWhere(eq(status, 'LEAVE')),
          lateCount: countWhere(eq(status, 'LATE')),
          absenteeIds: sql<string[]>`coalesce(
            array_agg(${attendanceEntriesLive.studentId}) filter (where ${eq(status, 'ABSENT')}),
            array[]::uuid[]
          )`,
        })
        .from(attendanceSessionsLive)
        .leftJoin(
          attendanceEntriesLive,
          and(
            eq(attendanceEntriesLive.sessionId, attendanceSessionsLive.id),
            entryInScope(access.ability, 'read', attendanceEntriesLive.id),
          ),
        )
        .innerJoin(sectionsLive, eq(sectionsLive.id, attendanceSessionsLive.sectionId))
        .where(
          and(
            eq(attendanceSessionsLive.date, query.date),
            query.standardId ? eq(sectionsLive.standardId, query.standardId) : undefined,
            sessionInScope(access.ability, 'read', attendanceSessionsLive.id),
          ),
        )
        .groupBy(
          attendanceSessionsLive.id,
          attendanceSessionsLive.sectionId,
          sectionsLive.name,
          attendanceSessionsLive.period,
          attendanceSessionsLive.subjectId,
          attendanceSessionsLive.lecturerId,
        )
        .orderBy(
          asc(attendanceSessionsLive.sectionId),
          sql`${attendanceSessionsLive.period} asc nulls first`,
        );
      return rows;
    });
  }

  async studentHistory(
    query: StudentHistoryQuery,
    access: InstituteReadAccess,
  ): Promise<StudentHistoryRow[]> {
    return withTenant(this.db, access.user, async (tx) =>
      tx
        .select({
          sessionId: attendanceSessionsLive.id,
          sectionId: attendanceSessionsLive.sectionId,
          date: attendanceSessionsLive.date,
          period: attendanceSessionsLive.period,
          subjectId: attendanceSessionsLive.subjectId,
          status: attendanceEntriesLive.status,
          remarks: attendanceEntriesLive.remarks,
          markedAt: attendanceEntriesLive.markedAt,
        })
        .from(attendanceEntriesLive)
        .innerJoin(
          attendanceSessionsLive,
          eq(attendanceSessionsLive.id, attendanceEntriesLive.sessionId),
        )
        .where(
          and(
            eq(attendanceEntriesLive.studentId, query.studentId),
            between(attendanceSessionsLive.date, query.startDate, query.endDate),
            entryInScope(access.ability, 'read', attendanceEntriesLive.id),
          ),
        )
        .orderBy(
          desc(attendanceSessionsLive.date),
          sql`${attendanceSessionsLive.period} asc nulls first`,
        ),
    );
  }

  async softDeleteSession(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:attendance'), async (tx) => {
      await softDelete(tx, attendanceSessions, id);
    });
  }
}
