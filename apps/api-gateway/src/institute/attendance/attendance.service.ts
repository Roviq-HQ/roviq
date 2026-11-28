import { subject } from '@casl/ability';
import { Injectable, Logger } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import {
  AcademicStatus,
  type AppAction,
  AttendanceStatus,
  BusinessException,
  ErrorCode,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { HolidayService } from '../holiday/holiday.service';
import { LeaveService } from '../leave/leave.service';
import { StudentService } from '../student/student.service';
import type { CreateAttendanceSessionInput } from './dto/create-attendance-session.input';
import type { BulkMarkAttendanceInput, MarkAttendanceInput } from './dto/mark-attendance.input';
import { AttendanceRepository } from './repositories/attendance.repository';
import type {
  AbsenteeReportRow,
  AbsenteesReportQuery,
  AttendanceEntryRecord,
  AttendanceSectionRow,
  AttendanceSectionScope,
  AttendanceSessionRecord,
  DateSummaryQuery,
  SectionDailyBreakdownQuery,
  SectionDailyBreakdownRow,
  StudentHistoryRow,
} from './repositories/types';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly repo: AttendanceRepository,
    private readonly studentService: StudentService,
    private readonly leaveService: LeaveService,
    private readonly holidayService: HolidayService,
    private readonly eventBus: EventBusService,
  ) {}

  async findSession(id: string, access: InstituteReadAccess): Promise<AttendanceSessionRecord> {
    const session = await this.repo.findSessionById(id, access);
    if (!session) {
      throw new BusinessException(
        ErrorCode.ATTENDANCE_SESSION_NOT_FOUND,
        `Attendance session ${id} not found`,
      );
    }
    return session;
  }

  async findEntries(sessionId: string, access: InstituteReadAccess) {
    await this.findSession(sessionId, access);
    return this.repo.findEntriesBySession(sessionId, access);
  }

  async findSessionsForSection(
    sectionId: string,
    startDate: string,
    endDate: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord[]> {
    return this.repo.findSessionsInRange({ sectionId, startDate, endDate }, access);
  }

  listSections(
    academicYearId: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceSectionRow[]> {
    return this.repo.listSections(academicYearId, access);
  }

  private async sectionScope(sectionId: string): Promise<AttendanceSectionScope> {
    const scope = await this.repo.findSectionScope(sectionId);
    if (!scope) {
      throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, `Section ${sectionId} not found`);
    }
    return scope;
  }

  private authorize(
    access: InstituteReadAccess,
    action: AppAction,
    fields: AttendanceSectionScope & { lecturerId: string; date: string; studentId?: string },
  ): void {
    const record = subject('Attendance', { tenantId: access.user.tenantId, ...fields });
    if (!access.ability.can(action, record)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Not authorized for attendance in this section',
      );
    }
  }

  /** Any write to a past-dated session (create, mark, reassign, delete) needs its own grant. */
  private assertPastDayPermission(
    access: InstituteReadAccess,
    fields: AttendanceSectionScope & { lecturerId: string; date: string },
  ): boolean {
    if (!this.isPastDate(fields.date)) return false;
    const record = subject('AttendanceOverride', { tenantId: access.user.tenantId, ...fields });
    if (!access.ability.can('update', record)) {
      throw new BusinessException(
        ErrorCode.ATTENDANCE_OVERRIDE_FORBIDDEN,
        'Past-day attendance edits require the AttendanceOverride permission',
      );
    }
    return true;
  }

  /** Marking also requires the caller to opt in explicitly before touching a past day. */
  private async assertEditWindow(
    access: InstituteReadAccess,
    session: AttendanceSessionRecord,
    overridePastDay: boolean,
  ): Promise<boolean> {
    if (!this.isPastDate(session.date)) return false;
    if (!overridePastDay) {
      throw new BusinessException(
        ErrorCode.ATTENDANCE_EDIT_WINDOW_CLOSED,
        'Attendance for past dates can only be edited with explicit admin override.',
      );
    }
    const scope = await this.sectionScope(session.sectionId);
    return this.assertPastDayPermission(access, {
      ...scope,
      lecturerId: session.lecturerId,
      date: session.date,
    });
  }

  private async authorizeSession(
    access: InstituteReadAccess,
    action: AppAction,
    session: AttendanceSessionRecord,
    studentId?: string,
  ): Promise<AttendanceSectionScope> {
    const scope = await this.sectionScope(session.sectionId);
    this.authorize(access, action, {
      ...scope,
      lecturerId: session.lecturerId,
      date: session.date,
      ...(studentId !== undefined && { studentId }),
    });
    return scope;
  }

  private async assertStudentInSession(
    session: AttendanceSessionRecord,
    studentId: string,
  ): Promise<void> {
    if (!(await this.repo.isStudentInSession(session, studentId))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Student is not enrolled in this attendance session section',
      );
    }
  }

  async openSession(
    input: CreateAttendanceSessionInput,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord> {
    const scope = await this.sectionScope(input.sectionId);
    if (scope.academicYearId !== input.academicYearId) {
      throw new BusinessException(
        ErrorCode.SECTION_NOT_FOUND,
        `Section ${input.sectionId} not found in academic year ${input.academicYearId}`,
      );
    }
    this.authorize(access, 'create', {
      ...scope,
      lecturerId: input.lecturerId,
      date: input.date,
    });
    await this.assertSessionRefs({ lecturerId: input.lecturerId, subjectId: input.subjectId });
    const existing = await this.repo.findSession({
      sectionId: input.sectionId,
      date: input.date,
      period: input.period ?? null,
    });

    if (existing) {
      if (existing.lecturerId !== input.lecturerId) {
        throw new BusinessException(
          ErrorCode.ATTENDANCE_SLOT_TAKEN,
          `Attendance for this slot already taken by another lecturer. Override required.`,
        );
      }
      return existing;
    }

    this.assertPastDayPermission(access, {
      ...scope,
      lecturerId: input.lecturerId,
      date: input.date,
    });

    // Refuse to open a session on a declared holiday. This runs *after* the
    // idempotence check so re-opening an already-existing session on what
    // later became a holiday still returns the existing record. Admin
    // override is intentionally out of scope — keep it strict.
    const holidaysOnDate = await this.holidayService.onDate(input.date);
    if (holidaysOnDate.length > 0) {
      const holidayNames = holidaysOnDate
        .map((h) => h.name.en ?? Object.values(h.name)[0] ?? 'unnamed')
        .join(', ');
      throw new BusinessException(
        ErrorCode.ATTENDANCE_ON_HOLIDAY,
        `Attendance cannot be taken on a holiday: ${holidayNames}`,
      );
    }

    const session = await this.repo.createSession({
      sectionId: input.sectionId,
      academicYearId: input.academicYearId,
      date: input.date,
      period: input.period ?? null,
      subjectId: input.subjectId ?? null,
      lecturerId: input.lecturerId,
    });

    // Auto-seed: every active student of the section starts PRESENT (or
    // LEAVE if an approved leave covers this date). Teachers then only have
    // to flip absentees / latecomers. Mirrors the paper-register workflow.
    await this.seedPresentEntries(session);

    this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_SESSION.opened, {
      sessionId: session.id,
      tenantId: session.tenantId,
      sectionId: session.sectionId,
      date: session.date,
      period: session.period,
    });

    return session;
  }

  private async seedPresentEntries(session: AttendanceSessionRecord): Promise<void> {
    const { id: sessionId, sectionId, academicYearId, date } = session;
    // Paginate defensively in case a section grows beyond 1000 students.
    const PAGE_SIZE = 1000;
    const membershipIds: string[] = [];
    let after: string | undefined;
    // Loop guard — even a huge tenant should finish in a handful of pages.
    for (let i = 0; i < 20; i++) {
      const page = await this.studentService.list({
        sectionId,
        academicYearId,
        first: PAGE_SIZE,
        after,
        academicStatus: [AcademicStatus.ENROLLED],
      });
      for (const edge of page.edges) {
        if (edge.node.membershipId) membershipIds.push(edge.node.membershipId);
      }
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
      after = page.pageInfo.endCursor;
    }

    if (membershipIds.length === 0) return;

    // Pull the set of students with an APPROVED leave covering this date so
    // we seed them as LEAVE — matches the paper-register workflow where the
    // teacher sees absentees pre-marked.
    const onLeave = new Set(await this.leaveService.approvedOnDate(date, membershipIds));

    await this.repo.bulkInsertEntries(
      membershipIds.map((studentId) => ({
        sessionId,
        studentId,
        status: onLeave.has(studentId) ? AttendanceStatus.LEAVE : AttendanceStatus.PRESENT,
      })),
    );
  }

  // Before any write: a session's foreign keys accept another institute's membership or subject.
  private async assertSessionRefs(refs: {
    lecturerId?: string;
    subjectId?: string | null;
  }): Promise<void> {
    const missing = await this.repo.findMissingSessionRef(refs);
    if (missing === 'lecturer') {
      throw new BusinessException(
        ErrorCode.MEMBERSHIP_NOT_FOUND,
        'Lecturer is not a member of this institute',
      );
    }
    if (missing === 'subject') {
      throw new BusinessException(ErrorCode.SUBJECT_NOT_FOUND, 'Subject not found');
    }
  }

  async overrideSession(
    sessionId: string,
    lecturerId: string,
    subjectId: string | null,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord> {
    const session = await this.findSession(sessionId, access);
    const scope = await this.authorizeSession(access, 'update', session);
    const lecturerChanged = session.lecturerId !== lecturerId;
    const subjectChanged = (session.subjectId ?? null) !== (subjectId ?? null);

    if (!lecturerChanged && !subjectChanged) return session;
    this.assertPastDayPermission(access, {
      ...scope,
      lecturerId: session.lecturerId,
      date: session.date,
    });

    await this.assertSessionRefs({
      lecturerId: lecturerChanged ? lecturerId : undefined,
      subjectId: subjectChanged ? subjectId : undefined,
    });

    const withLecturer = lecturerChanged
      ? await this.repo.assignLecturer(sessionId, lecturerId)
      : session;

    const result = subjectChanged
      ? await this.repo.setSubject(sessionId, subjectId ?? null)
      : withLecturer;

    this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_SESSION.overridden, {
      sessionId: result.id,
      tenantId: result.tenantId,
      newLecturerId: result.lecturerId,
      newSubjectId: result.subjectId,
    });

    return result;
  }

  async markAttendance(
    input: MarkAttendanceInput,
    opts: { overridePastDay: boolean; overrideReason: string | null },
    access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord> {
    const session = await this.findSession(input.sessionId, access);
    await this.authorizeSession(access, 'update', session, input.studentId);
    await this.assertStudentInSession(session, input.studentId);
    const past = await this.assertEditWindow(access, session, opts.overridePastDay);
    const entry = await this.repo.upsertEntry({
      sessionId: input.sessionId,
      studentId: input.studentId,
      status: input.status,
      mode: input.mode,
      remarks: input.remarks,
    });
    this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_ENTRY.marked, {
      entryId: entry.id,
      sessionId: entry.sessionId,
      tenantId: entry.tenantId,
      studentId: entry.studentId,
      status: entry.status,
    });
    if (past) {
      // Distinct auditable event — admin edits to past-day attendance are
      // consumed by the audit pipeline.
      this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_ENTRY.past_day_edited, {
        entryId: entry.id,
        sessionId: entry.sessionId,
        tenantId: entry.tenantId,
        studentId: entry.studentId,
        status: entry.status,
        sessionDate: session.date,
        reason: opts.overrideReason ?? null,
      });
    }
    if (entry.status === 'ABSENT' || entry.status === 'LATE') {
      // notification-service alerts the student's guardians (ROV-314). AT-003: the
      // names make the copy readable instead of showing a membership id.
      const display = await this.resolveAbsenceDisplay(entry.studentId).catch((err) => {
        this.logger.warn({ err }, `Failed to resolve absence display for ${entry.studentId}`);
        return null;
      });
      this.eventBus.emit(EVENT_PATTERNS.NOTIFICATION.ATTENDANCE_ABSENT, {
        tenantId: entry.tenantId,
        sessionId: entry.sessionId,
        studentId: entry.studentId,
        status: entry.status,
        remarks: entry.remarks,
        markedAt: entry.markedAt.toISOString(),
        sessionDate: session.date,
        studentName: display?.studentName ?? null,
        sectionName: display?.sectionName ?? null,
        standardName: display?.standardName ?? null,
      });
    }
    return entry;
  }

  async bulkMark(
    input: BulkMarkAttendanceInput,
    opts: { overridePastDay: boolean; overrideReason: string | null },
    access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord[]> {
    const session = await this.findSession(input.sessionId, access);
    const scope = await this.sectionScope(session.sectionId);
    for (const item of input.entries) {
      this.authorize(access, 'update', {
        ...scope,
        lecturerId: session.lecturerId,
        date: session.date,
        studentId: item.studentId,
      });
      await this.assertStudentInSession(session, item.studentId);
    }
    const past = await this.assertEditWindow(access, session, opts.overridePastDay);
    const results: AttendanceEntryRecord[] = [];
    for (const item of input.entries) {
      const entry = await this.repo.upsertEntry({
        sessionId: input.sessionId,
        studentId: item.studentId,
        status: item.status,
        mode: item.mode,
        remarks: item.remarks,
      });
      results.push(entry);
    }
    this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_SESSION.bulk_marked, {
      sessionId: input.sessionId,
      tenantId: session.tenantId,
      count: results.length,
    });
    if (past) {
      this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_SESSION.past_day_bulk_edited, {
        sessionId: input.sessionId,
        tenantId: session.tenantId,
        sessionDate: session.date,
        count: results.length,
        reason: opts.overrideReason ?? null,
      });
    }
    return results;
  }

  async counts(sessionId: string, access: InstituteReadAccess) {
    await this.findSession(sessionId, access);
    const byStatus = await this.repo.countByStatus(sessionId, access);
    return Object.entries(byStatus).map(([status, count]) => ({ status, count }));
  }

  async dateSummary(query: DateSummaryQuery, access: InstituteReadAccess) {
    const summary = await this.repo.dateSummary(query, access);
    return {
      sessionCount: summary.sessionCount,
      studentCount: summary.studentCount,
      counts: Object.entries(summary.counts).map(([status, count]) => ({ status, count })),
    };
  }

  async absenteesReport(
    query: AbsenteesReportQuery,
    access: InstituteReadAccess,
  ): Promise<AbsenteeReportRow[]> {
    return this.repo.absenteesReport(query, access);
  }

  async sectionDailyBreakdown(
    query: SectionDailyBreakdownQuery,
    access: InstituteReadAccess,
  ): Promise<SectionDailyBreakdownRow[]> {
    return this.repo.sectionDailyBreakdown(query, access);
  }

  async studentHistory(
    studentId: string,
    startDate: string,
    endDate: string,
    access: InstituteReadAccess,
  ): Promise<StudentHistoryRow[]> {
    return this.repo.studentHistory({ studentId, startDate, endDate }, access);
  }

  async deleteSession(id: string, access: InstituteReadAccess): Promise<boolean> {
    const session = await this.findSession(id, access);
    const scope = await this.authorizeSession(access, 'delete', session);
    this.assertPastDayPermission(access, {
      ...scope,
      lecturerId: session.lecturerId,
      date: session.date,
    });
    await this.repo.softDeleteSession(id);
    this.eventBus.emit(EVENT_PATTERNS.ATTENDANCE_SESSION.deleted, {
      sessionId: id,
      tenantId: session.tenantId,
    });
    return true;
  }

  /**
   * Compare a session's ISO `YYYY-MM-DD` date against today in UTC. We treat
   * "today" inclusively — edits made during the same calendar day are always
   * allowed. Past-day edits hit the admin-override code path.
   */
  private isPastDate(sessionDate: string): boolean {
    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(today.getUTCDate()).padStart(2, '0');
    const todayIso = `${yyyy}-${mm}-${dd}`;
    return sessionDate < todayIso;
  }

  /**
   * AT-003: resolve display fields for an absence event from the joined
   * student detail. Falls back to nulls (and the listener falls back to the
   * membership id) if the student lookup fails — emission must not block
   * notification delivery on display-name resolution.
   */
  private async resolveAbsenceDisplay(membershipId: string): Promise<{
    studentName: string | null;
    sectionName: string | null;
    standardName: string | null;
  } | null> {
    // `studentService.list` returns the joined student detail (incl. firstName,
    // currentStandardName, currentSectionName) keyed off membership ids. We
    // call `findById` on the studentProfileId once we have it. The repo path
    // is read-only.
    const student = await this.studentService.findByMembershipId(membershipId);
    if (!student) return null;
    const firstName = student.firstName?.en ?? Object.values(student.firstName ?? {})[0] ?? null;
    const lastName = student.lastName?.en ?? Object.values(student.lastName ?? {})[0] ?? null;
    const standard =
      student.currentStandardName?.en ??
      Object.values(student.currentStandardName ?? {})[0] ??
      null;
    const section =
      student.currentSectionName?.en ?? Object.values(student.currentSectionName ?? {})[0] ?? null;
    return {
      studentName: [firstName, lastName].filter(Boolean).join(' ').trim() || null,
      sectionName: section,
      standardName: standard,
    };
  }
}
