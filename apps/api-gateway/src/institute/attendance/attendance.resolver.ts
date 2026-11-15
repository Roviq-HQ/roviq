import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import {
  AbilityGuard,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceSessionInput } from './dto/create-attendance-session.input';
import { BulkMarkAttendanceInput, MarkAttendanceInput } from './dto/mark-attendance.input';
import {
  AbsenteeReportItem,
  AttendanceDateSummary,
  AttendanceEntryModel,
  AttendanceSectionOption,
  AttendanceSessionModel,
  AttendanceStatusCount,
  SectionDailyBreakdown,
  StudentHistoryItem,
} from './models/attendance.model';
import type {
  AbsenteeReportRow,
  AttendanceEntryRecord,
  AttendanceSectionRow,
  AttendanceSessionRecord,
  SectionDailyBreakdownRow,
  StudentHistoryRow,
} from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => AttendanceSessionModel)
export class AttendanceResolver {
  constructor(private readonly service: AttendanceService) {}

  @Query(() => AttendanceSessionModel)
  @CheckAbility('read', 'Attendance')
  async attendanceSession(
    @Args('id', { type: () => ID }) id: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord> {
    return this.service.findSession(id, access);
  }

  @Query(() => [AttendanceSessionModel])
  @CheckAbility('read', 'Attendance')
  async attendanceSessionsForSection(
    @Args('sectionId', { type: () => ID }) sectionId: string,
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('endDate', { type: () => String }) endDate: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord[]> {
    return this.service.findSessionsForSection(sectionId, startDate, endDate, access);
  }

  @Query(() => [AttendanceSectionOption], {
    description:
      'Sections in the academic year whose attendance the caller may read, resolved from current server-side assignments.',
  })
  @CheckAbility('read', 'Attendance')
  async attendanceSections(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceSectionRow[]> {
    return this.service.listSections(academicYearId, access);
  }

  @Query(() => [AttendanceEntryModel])
  @CheckAbility('read', 'Attendance')
  async attendanceEntries(
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord[]> {
    return this.service.findEntries(sessionId, access);
  }

  @Query(() => [AttendanceStatusCount])
  @CheckAbility('read', 'Attendance')
  async attendanceCounts(
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ) {
    return this.service.counts(sessionId, access);
  }

  @Query(() => AttendanceDateSummary, {
    description:
      "Attendance totals for a date across the caller's authorized sections. Pass sectionId/academicYearId to narrow; omitting them never widens beyond authorized sections.",
  })
  @CheckAbility('read', 'Attendance')
  async attendanceCountsForDate(
    @Args('date', { type: () => String }) date: string,
    @Args('sectionId', { type: () => ID, nullable: true }) sectionId: string | null,
    @Args('academicYearId', { type: () => ID, nullable: true }) academicYearId: string | null,
    @CurrentReadAccess() access: InstituteReadAccess,
  ) {
    return this.service.dateSummary({ date, sectionId, academicYearId }, access);
  }

  @Query(() => [AbsenteeReportItem], {
    description:
      "Per-student absentee report aggregated across sessions. Pass sectionId to scope to one section, or null for all of the caller's authorized sections.",
  })
  @CheckAbility('read', 'Attendance')
  async attendanceAbsenteesReport(
    @Args('sectionId', { type: () => ID, nullable: true }) sectionId: string | null,
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('endDate', { type: () => String }) endDate: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AbsenteeReportRow[]> {
    return this.service.absenteesReport(sectionId, startDate, endDate, access);
  }

  @Query(() => [SectionDailyBreakdown], {
    description:
      'One row per authorized attendance session on the given date — aggregate counts plus the list of ABSENT membership ids. Pass standardId to narrow to one standard.',
  })
  @CheckAbility('read', 'Attendance')
  async attendanceSectionDailyBreakdown(
    @Args('date', { type: () => String }) date: string,
    @Args('standardId', { type: () => ID, nullable: true }) standardId: string | null,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<SectionDailyBreakdownRow[]> {
    return this.service.sectionDailyBreakdown({ date, standardId }, access);
  }

  @Query(() => [StudentHistoryItem], {
    description:
      'Per-student attendance history — every mark for this student across the requested date range, newest first.',
  })
  @CheckAbility('read', 'Attendance')
  async attendanceStudentHistory(
    @Args('studentId', { type: () => ID }) studentId: string,
    @Args('startDate', { type: () => String }) startDate: string,
    @Args('endDate', { type: () => String }) endDate: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<StudentHistoryRow[]> {
    return this.service.studentHistory(studentId, startDate, endDate, access);
  }

  @Mutation(() => AttendanceSessionModel)
  @CheckAbility('create', 'Attendance')
  async openAttendanceSession(
    @Args('input') input: CreateAttendanceSessionInput,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord> {
    return this.service.openSession(input, access);
  }

  @Mutation(() => AttendanceSessionModel, {
    description: 'Override an existing attendance session — replaces lecturer and/or subject.',
  })
  @CheckAbility('update', 'Attendance')
  async overrideAttendanceSession(
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('lecturerId', { type: () => ID }) lecturerId: string,
    @Args('subjectId', { type: () => ID, nullable: true }) subjectId: string | null,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceSessionRecord> {
    return this.service.overrideSession(sessionId, lecturerId, subjectId, access);
  }

  @Mutation(() => AttendanceEntryModel, {
    description:
      'Mark a single student. For sessions older than today this throws ATTENDANCE_EDIT_WINDOW_CLOSED unless the caller supplies `overridePastDay: true` AND has the `manage` permission on Attendance (admins). Overrides are audited.',
  })
  @CheckAbility('update', 'Attendance')
  async markAttendance(
    @Args('input') input: MarkAttendanceInput,
    @Args('overridePastDay', { type: () => Boolean, nullable: true })
    overridePastDay: boolean | null,
    @Args('overrideReason', { type: () => String, nullable: true })
    overrideReason: string | null,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord> {
    return this.service.markAttendance(
      input,
      { overridePastDay: overridePastDay ?? false, overrideReason },
      access,
    );
  }

  @Mutation(() => [AttendanceEntryModel], {
    description:
      'Bulk-mark a roster. Same past-day guard as markAttendance — admins must explicitly opt in with `overridePastDay: true`.',
  })
  @CheckAbility('update', 'Attendance')
  async bulkMarkAttendance(
    @Args('input') input: BulkMarkAttendanceInput,
    @Args('overridePastDay', { type: () => Boolean, nullable: true })
    overridePastDay: boolean | null,
    @Args('overrideReason', { type: () => String, nullable: true })
    overrideReason: string | null,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<AttendanceEntryRecord[]> {
    return this.service.bulkMark(
      input,
      { overridePastDay: overridePastDay ?? false, overrideReason },
      access,
    );
  }

  @Mutation(() => Boolean)
  @CheckAbility('delete', 'Attendance')
  async deleteAttendanceSession(
    @Args('id', { type: () => ID }) id: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<boolean> {
    return this.service.deleteSession(id, access);
  }
}
