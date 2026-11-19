/**
 * Unit tests for LeaveService — covers read/list passthroughs, the apply-time
 * date-range + supporting-document rules, the PENDING-only edit gate, the
 * three status transitions (approve / reject / cancel) and their differing
 * NATS emission sets, soft-delete, and the attendance-side `approvedOnDate`
 * short-circuit.
 *
 * Mirrors `attendance.service.spec.ts`: the repository is a manually-typed
 * `vi.fn()` map against the abstract class contract, the NATS client is a
 * stub whose `emit()` returns an observable-like `{ subscribe }`, and the
 * service is constructed via `Object.assign(Object.create(Proto), {...})`
 * so we skip the real constructor (decorator + parameter-property shorthand
 * does not reliably wire private fields under esbuild/Vitest).
 */

import { createMongoAbility } from '@casl/ability';
import {
  type AppAbility,
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

// LeaveService now reads `tenantId` from request context (delete event includes
// it for downstream routing — HL-009). `vi.mock` is hoisted to the top of the
// file by Vitest, so the service's module-level `getRequestContext` reference
// resolves to this mock even though it's declared after the import.
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

/**
 * Minimal EventBusService stand-in — exposes a synchronous `emit` so the
 * service can call `eventBus.emit(pattern, data)` without going through NATS.
 */
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

/**
 * Manual repository mock — typed against the abstract class contract so any
 * signature drift in production code surfaces as a type error here.
 */
type MockedRepo = {
  [K in keyof LeaveRepository]: Mock;
};

function buildRepoMock(): MockedRepo {
  return {
    findById: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    softDelete: vi.fn(),
    approvedOnDate: vi.fn(),
  };
}

describe('LeaveService (unit)', () => {
  let service: LeaveService;
  let repo: MockedRepo;
  let eventBusMock: ReturnType<typeof buildEventBusMock>;
  let verifyUploads: Mock<FileService['verifyUploads']>;

  beforeEach(() => {
    repo = buildRepoMock();
    eventBusMock = buildEventBusMock();
    verifyUploads = vi.fn<FileService['verifyUploads']>().mockResolvedValue(undefined);
    // Build the instance via the prototype so we skip the real constructor.
    // The constructor uses TS parameter-property shorthand which esbuild
    // does not fully wire under Vitest — private fields end up undefined.
    service = Object.assign(Object.create(LeaveService.prototype), {
      repo,
      eventBus: eventBusMock.eventBus,
      files: createMock<FileService>({ verifyUploads }),
    });
  });

  describe('findById', () => {
    it('returns the record from the repo', async () => {
      const existing = buildLeave();
      repo.findById.mockResolvedValue(existing);

      const result = await service.findById(LEAVE_ID);

      expect(result).toBe(existing);
      expect(repo.findById).toHaveBeenCalledWith(LEAVE_ID);
    });

    it('rejects when the repo returns null', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.findById(LEAVE_ID)).rejects.toMatchObject({
        code: ErrorCode.LEAVE_NOT_FOUND,
      });
    });
  });

  describe('list', () => {
    it('forwards every filter field untouched to the repo', async () => {
      const filter = {
        userId: USER_ID,
        status: LeaveStatus.APPROVED,
        type: LeaveType.MEDICAL,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      };
      const rows = [buildLeave()];
      repo.list.mockResolvedValue(rows);

      const result = await service.list(filter);

      expect(result).toBe(rows);
      expect(repo.list).toHaveBeenCalledWith(filter);
    });
  });

  describe('apply', () => {
    it('rejects when endDate precedes startDate', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-10',
        endDate: '2026-05-09',
        type: LeaveType.CASUAL,
        reason: 'typo',
      };

      // The service wraps `assertValidRange` — message matches production.
      await expect(service.apply(input)).rejects.toThrow(
        'Leave end date must not be before the start date.',
      );
      await expect(service.apply(input)).rejects.toMatchObject({
        code: ErrorCode.INVALID_DATE_RANGE,
      });
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('rejects when the range spans 3+ calendar days and no files are attached', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-01',
        // 2026-05-01 → 2026-05-03 = 3 calendar days (>= MIN_DOCUMENTED_DAYS)
        endDate: '2026-05-03',
        type: LeaveType.MEDICAL,
        reason: 'flu',
        fileIds: [],
      };

      await expect(service.apply(input)).rejects.toMatchObject({
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

      const result = await service.apply(input);

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
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'LEAVE.applied',
        expect.objectContaining({
          leaveId: created.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          startDate: '2026-05-01',
          endDate: '2026-05-05',
          type: LeaveType.MEDICAL,
        }),
      );
    });

    it('accepts a 2-calendar-day leave with no supporting files (under MIN_DOCUMENTED_DAYS = 3)', async () => {
      const input = {
        userId: USER_ID,
        startDate: '2026-05-01',
        // 2026-05-01 → 2026-05-02 = 2 calendar days (< MIN_DOCUMENTED_DAYS = 3)
        endDate: '2026-05-02',
        type: LeaveType.CASUAL,
        reason: 'short trip',
      };
      const created = buildLeave({
        startDate: input.startDate,
        endDate: input.endDate,
      });
      repo.create.mockResolvedValue(created);

      const result = await service.apply(input);

      expect(result).toBe(created);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          fileIds: [],
        }),
      );
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.applied', expect.anything());
    });
  });

  describe('filesVisibleTo', () => {
    const ownLeavesOnly = createMongoAbility<AppAbility>([
      { action: 'read', subject: 'Leave', conditions: { userId: USER_ID } },
    ]);

    it('should show the files of a leave the ability covers', () => {
      const leave = buildLeave({ files: [buildFile()] });

      expect(service.filesVisibleTo(ownLeavesOnly, leave)).toEqual([buildFile()]);
    });

    it("should hide the files of another person's leave from an own-leaves-only ability", () => {
      const leave = buildLeave({ userId: APPROVER_ID, files: [buildFile()] });

      expect(service.filesVisibleTo(ownLeavesOnly, leave)).toEqual([]);
    });

    it("should show every leave's files to an unconditional read ability", () => {
      const readAll = createMongoAbility<AppAbility>([{ action: 'read', subject: 'Leave' }]);
      const leave = buildLeave({ userId: APPROVER_ID, files: [buildFile()] });

      expect(service.filesVisibleTo(readAll, leave)).toEqual([buildFile()]);
    });

    it('should hide files when no ability was resolved for the request', () => {
      expect(service.filesVisibleTo(undefined, buildLeave({ files: [buildFile()] }))).toEqual([]);
    });
  });

  describe('apply with rejected uploads', () => {
    it('should not create the leave when an upload fails verification', async () => {
      verifyUploads.mockRejectedValue(
        new BusinessException(ErrorCode.FILE_CONTENT_MISMATCH, 'bad file'),
      );

      await expect(
        service.apply({
          userId: USER_ID,
          startDate: '2026-05-01',
          endDate: '2026-05-05',
          type: LeaveType.MEDICAL,
          reason: 'flu',
          fileIds: [FILE_ID],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_CONTENT_MISMATCH });
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('should pass a file id given twice to the repo once', async () => {
      repo.create.mockResolvedValue(buildLeave({ files: [buildFile()] }));

      await service.apply({
        userId: USER_ID,
        startDate: '2026-05-01',
        endDate: '2026-05-01',
        type: LeaveType.CASUAL,
        reason: 'short',
        fileIds: [FILE_ID, FILE_ID],
      });

      expect(verifyUploads).toHaveBeenCalledWith([FILE_ID], 'LEAVE_ATTACHMENT');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ fileIds: [FILE_ID] }));
    });
  });

  describe('update', () => {
    it('should verify only the newly added files when the attachment set changes', async () => {
      repo.findById.mockResolvedValue(buildLeave({ files: [buildFile()] }));
      repo.update.mockResolvedValue(
        buildLeave({ files: [buildFile(), buildFile({ id: OTHER_FILE_ID })] }),
      );

      await service.update(LEAVE_ID, { fileIds: [FILE_ID, OTHER_FILE_ID] });

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

      await expect(service.update(LEAVE_ID, { endDate: '2026-05-03' })).rejects.toMatchObject({
        code: ErrorCode.LEAVE_DOCUMENT_REQUIRED,
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should refuse removing every document from a leave of 3 or more days', async () => {
      repo.findById.mockResolvedValue(
        buildLeave({ startDate: '2026-05-01', endDate: '2026-05-05', files: [buildFile()] }),
      );

      await expect(service.update(LEAVE_ID, { fileIds: [] })).rejects.toMatchObject({
        code: ErrorCode.LEAVE_DOCUMENT_REQUIRED,
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should allow stretching a documented leave to 3 or more days', async () => {
      const existing = buildLeave({
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        files: [buildFile()],
      });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(buildLeave({ endDate: '2026-05-06', files: [buildFile()] }));

      await expect(service.update(LEAVE_ID, { endDate: '2026-05-06' })).resolves.toMatchObject({
        endDate: '2026-05-06',
      });
    });

    it('should leave attachments alone when fileIds is omitted', async () => {
      repo.findById.mockResolvedValue(buildLeave({ files: [buildFile()] }));
      repo.update.mockResolvedValue(buildLeave({ reason: 'new', files: [buildFile()] }));

      await service.update(LEAVE_ID, { reason: 'new' });

      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(LEAVE_ID, {
        startDate: undefined,
        endDate: undefined,
        type: undefined,
        reason: 'new',
        fileIds: undefined,
      });
    });

    it('rejects when the existing leave is already APPROVED', async () => {
      const existing = buildLeave({ status: LeaveStatus.APPROVED });
      repo.findById.mockResolvedValue(existing);

      await expect(service.update(LEAVE_ID, { reason: 'changed my mind' })).rejects.toMatchObject({
        code: ErrorCode.LEAVE_NOT_EDITABLE,
      });
      expect(repo.update).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });

    it('passes through to the repo when existing status is PENDING and emits LEAVE.updated', async () => {
      const existing = buildLeave({ status: LeaveStatus.PENDING });
      repo.findById.mockResolvedValue(existing);
      const updated = buildLeave({ reason: 'updated reason' });
      repo.update.mockResolvedValue(updated);

      const patch = { reason: 'updated reason' };
      const result = await service.update(LEAVE_ID, patch);

      expect(result).toBe(updated);
      expect(repo.update).toHaveBeenCalledWith(LEAVE_ID, patch);
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'LEAVE.updated',
        expect.objectContaining({
          leaveId: updated.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
        }),
      );
    });
  });

  describe('approve', () => {
    it("delegates to repo.setStatus('APPROVED', ...) and emits LEAVE.approved + NOTIFICATION.leave.decided", async () => {
      // HL-001: state machine reads existing status before transitioning, so
      // the test must seed `findById` with a PENDING row.
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const approved = buildLeave({ status: LeaveStatus.APPROVED, decidedBy: APPROVER_ID });
      repo.setStatus.mockResolvedValue(approved);

      const result = await service.approve(LEAVE_ID, APPROVER_ID);

      expect(result).toBe(approved);
      expect(repo.setStatus).toHaveBeenCalledWith(LEAVE_ID, 'APPROVED', APPROVER_ID);
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'LEAVE.approved',
        expect.objectContaining({
          leaveId: approved.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          approverMembershipId: APPROVER_ID,
        }),
      );
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'NOTIFICATION.leave.decided',
        expect.objectContaining({
          leaveId: approved.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          status: 'APPROVED',
        }),
      );
    });

    it('rejects with BusinessException(INVALID_STATE_TRANSITION) when transitioning from a terminal status', async () => {
      // HL-001: APPROVED → APPROVED, REJECTED → APPROVED, CANCELLED → APPROVED
      // are all illegal under the new state machine. setStatus must NOT run.
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.REJECTED }));

      await expect(service.approve(LEAVE_ID, APPROVER_ID)).rejects.toBeInstanceOf(
        BusinessException,
      );
      expect(repo.setStatus).not.toHaveBeenCalled();
      expect(eventBusMock.emit).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it("delegates to repo.setStatus('REJECTED', ...) and emits LEAVE.rejected + NOTIFICATION.leave.decided", async () => {
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const rejected = buildLeave({ status: LeaveStatus.REJECTED, decidedBy: APPROVER_ID });
      repo.setStatus.mockResolvedValue(rejected);

      const result = await service.reject(LEAVE_ID, APPROVER_ID);

      expect(result).toBe(rejected);
      expect(repo.setStatus).toHaveBeenCalledWith(LEAVE_ID, 'REJECTED', APPROVER_ID);
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'LEAVE.rejected',
        expect.objectContaining({
          leaveId: rejected.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          approverMembershipId: APPROVER_ID,
        }),
      );
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'NOTIFICATION.leave.decided',
        expect.objectContaining({
          leaveId: rejected.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
          status: 'REJECTED',
        }),
      );
    });
  });

  describe('cancel', () => {
    it("delegates to repo.setStatus('CANCELLED', ...), emits LEAVE.cancelled, and does NOT emit the notification event", async () => {
      // PENDING → CANCELLED and APPROVED → CANCELLED are both legal; the
      // applicant can withdraw a still-pending request OR an already-approved one.
      repo.findById.mockResolvedValue(buildLeave({ status: LeaveStatus.PENDING }));
      const cancelled = buildLeave({ status: LeaveStatus.CANCELLED, decidedBy: APPROVER_ID });
      repo.setStatus.mockResolvedValue(cancelled);

      const result = await service.cancel(LEAVE_ID, APPROVER_ID);

      expect(result).toBe(cancelled);
      expect(repo.setStatus).toHaveBeenCalledWith(LEAVE_ID, 'CANCELLED', APPROVER_ID);
      expect(eventBusMock.emit).toHaveBeenCalledWith(
        'LEAVE.cancelled',
        expect.objectContaining({
          leaveId: cancelled.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
        }),
      );
      const patterns = eventBusMock.emit.mock.calls.map((c) => c[0]);
      expect(patterns).not.toContain('NOTIFICATION.leave.decided');
    });
  });

  describe('delete', () => {
    it('calls repo.softDelete and emits LEAVE.deleted with tenantId (HL-009)', async () => {
      repo.softDelete.mockResolvedValue(undefined);

      const result = await service.delete(LEAVE_ID);

      expect(result).toBe(true);
      expect(repo.softDelete).toHaveBeenCalledWith(LEAVE_ID);
      // HL-009: every lifecycle event must carry tenantId so consumers don't
      // need to look up the row to route on multi-tenant DLQs.
      expect(eventBusMock.emit).toHaveBeenCalledWith('LEAVE.deleted', {
        leaveId: LEAVE_ID,
        tenantId: TENANT_ID,
      });
    });
  });

  describe('approvedOnDate', () => {
    it('short-circuits to [] on empty userIds without hitting the repo', async () => {
      const result = await service.approvedOnDate('2026-05-01', []);

      expect(result).toEqual([]);
      expect(repo.approvedOnDate).not.toHaveBeenCalled();
    });

    it('forwards non-empty userIds + date to the repo', async () => {
      const userIds = [USER_ID];
      const hits = [USER_ID];
      repo.approvedOnDate.mockResolvedValue(hits);

      const result = await service.approvedOnDate('2026-05-01', userIds);

      expect(result).toBe(hits);
      expect(repo.approvedOnDate).toHaveBeenCalledWith({
        date: '2026-05-01',
        userIds,
      });
    });
  });
});
