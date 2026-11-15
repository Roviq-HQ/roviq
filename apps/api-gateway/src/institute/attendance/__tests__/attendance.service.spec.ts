/**
 * Unit tests for AttendanceService — covers openSession idempotency + conflict,
 * and markAttendance upsert + EventBus emission rules.
 *
 * The repository is mocked directly against the abstract class contract.
 * EventBusService is replaced with a plain `{ emit: vi.fn() }` mock since the
 * service now publishes events through it (NATS + GraphQL pubsub fan-out lives
 * inside EventBus).
 *
 * Constructs the service by grabbing its prototype and manually assigning
 * `repo` / `eventBus` / `logger` onto the instance — same pattern
 * `student.service.spec.ts` uses. Running the real constructor under
 * Vitest's esbuild transform is brittle because parameter property shorthand
 * combined with `@Inject()` decorators doesn't reliably wire private fields.
 */

import { createMongoAbility } from '@casl/ability';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import {
  type AbilityRule,
  type AppAbility,
  AttendanceMode,
  AttendanceStatus,
  type InstituteContext,
} from '@roviq/common-types';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { AttendanceService } from '../attendance.service';
import type { AttendanceRepository } from '../repositories/attendance.repository';
import type { AttendanceEntryRecord, AttendanceSessionRecord } from '../repositories/types';

const TENANT_ID = '00000000-0000-7000-a000-000000000001';
const SECTION_ID = '00000000-0000-7000-a000-000000000002';
const ACADEMIC_YEAR_ID = '00000000-0000-7000-a000-000000000003';
const LECTURER_A = '00000000-0000-7000-a000-000000000004';
const LECTURER_B = '00000000-0000-7000-a000-000000000005';
const SESSION_ID = '00000000-0000-7000-a000-000000000006';
const STUDENT_ID = '00000000-0000-7000-a000-000000000007';
const ENTRY_ID = '00000000-0000-7000-a000-000000000008';
const MARKED_AT = new Date('2026-04-23T10:00:00Z');
const STANDARD_ID = '00000000-0000-7000-a000-000000000009';
const OTHER_SECTION_ID = '00000000-0000-7000-a000-00000000000a';
const OTHER_YEAR_ID = '00000000-0000-7000-a000-00000000000b';

const USER: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  tenantId: TENANT_ID,
  userId: '00000000-0000-7000-a000-00000000000c',
  membershipId: LECTURER_A,
  roleId: '00000000-0000-7000-a000-00000000000d',
  type: 'access',
};

function accessWith(rules: AbilityRule[]): InstituteReadAccess {
  return { user: USER, ability: createMongoAbility<AppAbility>(rules) };
}

const ADMIN = accessWith([{ action: 'manage', subject: 'all' }]);
const TEACHER = accessWith([
  { action: 'manage', subject: 'Attendance', conditions: { sectionId: { $in: [SECTION_ID] } } },
]);
const READ_ONLY = accessWith([{ action: 'read', subject: 'Attendance' }]);
const SECTION_SCOPE = {
  sectionId: SECTION_ID,
  standardId: STANDARD_ID,
  academicYearId: ACADEMIC_YEAR_ID,
};
const PRESENT_ONLY = { overridePastDay: false, overrideReason: null };

/**
 * Today's date in UTC as ISO YYYY-MM-DD. Used as the session default so the
 * `isPastDate` guard treats the session as same-day — tests must override
 * `date` explicitly when they want to exercise the past-day code path.
 */
function todayUtcIso(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildSession(overrides: Partial<AttendanceSessionRecord> = {}): AttendanceSessionRecord {
  return {
    id: SESSION_ID,
    tenantId: TENANT_ID,
    sectionId: SECTION_ID,
    academicYearId: ACADEMIC_YEAR_ID,
    date: todayUtcIso(),
    period: 2,
    subjectId: null,
    lecturerId: LECTURER_A,
    overrideCheck: false,
    createdAt: MARKED_AT,
    updatedAt: MARKED_AT,
    ...overrides,
  };
}

function buildEntry(overrides: Partial<AttendanceEntryRecord> = {}): AttendanceEntryRecord {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    sessionId: SESSION_ID,
    studentId: STUDENT_ID,
    status: AttendanceStatus.PRESENT,
    mode: AttendanceMode.MANUAL,
    remarks: null,
    markedAt: MARKED_AT,
    createdAt: MARKED_AT,
    updatedAt: MARKED_AT,
    ...overrides,
  };
}

