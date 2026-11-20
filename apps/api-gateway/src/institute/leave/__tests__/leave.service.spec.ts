/**
 * Unit tests for LeaveService — covers the ability-scoped reads, the apply-time
 * applicant check, date-range and supporting-document rules, the read-then-allowed
 * gate on every write, the PENDING-only edit gate, the three status transitions
 * and their NATS emission sets, soft-delete, and the attendance-side
 * `approvedOnDate` short-circuit.
 *
 * The service is constructed via `Object.assign(Object.create(Proto), {...})`
 * so we skip the real constructor (decorator + parameter-property shorthand
 * does not reliably wire private fields under esbuild/Vitest).
 */

import {
  type AppAbility,
  type AppAction,
  BusinessException,
  ErrorCode,
  LeaveStatus,
  LeaveType,
} from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FileService } from '../../../files/file.service';
import type { FileRecord } from '../../../files/repositories/types';
import { LeaveService } from '../leave.service';
import type { LeaveRepository } from '../repositories/leave.repository';
import type { LeaveRecord } from '../repositories/types';

const TENANT_ID = '00000000-0000-7000-a000-000000000001';
const LEAVE_ID = '00000000-0000-7000-a000-000000000002';
const USER_ID = '00000000-0000-7000-a000-000000000003';
const FILE_ID = '00000000-0000-7000-a000-000000000005';
const OTHER_FILE_ID = '00000000-0000-7000-a000-000000000006';

// `vi.mock` is hoisted, so the service's `getRequestContext` resolves to this mock.
vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    correlationId: 'leave-service-spec',
  })),
}));
const APPROVER_ID = '00000000-0000-7000-a000-000000000004';
const FIXED_TS = new Date('2026-04-23T10:00:00Z');

function buildLeave(overrides: Partial<LeaveRecord> = {}): LeaveRecord {
  return {
    id: LEAVE_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    startDate: '2026-05-01',
    endDate: '2026-05-02',
    type: LeaveType.CASUAL,
    reason: 'family function',
    status: LeaveStatus.PENDING,
    files: [],
    decidedBy: null,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    ...overrides,
  };
}

function buildFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: FILE_ID,
    tenantId: TENANT_ID,
    resellerId: null,
    subjectUserId: null,
    visibility: 'PRIVATE',
    purpose: 'LEAVE_ATTACHMENT',
    objectKey: `institutes/${TENANT_ID}/leave-attachment/${FILE_ID}.pdf`,
    originalName: 'med-cert.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    width: null,
    height: null,
    variants: null,
    placeholder: null,
    status: 'READY',
    uploadedBy: USER_ID,
    createdAt: FIXED_TS,
    ...overrides,
  };
}

function buildEventBusMock() {
  const emit = vi.fn();
  return { emit, eventBus: { emit } };
}

/** Typed against the abstract class so signature drift surfaces as a type error here. */
type MockedRepo = {
  [K in keyof LeaveRepository]: Mock<LeaveRepository[K]>;
};

function buildRepoMock(): MockedRepo {
  return {
    findById: vi.fn<LeaveRepository['findById']>(),
    list: vi.fn<LeaveRepository['list']>(),
    isAllowed: vi.fn<LeaveRepository['isAllowed']>().mockResolvedValue(true),
    canApplyFor: vi.fn<LeaveRepository['canApplyFor']>().mockResolvedValue(true),
    create: vi.fn<LeaveRepository['create']>(),
    update: vi.fn<LeaveRepository['update']>(),
    setStatus: vi.fn<LeaveRepository['setStatus']>(),
    softDelete: vi.fn<LeaveRepository['softDelete']>(),
    approvedOnDate: vi.fn<LeaveRepository['approvedOnDate']>(),
  };
}

