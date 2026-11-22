import { Injectable } from '@nestjs/common';
import {
  type AppAbility,
  type AppAction,
  BusinessException,
  calendarDaysBetween,
  ErrorCode,
  isValidDateRange,
  LEAVE_STATE_MACHINE,
  LeaveStatus,
  type LeaveType,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { FileService } from '../../files/file.service';
import type { CreateLeaveInput } from './dto/create-leave.input';
import type { UpdateLeaveInput } from './dto/update-leave.input';
import { LeaveRepository } from './repositories/leave.repository';
import type { LeaveApplicantRecord, LeaveRecord } from './repositories/types';

const MIN_DOCUMENTED_DAYS = 3;

// The notification copy is written once for both locales, so the name is flattened like the
// attendance alert's: English, else the first locale given.
function applicantDisplayName(applicant: LeaveApplicantRecord | null): string | null {
  if (!applicant) return null;
  const pick = (text: Record<string, string> | null) =>
    text ? (text.en ?? Object.values(text)[0] ?? null) : null;
  return (
    [pick(applicant.firstName), pick(applicant.lastName)].filter(Boolean).join(' ').trim() || null
  );
}
const LEAVE_FILE_PURPOSE = 'LEAVE_ATTACHMENT';

@Injectable()
export class LeaveService {
  constructor(
    private readonly repo: LeaveRepository,
    private readonly eventBus: EventBusService,
    private readonly files: FileService,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  async findById(id: string, ability: AppAbility): Promise<LeaveRecord> {
    const record = await this.repo.findById(id, ability);
    // Also the answer for a leave the caller may not read, so ids cannot be probed.
    if (!record) throw new BusinessException(ErrorCode.LEAVE_NOT_FOUND, `Leave ${id} not found`);
    return record;
  }

  async list(
    filter: {
      userId?: string;
      status?: LeaveStatus;
      type?: LeaveType;
      startDate?: string;
      endDate?: string;
    },
    ability: AppAbility,
  ): Promise<LeaveRecord[]> {
    return this.repo.list(filter, ability);
  }

  async apply(input: CreateLeaveInput, ability: AppAbility): Promise<LeaveRecord> {
    if (!(await this.repo.canApplyFor(input.userId, ability))) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'You may not file a leave for this person.');
    }
    this.assertValidRange(input.startDate, input.endDate);
    const fileIds = [...new Set(input.fileIds ?? [])];
    this.assertDocumented(input.startDate, input.endDate, fileIds.length);

    await this.files.verifyUploads(fileIds, LEAVE_FILE_PURPOSE);

    const record = await this.repo.create({
      userId: input.userId,
      startDate: input.startDate,
      endDate: input.endDate,
      type: input.type,
      reason: input.reason,
      fileIds,
    });

    this.eventBus.emit(EVENT_PATTERNS.LEAVE.applied, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      startDate: record.startDate,
      endDate: record.endDate,
      type: record.type,
    });

    // A role may file a leave it cannot read back; then the documents stay hidden.
    return (await this.repo.findById(record.id, ability)) ?? { ...record, files: [] };
  }

  async update(id: string, input: UpdateLeaveInput, ability: AppAbility): Promise<LeaveRecord> {
    const existing = await this.loadFor(id, ability, 'update');
    if (existing.status !== LeaveStatus.PENDING) {
      // Deliberately strict: approvals are audited decisions. To amend an
      // already-decided leave the applicant must cancel and re-apply.
      throw new BusinessException(
        ErrorCode.LEAVE_NOT_EDITABLE,
        'Only PENDING leaves can be edited.',
      );
    }
    const start = input.startDate ?? existing.startDate;
    const end = input.endDate ?? existing.endDate;
    this.assertValidRange(start, end);

    const fileIds = input.fileIds ? [...new Set(input.fileIds)] : undefined;
    this.assertDocumented(start, end, fileIds ? fileIds.length : existing.files.length);
    if (fileIds) {
      const attached = new Set(existing.files.map((file) => file.id));
      await this.files.verifyUploads(
        fileIds.filter((fileId) => !attached.has(fileId)),
        LEAVE_FILE_PURPOSE,
      );
    }

    const record = await this.repo.update(id, {
      startDate: input.startDate,
      endDate: input.endDate,
      type: input.type,
      reason: input.reason,
      fileIds,
    });
    this.eventBus.emit(EVENT_PATTERNS.LEAVE.updated, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
    });
    return record;
  }

  /** `approverMembershipId` is the caller's own membership, never a client value. */
  async approve(
    id: string,
    ability: AppAbility,
    approverMembershipId: string,
  ): Promise<LeaveRecord> {
    const existing = await this.loadFor(id, ability, 'update');
    LEAVE_STATE_MACHINE.assertTransition(existing.status, LeaveStatus.APPROVED);
    const record = await this.repo.setStatus(
      id,
      existing.status,
      LeaveStatus.APPROVED,
      approverMembershipId,
    );
    this.eventBus.emit(EVENT_PATTERNS.LEAVE.approved, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      approverMembershipId,
    });
    // Notification-service listens for this and pings the applicant + parents.
    this.eventBus.emit(EVENT_PATTERNS.NOTIFICATION.LEAVE_DECIDED, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      status: LeaveStatus.APPROVED,
      applicantName: applicantDisplayName(record.applicant),
      startDate: record.startDate,
      endDate: record.endDate,
    });
    return record;
  }

  /** `approverMembershipId` is the caller's own membership, never a client value. */
  async reject(
    id: string,
    ability: AppAbility,
    approverMembershipId: string,
  ): Promise<LeaveRecord> {
    const existing = await this.loadFor(id, ability, 'update');
    LEAVE_STATE_MACHINE.assertTransition(existing.status, LeaveStatus.REJECTED);
    const record = await this.repo.setStatus(
      id,
      existing.status,
      LeaveStatus.REJECTED,
      approverMembershipId,
    );
    this.eventBus.emit(EVENT_PATTERNS.LEAVE.rejected, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      approverMembershipId,
    });
    this.eventBus.emit(EVENT_PATTERNS.NOTIFICATION.LEAVE_DECIDED, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
      status: LeaveStatus.REJECTED,
      applicantName: applicantDisplayName(record.applicant),
      startDate: record.startDate,
      endDate: record.endDate,
    });
    return record;
  }

  async cancel(
    id: string,
    ability: AppAbility,
    cancellerMembershipId: string,
  ): Promise<LeaveRecord> {
    const existing = await this.loadFor(id, ability, 'withdraw');
    LEAVE_STATE_MACHINE.assertTransition(existing.status, LeaveStatus.CANCELLED);
    const record = await this.repo.setStatus(
      id,
      existing.status,
      LeaveStatus.CANCELLED,
      cancellerMembershipId,
    );
    this.eventBus.emit(EVENT_PATTERNS.LEAVE.cancelled, {
      leaveId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
    });
    return record;
  }

  async delete(id: string, ability: AppAbility): Promise<boolean> {
    await this.loadFor(id, ability, 'delete');
    await this.repo.softDelete(id);
    this.eventBus.emit(EVENT_PATTERNS.LEAVE.deleted, { leaveId: id, tenantId: this.tenantId });
    return true;
  }

  /**
   * Used by the attendance module when opening a session: returns the subset
   * of the given student membership ids that have an APPROVED leave covering
   * `date`. Attendance seeds those students as LEAVE instead of PRESENT.
   */
  async approvedOnDate(date: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    return this.repo.approvedOnDate({ date, userIds });
  }

  /** `LEAVE_NOT_FOUND` for a leave the caller may not read, `FORBIDDEN` for one they may only read. */
  private async loadFor(id: string, ability: AppAbility, action: AppAction): Promise<LeaveRecord> {
    const record = await this.findById(id, ability);
    if (!(await this.repo.isAllowed(id, ability, action))) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'You may not change this leave.');
    }
    return record;
  }

  private assertDocumented(start: string, end: string, fileCount: number) {
    if (calendarDaysBetween(start, end) >= MIN_DOCUMENTED_DAYS && fileCount === 0) {
      throw new BusinessException(
        ErrorCode.LEAVE_DOCUMENT_REQUIRED,
        'Leaves spanning 3 or more calendar days require at least one supporting document.',
      );
    }
  }

  private assertValidRange(start: string, end: string) {
    if (!isValidDateRange(start, end)) {
      throw new BusinessException(
        ErrorCode.INVALID_DATE_RANGE,
        'Leave end date must not be before the start date.',
      );
    }
  }
}