/**
 * Minimal EventBusService stand-in — `emit()` returns void, the dual-fanout
 * (NATS + pubsub) lives inside the real EventBus.
 */
function buildEventBusMock() {
  const emit = vi.fn();
  return { emit };
}

/**
 * Manual repository mock — typed against the abstract class contract so any
 * signature drift in production code surfaces as a type error here. Every
 * method is a plain `vi.fn()` so `mockResolvedValue` / assertions work without
 * the Proxy-descriptor edge cases that `vi.spyOn` hits on `createMock`.
 */
type MockedRepo = {
  [K in keyof AttendanceRepository]: Mock;
};

function buildRepoMock(): MockedRepo {
  return {
    findSessionById: vi.fn(),
    findSession: vi.fn(),
    findSessionsInRange: vi.fn(),
    findSectionScope: vi.fn(),
    listSections: vi.fn(),
    isStudentInSession: vi.fn(),
    createSession: vi.fn(),
    assignLecturer: vi.fn(),
    setSubject: vi.fn(),
    findEntriesBySession: vi.fn(),
    findEntry: vi.fn(),
    bulkInsertEntries: vi.fn(),
    upsertEntry: vi.fn(),
    countByStatus: vi.fn(),
    dateSummary: vi.fn(),
    absenteesReport: vi.fn(),
    sectionDailyBreakdown: vi.fn(),
    studentHistory: vi.fn(),
    softDeleteSession: vi.fn(),
  };
}

/**
 * Narrowed StudentService mock — only the `list` method is touched by
 * AttendanceService (for the auto-seed PRESENT workflow on openSession).
 */
interface StudentServiceMock {
  list: Mock;
}

function buildStudentServiceMock(): StudentServiceMock {
  return {
    list: vi.fn(),
  };
}

interface LeaveServiceMock {
  approvedOnDate: Mock;
}

function buildLeaveServiceMock(): LeaveServiceMock {
  return {
    // Empty by default — no one on approved leave.
    approvedOnDate: vi.fn().mockResolvedValue([]),
  };
}

interface HolidayServiceMock {
  onDate: Mock;
}

function buildHolidayServiceMock(): HolidayServiceMock {
  return {
    // Empty by default — no holidays on the tested date.
    onDate: vi.fn().mockResolvedValue([]),
  };
}

/** Empty connection page so `seedPresentEntries` inserts nothing. */
const EMPTY_STUDENT_PAGE = {
  edges: [],
  pageInfo: { hasNextPage: false, endCursor: null },
  totalCount: 0,
};