describe('LeaveService (unit)', () => {
  let service: LeaveService;
  let repo: MockedRepo;
  let eventBusMock: ReturnType<typeof buildEventBusMock>;
  let verifyUploads: Mock<FileService['verifyUploads']>;
  let ability: AppAbility;

  beforeEach(() => {
    repo = buildRepoMock();
    eventBusMock = buildEventBusMock();
    verifyUploads = vi.fn<FileService['verifyUploads']>().mockResolvedValue(undefined);
    ability = createMock<AppAbility>();
    service = Object.assign(Object.create(LeaveService.prototype), {
      repo,
      eventBus: eventBusMock.eventBus,
      files: createMock<FileService>({ verifyUploads }),
    });
  });

  describe('findById', () => {
    it('should return the record the repo reads under the ability', async () => {
      const existing = buildLeave();
      repo.findById.mockResolvedValue(existing);

      const result = await service.findById(LEAVE_ID, ability);

      expect(result).toBe(existing);
      expect(repo.findById).toHaveBeenCalledWith(LEAVE_ID, ability);
    });

    it('should throw LEAVE_NOT_FOUND when the repo returns null', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.findById(LEAVE_ID, ability)).rejects.toMatchObject({
        code: ErrorCode.LEAVE_NOT_FOUND,
      });
      expect(repo.findById).toHaveBeenCalledWith(LEAVE_ID, ability);
    });
  });

  describe('list', () => {
    it('should forward every filter field and the ability to the repo', async () => {
      const filter = {
        userId: USER_ID,
        status: LeaveStatus.APPROVED,
        type: LeaveType.MEDICAL,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      };
      const rows = [buildLeave()];
      repo.list.mockResolvedValue(rows);

      const result = await service.list(filter, ability);

      expect(result).toBe(rows);
      expect(repo.list).toHaveBeenCalledWith(
        {
          userId: USER_ID,
          status: LeaveStatus.APPROVED,
          type: LeaveType.MEDICAL,
          startDate: '2026-05-01',
          endDate: '2026-05-31',
        },
        ability,
      );
    });
  });

  describe('apply', () => {
    it('should refuse with FORBIDDEN when the caller may not file for this person, and do nothing else', async () => {
      repo.canApplyFor.mockResolvedValue(false);

      await expect(
        service.apply(
          {
            userId: USER_ID,
            startDate: '2026-05-01',
            endDate: '2026-05-05',
            type: LeaveType.MEDICAL,
            reason: 'flu',
            fileIds: [FILE_ID],
          },
          ability,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(repo.canApplyFor).toHaveBeenCalledWith(USER_ID, ability);
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('should reject when endDate precedes startDate', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-10',
        endDate: '2026-05-09',
        type: LeaveType.CASUAL,
        reason: 'typo',
      };

      await expect(service.apply(input, ability)).rejects.toThrow(
        'Leave end date must not be before the start date.',
      );
      await expect(service.apply(input, ability)).rejects.toMatchObject({
        code: ErrorCode.INVALID_DATE_RANGE,
      });
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('should reject when the range spans 3+ calendar days and no files are attached', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-01',
        // 2026-05-01 → 2026-05-03 = 3 calendar days (>= MIN_DOCUMENTED_DAYS)
        endDate: '2026-05-03',
        type: LeaveType.MEDICAL,
        reason: 'flu',
        fileIds: [],
      };

      await expect(service.apply(input, ability)).rejects.toMatchObject({
        code: ErrorCode.LEAVE_DOCUMENT_REQUIRED,
      });
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('should verify the uploads, then create a 4-day leave with them and emit LEAVE.applied', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        type: LeaveType.MEDICAL,
        reason: 'flu with doctor note',
        fileIds: [FILE_ID],
      };
      const created = buildLeave({
        startDate: input.startDate,
        endDate: input.endDate,
        type: input.type,
        reason: input.reason,
        files: [buildFile()],
      });
      repo.create.mockResolvedValue(created);
      repo.findById.mockResolvedValue(created);

      const result = await service.apply(input, ability);

      expect(result).toBe(created);
      expect(repo.create).toHaveBeenCalledWith({
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        type: LeaveType.MEDICAL,
        reason: 'flu with doctor note',
        fileIds: [FILE_ID],
      });
      expect(verifyUploads).toHaveBeenCalledWith([FILE_ID], 'LEAVE_ATTACHMENT');
      expect(repo.findById).toHaveBeenCalledWith(LEAVE_ID, ability);
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.applied', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        type: LeaveType.MEDICAL,
      });
    });

    it('should accept a 2-calendar-day leave with no supporting files (under MIN_DOCUMENTED_DAYS = 3)', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        type: LeaveType.CASUAL,
        reason: 'short trip',
      };
      const created = buildLeave({ startDate: input.startDate, endDate: input.endDate });
      repo.create.mockResolvedValue(created);
      repo.findById.mockResolvedValue(created);

      const result = await service.apply(input, ability);

      expect(result).toBe(created);
      expect(repo.create).toHaveBeenCalledWith({
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        type: LeaveType.CASUAL,
        reason: 'short trip',
        fileIds: [],
      });
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.applied', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        type: LeaveType.CASUAL,
      });
    });

    it('should return the created leave without files when the caller cannot read it back', async () => {
      const created = buildLeave({
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        type: LeaveType.MEDICAL,
        reason: 'flu',
        files: [buildFile()],
      });
      repo.create.mockResolvedValue(created);
      repo.findById.mockResolvedValue(null);

      const result = await service.apply(
        {
          userId: USER_ID,
          startDate: '2026-05-01',
          endDate: '2026-05-05',
          type: LeaveType.MEDICAL,
          reason: 'flu',
          fileIds: [FILE_ID],
        },
        ability,
      );

      expect(result).toEqual(
        buildLeave({
          startDate: '2026-05-01',
          endDate: '2026-05-05',
          type: LeaveType.MEDICAL,
          reason: 'flu',
          files: [],
        }),
      );
      expect(repo.findById).toHaveBeenCalledWith(LEAVE_ID, ability);
    });
  });

  describe('apply with rejected uploads', () => {
    it('should not create the leave when an upload fails verification', async () => {
      verifyUploads.mockRejectedValue(
        new BusinessException(ErrorCode.FILE_CONTENT_MISMATCH, 'bad file'),
      );

      await expect(
        service.apply(
          {
            userId: USER_ID,
            startDate: '2026-05-01',
            endDate: '2026-05-05',
            type: LeaveType.MEDICAL,
            reason: 'flu',
            fileIds: [FILE_ID],
          },
          ability,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_CONTENT_MISMATCH });
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('should pass a file id given twice to the repo once', async () => {
      const created = buildLeave({ files: [buildFile()] });
      repo.create.mockResolvedValue(created);
      repo.findById.mockResolvedValue(created);

      await service.apply(
        {
          userId: USER_ID,
          startDate: '2026-05-01',
          endDate: '2026-05-01',
          type: LeaveType.CASUAL,
          reason: 'short',
          fileIds: [FILE_ID, FILE_ID],
        },
        ability,
      );

      expect(verifyUploads).toHaveBeenCalledWith([FILE_ID], 'LEAVE_ATTACHMENT');
      expect(repo.create).toHaveBeenCalledWith({
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        type: LeaveType.CASUAL,
        reason: 'short',
        fileIds: [FILE_ID],
      });
    });
  });

  describe('write gate', () => {
    const cases: Array<{
      name: string;
      action: AppAction;
      run: (svc: LeaveService, ab: AppAbility) => Promise<unknown>;
      write: (r: MockedRepo) => Mock;
    }> = [
      {
        name: 'update',
        action: 'update',
        run: (svc, ab) => svc.update(LEAVE_ID, { reason: 'changed' }, ab),
        write: (r) => r.update,
      },
      {
        name: 'approve',
        action: 'update',
        run: (svc, ab) => svc.approve(LEAVE_ID, ab, APPROVER_ID),
        write: (r) => r.setStatus,
      },
      {
        name: 'reject',
        action: 'update',
        run: (svc, ab) => svc.reject(LEAVE_ID, ab, APPROVER_ID),
        write: (r) => r.setStatus,
      },
      {
        name: 'cancel',
        action: 'withdraw',
        run: (svc, ab) => svc.cancel(LEAVE_ID, ab, USER_ID),
        write: (r) => r.setStatus,
      },
      {
        name: 'delete',
        action: 'delete',
        run: (svc, ab) => svc.delete(LEAVE_ID, ab),
        write: (r) => r.softDelete,
      },
    ];

    describe.each(cases)('$name', ({ action, run, write }) => {
      it('should throw LEAVE_NOT_FOUND for a leave the caller cannot read, without writing', async () => {
        repo.findById.mockResolvedValue(null);

        await expect(run(service, ability)).rejects.toMatchObject({
          code: ErrorCode.LEAVE_NOT_FOUND,
        });
        expect(repo.findById).toHaveBeenCalledWith(LEAVE_ID, ability);
        expect(repo.isAllowed).not.toHaveBeenCalled();
        expect(write(repo)).not.toHaveBeenCalled();
        expect(eventBusMock.emit).not.toHaveBeenCalled();
      });

      it(`should throw FORBIDDEN when the leave is readable but '${action}' is not allowed`, async () => {
        repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
        repo.isAllowed.mockResolvedValue(false);

        await expect(run(service, ability)).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
        expect(repo.isAllowed).toHaveBeenCalledWith(LEAVE_ID, ability, action);
        expect(write(repo)).not.toHaveBeenCalled();
        expect(eventBusMock.emit).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    it('should check the update rules before writing', async () => {
      repo.findById.mockResolvedValue(buildLeave());
      repo.update.mockResolvedValue(buildLeave({ reason: 'new' }));

      await service.update(LEAVE_ID, { reason: 'new' }, ability);

      expect(repo.isAllowed).toHaveBeenCalledWith(LEAVE_ID, ability, 'update');
    });

    it('should verify only the newly added files when the attachment set changes', async () => {
      repo.findById.mockResolvedValue(buildLeave({ files: [buildFile()] }));
      repo.update.mockResolvedValue(
        buildLeave({ files: [buildFile(), buildFile({ id: OTHER_FILE_ID })] }),
      );

      await service.update(LEAVE_ID, { fileIds: [FILE_ID, OTHER_FILE_ID] }, ability);

      expect(verifyUploads).toHaveBeenCalledWith([OTHER_FILE_ID], 'LEAVE_ATTACHMENT');
      expect(repo.update).toHaveBeenCalledWith(LEAVE_ID, {
        startDate: undefined,
        endDate: undefined,
        type: undefined,
        reason: undefined,
        fileIds: [FILE_ID, OTHER_FILE_ID],
      });
    });

    it('should refuse stretching an undocumented leave to 3 or more days', async () => {
      repo.findById.mockResolvedValue(
        buildLeave({ startDate: '2026-05-01', endDate: '2026-05-02' }),
      );

      await expect(
        service.update(LEAVE_ID, { endDate: '2026-05-03' }, ability),
      ).rejects.toMatchObject({ code: ErrorCode.LEAVE_DOCUMENT_REQUIRED });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should refuse removing every document from a leave of 3 or more days', async () => {
      repo.findById.mockResolvedValue(
        buildLeave({ startDate: '2026-05-01', endDate: '2026-05-05', files: [buildFile()] }),
      );

      await expect(service.update(LEAVE_ID, { fileIds: [] }, ability)).rejects.toMatchObject({
        code: ErrorCode.LEAVE_DOCUMENT_REQUIRED,
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should allow stretching a documented leave to 3 or more days', async () => {
      repo.findById.mockResolvedValue(
        buildLeave({ startDate: '2026-05-01', endDate: '2026-05-02', files: [buildFile()] }),
      );
      const updated = buildLeave({ endDate: '2026-05-06', files: [buildFile()] });
      repo.update.mockResolvedValue(updated);

      await expect(service.update(LEAVE_ID, { endDate: '2026-05-06' }, ability)).resolves.toBe(
        updated,
      );
    });

    it('should leave attachments alone when fileIds is omitted', async () => {
      repo.findById.mockResolvedValue(buildLeave({ files: [buildFile()] }));
      repo.update.mockResolvedValue(buildLeave({ reason: 'new', files: [buildFile()] }));

      await service.update(LEAVE_ID, { reason: 'new' }, ability);

      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(LEAVE_ID, {
        startDate: undefined,
        endDate: undefined,
        type: undefined,
        reason: 'new',
        fileIds: undefined,
      });
    });

    it('should reject when the existing leave is already APPROVED', async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.APPROVED }));

      await expect(
        service.update(LEAVE_ID, { reason: 'changed my mind' }, ability),
      ).rejects.toMatchObject({ code: ErrorCode.LEAVE_NOT_EDITABLE });
      expect(repo.update).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('should pass through to the repo when existing status is PENDING and emit LEAVE.updated', async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const updated = buildLeave({ reason: 'updated reason' });
      repo.update.mockResolvedValue(updated);

      const result = await service.update(LEAVE_ID, { reason: 'updated reason' }, ability);

      expect(result).toBe(updated);
      expect(repo.update).toHaveBeenCalledWith(LEAVE_ID, {
        startDate: undefined,
        endDate: undefined,
        type: undefined,
        reason: 'updated reason',
        fileIds: undefined,
      });
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.updated', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
      });
    });
  });

  describe('approve', () => {
    it('should store the approver membership, emit LEAVE.approved and NOTIFICATION.leave.decided', async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const approved = buildLeave({ status: LeaveStatus.APPROVED, decidedBy: APPROVER_ID });
      repo.setStatus.mockResolvedValue(approved);

      const result = await service.approve(LEAVE_ID, ability, APPROVER_ID);

      expect(result).toBe(approved);
      expect(repo.isAllowed).toHaveBeenCalledWith(LEAVE_ID, ability, 'update');
      expect(repo.setStatus).toHaveBeenCalledWith(LEAVE_ID, 'APPROVED', APPROVER_ID);
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.approved', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        approverMembershipId: APPROVER_ID,
      });
      expect(eventBusMock.emit).toHaveBeenCalledWith('NOTIFICATION.leave.decided', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        status: 'APPROVED',
      });
    });

    it('should reject with a BusinessException when transitioning from a terminal status', async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.REJECTED }));

      await expect(service.approve(LEAVE_ID, ability, APPROVER_ID)).rejects.toBeInstanceOf(
        BusinessException,
      );
      expect(repo.setStatus).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('should store the approver membership, emit LEAVE.rejected and NOTIFICATION.leave.decided', async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const rejected = buildLeave({ status: LeaveStatus.REJECTED, decidedBy: APPROVER_ID });
      repo.setStatus.mockResolvedValue(rejected);

      const result = await service.reject(LEAVE_ID, ability, APPROVER_ID);

      expect(result).toBe(rejected);
      expect(repo.isAllowed).toHaveBeenCalledWith(LEAVE_ID, ability, 'update');
      expect(repo.setStatus).toHaveBeenCalledWith(LEAVE_ID, 'REJECTED', APPROVER_ID);
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.rejected', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        approverMembershipId: APPROVER_ID,
      });
      expect(eventBusMock.emit).toHaveBeenCalledWith('NOTIFICATION.leave.decided', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        status: 'REJECTED',
      });
    });
  });

  describe('cancel', () => {
    it('should store the canceller membership, emit LEAVE.cancelled and no notification event', async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const cancelled = buildLeave({ status: LeaveStatus.CANCELLED, decidedBy: USER_ID });
      repo.setStatus.mockResolvedValue(cancelled);

      const result = await service.cancel(LEAVE_ID, ability, USER_ID);

      expect(result).toBe(cancelled);
      expect(repo.isAllowed).toHaveBeenCalledWith(LEAVE_ID, ability, 'withdraw');
      expect(repo.setStatus).toHaveBeenCalledWith(LEAVE_ID, 'CANCELLED', USER_ID);
      expect(eventBusMock.emit).toHaveBeenCalledTimes(1);
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.cancelled', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
      });
    });
  });

  describe('delete', () => {
    it('should check the delete rules, soft-delete and emit LEAVE.deleted with tenantId', async () => {
      repo.findById.mockResolvedValue(buildLeave());
      repo.softDelete.mockResolvedValue(undefined);

      const result = await service.delete(LEAVE_ID, ability);

      expect(result).toBe(true);
      expect(repo.isAllowed).toHaveBeenCalledWith(LEAVE_ID, ability, 'delete');
      expect(repo.softDelete).toHaveBeenCalledWith(LEAVE_ID);
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.deleted', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
      });
    });
  });

  describe('approvedOnDate', () => {
    it('should short-circuit to [] on empty userIds without hitting the repo', async () => {
      const result = await service.approvedOnDate('2026-05-01', []);

      expect(result).toEqual([]);
      expect(repo.approvedOnDate).not.toHaveBeenCalled();
    });

    it('should forward non-empty userIds and the date to the repo', async () => {
      const hits = [USER_ID];
      repo.approvedOnDate.mockResolvedValue(hits);

      const result = await service.approvedOnDate('2026-05-01', [USER_ID]);

      expect(result).toBe(hits);
      expect(repo.approvedOnDate).toHaveBeenCalledWith({ date: '2026-05-01', userIds: [USER_ID] });
    });
  });
});
