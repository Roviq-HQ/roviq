import type { InstituteReadAccess } from '@roviq/casl';
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

export abstract class AttendanceRepository {
  abstract findSessionById(
    id: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord | null>;
  abstract findSession(query: SessionQuery): Promise<AttendanceSessionRecord | null>;
  abstract findSessionsInRange(
    query: SessionDateRangeQuery,
    access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord[]>;
  abstract findSectionScope(sectionId: string): Promise<AttendanceSectionScope | null>;
  abstract listSections(
    academicYearId: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceSectionRow[]>;
  abstract isStudentInSession(
    session: AttendanceSessionRecord,
    studentId: string,
  ): Promise<boolean>;
  abstract createSession(data: CreateSessionData): Promise<AttendanceSessionRecord>;
  abstract assignLecturer(sessionId: string, lecturerId: string): Promise<AttendanceSessionRecord>;
  abstract setSubject(
    sessionId: string,
    subjectId: string | null,
  ): Promise<AttendanceSessionRecord>;

  abstract findEntriesBySession(
    sessionId: string,
    access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord[]>;
  abstract findEntry(sessionId: string, studentId: string): Promise<AttendanceEntryRecord | null>;
  abstract bulkInsertEntries(
    entries: Array<Omit<UpsertEntryData, 'sessionId'> & { sessionId: string }>,
  ): Promise<AttendanceEntryRecord[]>;
  abstract upsertEntry(data: UpsertEntryData): Promise<AttendanceEntryRecord>;

  abstract countByStatus(
    sessionId: string,
    access: InstituteReadAccess,
  ): Promise<Record<string, number>>;
  abstract dateSummary(
    query: DateSummaryQuery,
    access: InstituteReadAccess,
  ): Promise<DateSummaryRow>;

  abstract absenteesReport(
    query: AbsenteesReportQuery,
    access: InstituteReadAccess,
  ): Promise<AbsenteeReportRow[]>;
  abstract sectionDailyBreakdown(
    query: SectionDailyBreakdownQuery,
    access: InstituteReadAccess,
  ): Promise<SectionDailyBreakdownRow[]>;
  abstract studentHistory(
    query: StudentHistoryQuery,
    access: InstituteReadAccess,
  ): Promise<StudentHistoryRow[]>;

  abstract softDeleteSession(id: string): Promise<void>;
}