describe('AttendanceService (unit)', () => {
  let service: AttendanceService;
  let repo: MockedRepo;
  let studentService: StudentServiceMock;
  let leaveService: LeaveServiceMock;
  let holidayService: HolidayServiceMock;
  let eventBus: ReturnType<typeof buildEventBusMock>;

  beforeEach(() => {
    repo = buildRepoMock();
    studentService = buildStudentServiceMock();
    leaveService = buildLeaveServiceMock();
    holidayService = buildHolidayServiceMock();
    eventBus = buildEventBusMock();
    // Build the instance via the prototype so we skip the real constructor.
    // That constructor uses TS parameter-property shorthand combined with
    // `@Inject()`, which esbuild does not fully wire under Vitest — private
    // injected fields end up undefined.
    service = Object.assign(Object.create(AttendanceService.prototype), {
      repo,
      studentService,
      leaveService,
      holidayService,
      eventBus,
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        verbose: vi.fn(),
      },
    });
    repo.findSectionScope.mockResolvedValue(SECTION_SCOPE);
    repo.isStudentInSession.mockResolvedValue(true);
  });

  describe('openSession', () => {
    const TODAY = todayUtcIso();
    const input = {
      sectionId: SECTION_ID,
      academicYearId: ACADEMIC_YEAR_ID,
      date: TODAY,
      period: 2,
      subjectId: null,
      lecturerId: LECTURER_A,
    };

    it('creates a new session when none exists for the slot', async () => {
      repo.findSession.mockResolvedValue(null);
      const created = buildSession();
      repo.createSession.mockResolvedValue(created);
      // seedPresentEntries paginates StudentService.list — return an empty
      // page so the auto-seed loop exits immediately without inserting.
      studentService.list.mockResolvedValue(EMPTY_STUDENT_PAGE);

      const result = await service.openSession(input, ADMIN);

      expect(result).toBe(created);
      expect(repo.findSession).toHaveBeenCalledWith({
        sectionId: SECTION_ID,
        date: TODAY,
        period: 2,
      });
      expect(repo.createSession).toHaveBeenCalledWith({
        sectionId: SECTION_ID,
        academicYearId: ACADEMIC_YEAR_ID,
        date: TODAY,
        period: 2,
        subjectId: null,
        lecturerId: LECTURER_A,
      });
      // Empty roster → no bulk insert call.
      expect(repo.bulkInsertEntries).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'ATTENDANCE_SESSION.opened',
        expect.objectContaining({
          sessionId: created.id,
          tenantId: TENANT_ID,
          sectionId: SECTION_ID,
        }),
      );
    });

    it('returns the existing session unchanged when the same lecturer re-opens the slot', async () => {
      const existing = buildSession();
      repo.findSession.mockResolvedValue(existing);

      const result = await service.openSession(input, ADMIN);

      expect(result).toBe(existing);
      expect(repo.createSession).not.toHaveBeenCalled();
      // No open event fires on the idempotent re-open path.
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the slot is owned by another lecturer', async () => {
      const existing = buildSession({ lecturerId: LECTURER_B });
      repo.findSession.mockResolvedValue(existing);

      await expect(service.openSession(input, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('opens a session in an assigned section for a section-scoped teacher', async () => {
      repo.findSession.mockResolvedValue(buildSession());

      await expect(service.openSession(input, TEACHER)).resolves.toEqual(buildSession());
    });

    it('rejects opening a session in a section outside the teacher assignment', async () => {
      repo.findSectionScope.mockResolvedValue({ ...SECTION_SCOPE, sectionId: OTHER_SECTION_ID });

      await expect(
        service.openSession({ ...input, sectionId: OTHER_SECTION_ID }, TEACHER),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findSession).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects an academic year that does not own the section', async () => {
      await expect(
        service.openSession({ ...input, academicYearId: OTHER_YEAR_ID }, ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects an unknown section', async () => {
      repo.findSectionScope.mockResolvedValue(null);

      await expect(service.openSession(input, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects callers who may only read attendance', async () => {
      await expect(service.openSession(input, READ_ONLY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('markAttendance', () => {
    const baseInput = {
      sessionId: SESSION_ID,
      studentId: STUDENT_ID,
      status: AttendanceStatus.PRESENT,
      mode: AttendanceMode.MANUAL,
      remarks: null,
    };

    it('upserts the entry and emits ATTENDANCE_ENTRY.marked', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());
      const entry = buildEntry();
      repo.upsertEntry.mockResolvedValue(entry);

      const result = await service.markAttendance(baseInput, PRESENT_ONLY, ADMIN);

      expect(result).toBe(entry);
      expect(repo.upsertEntry).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        studentId: STUDENT_ID,
        status: AttendanceStatus.PRESENT,
        mode: AttendanceMode.MANUAL,
        remarks: null,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'ATTENDANCE_ENTRY.marked',
        expect.objectContaining({
          entryId: ENTRY_ID,
          sessionId: SESSION_ID,
          tenantId: TENANT_ID,
          studentId: STUDENT_ID,
          status: AttendanceStatus.PRESENT,
        }),
      );
    });

    it('emits the guardian-facing absent notification when status is ABSENT', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());
      const absentEntry = buildEntry({ status: AttendanceStatus.ABSENT });
      repo.upsertEntry.mockResolvedValue(absentEntry);

      await service.markAttendance(
        { ...baseInput, status: AttendanceStatus.ABSENT },
        PRESENT_ONLY,
        ADMIN,
      );

      expect(eventBus.emit).toHaveBeenCalledWith(
        'ATTENDANCE_ENTRY.marked',
        expect.objectContaining({ status: AttendanceStatus.ABSENT }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'NOTIFICATION.attendance.absent',
        expect.objectContaining({
          tenantId: TENANT_ID,
          sessionId: SESSION_ID,
          studentId: STUDENT_ID,
          status: AttendanceStatus.ABSENT,
          markedAt: MARKED_AT.toISOString(),
        }),
      );
    });

    it('does NOT emit the absent notification when status is PRESENT', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());
      repo.upsertEntry.mockResolvedValue(buildEntry());

      await service.markAttendance(
        { ...baseInput, status: AttendanceStatus.PRESENT },
        PRESENT_ONLY,
        ADMIN,
      );

      expect(eventBus.emit).toHaveBeenCalledWith('ATTENDANCE_ENTRY.marked', expect.anything());
      const patterns = eventBus.emit.mock.calls.map((c) => c[0]);
      expect(patterns).not.toContain('NOTIFICATION.attendance.absent');
    });

    it('rejects past-day edits without explicit admin override', async () => {
      repo.findSessionById.mockResolvedValue(buildSession({ date: '2020-01-01' }));

      await expect(service.markAttendance(baseInput, PRESENT_ONLY, ADMIN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.upsertEntry).not.toHaveBeenCalled();
    });

    it('allows past-day edits when overridePastDay=true and emits past_day_edited audit event', async () => {
      repo.findSessionById.mockResolvedValue(buildSession({ date: '2020-01-01' }));
      const entry = buildEntry();
      repo.upsertEntry.mockResolvedValue(entry);

      await service.markAttendance(
        baseInput,
        { overridePastDay: true, overrideReason: 'register correction' },
        ADMIN,
      );

      expect(repo.upsertEntry).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'ATTENDANCE_ENTRY.past_day_edited',
        expect.objectContaining({
          entryId: ENTRY_ID,
          sessionDate: '2020-01-01',
          reason: 'register correction',
        }),
      );
    });

    it('looks the session up through the caller read scope', async () => {
      repo.findSessionById.mockResolvedValue(null);

      await expect(service.markAttendance(baseInput, PRESENT_ONLY, TEACHER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.findSessionById).toHaveBeenCalledWith(SESSION_ID, TEACHER);
      expect(repo.upsertEntry).not.toHaveBeenCalled();
    });

    it('rejects marking in a readable session outside the teacher assignment', async () => {
      repo.findSessionById.mockResolvedValue(buildSession({ sectionId: OTHER_SECTION_ID }));
      repo.findSectionScope.mockResolvedValue({ ...SECTION_SCOPE, sectionId: OTHER_SECTION_ID });

      await expect(service.markAttendance(baseInput, PRESENT_ONLY, TEACHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.upsertEntry).not.toHaveBeenCalled();
    });

    it('rejects a student who is not on the session section roster', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());
      repo.isStudentInSession.mockResolvedValue(false);

      await expect(service.markAttendance(baseInput, PRESENT_ONLY, TEACHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.upsertEntry).not.toHaveBeenCalled();
    });
  });

  describe('bulkMark', () => {
    it('rejects the whole batch before writing when one student is off the roster', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());
      repo.isStudentInSession.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(
        service.bulkMark(
          {
            sessionId: SESSION_ID,
            entries: [
              { studentId: STUDENT_ID, status: AttendanceStatus.PRESENT },
              { studentId: LECTURER_B, status: AttendanceStatus.ABSENT },
            ],
          },
          PRESENT_ONLY,
          TEACHER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.upsertEntry).not.toHaveBeenCalled();
    });
  });

  describe('overrideSession and deleteSession', () => {
    it('rejects overriding a session the caller may only read', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());

      await expect(
        service.overrideSession(SESSION_ID, LECTURER_B, null, READ_ONLY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.assignLecturer).not.toHaveBeenCalled();
    });

    it('rejects deleting a session the caller may only read', async () => {
      repo.findSessionById.mockResolvedValue(buildSession());

      await expect(service.deleteSession(SESSION_ID, READ_ONLY)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.softDeleteSession).not.toHaveBeenCalled();
    });
  });

  describe('dateSummary', () => {
    it('passes the filters and caller access through and reshapes counts', async () => {
      repo.dateSummary.mockResolvedValue({
        sessionCount: 2,
        studentCount: 1,
        counts: { PRESENT: 1, ABSENT: 1 },
      });
      const query = { date: '2026-11-15', sectionId: SECTION_ID, academicYearId: ACADEMIC_YEAR_ID };

      const result = await service.dateSummary(query, TEACHER);

      expect(repo.dateSummary).toHaveBeenCalledWith(query, TEACHER);
      expect(result).toEqual({
        sessionCount: 2,
        studentCount: 1,
        counts: [
          { status: 'PRESENT', count: 1 },
          { status: 'ABSENT', count: 1 },
        ],
      });
    });
  });
});
