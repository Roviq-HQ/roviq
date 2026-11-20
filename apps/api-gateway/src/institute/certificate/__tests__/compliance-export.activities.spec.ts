import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { DrizzleDB } from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { createMock } from '@roviq/testing';
import { ApplicationFailure } from '@temporalio/activity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFileStore } from '../../../files/workflow-file-store';
import type { ExportReportRepository } from '../repositories/export-report.repository';
import type { ExportReportRecord } from '../repositories/types';
import {
  COMPLIANCE_EXPORT_GENERATORS,
  type ComplianceExportGenerator,
  createComplianceExportActivities,
  exportErrorCode,
} from '../workflows/compliance-export.activities';
import type { ComplianceExportInput } from '../workflows/compliance-export.types';

const TENANT = '00000000-0000-7000-a000-0000000000a1';
const REPORT = '00000000-0000-7000-a000-0000000000b1';
const YEAR = '00000000-0000-7000-a000-0000000000c1';
const USER = '00000000-0000-7000-a000-0000000000d1';
const FILE = '00000000-0000-7000-a000-0000000000e1';

const INPUT: ComplianceExportInput = {
  exportReportId: REPORT,
  tenantId: TENANT,
  reportType: 'BSEH_STAFF_STATEMENT',
  academicYearId: YEAR,
  requestedBy: USER,
  fileId: FILE,
  fileName: 'RVQ-001-BSEH_STAFF_STATEMENT-2025-26.xlsx',
};

function record(overrides: Partial<ExportReportRecord> = {}): ExportReportRecord {
  return {
    id: REPORT,
    tenantId: TENANT,
    reportType: 'BSEH_STAFF_STATEMENT',
    academicYearId: YEAR,
    academicYearLabel: '2025-26',
    status: 'PENDING',
    workflowId: 'compliance-export-1',
    fileId: null,
    rowCount: null,
    errorCode: null,
    requestedBy: USER,
    requesterFirstName: null,
    requesterLastName: null,
    requestedAt: new Date('2026-11-20T10:00:00Z'),
    completedAt: null,
    version: 1,
    ...overrides,
  };
}

const stateConflict = () =>
  new BusinessException(ErrorCode.INVALID_STATE_TRANSITION, 'Export report moved on');

describe('compliance export activities', () => {
  let repo: ExportReportRepository;
  let putPending: ReturnType<typeof vi.fn<WorkflowFileStore['putPending']>>;
  let emit: ReturnType<typeof vi.fn<EventBusService['emit']>>;
  let generator: ReturnType<typeof vi.fn<ComplianceExportGenerator>>;
  const db = createMock<DrizzleDB>();

  function activities() {
    return createComplianceExportActivities({
      db,
      repo,
      fileStore: { putPending },
      eventBus: { emit },
      generators: { ...COMPLIANCE_EXPORT_GENERATORS, BSEH_STAFF_STATEMENT: generator },
      logger: { log: vi.fn(), warn: vi.fn() },
    });
  }

  beforeEach(() => {
    repo = createMock<ExportReportRepository>();
    putPending = vi.fn<WorkflowFileStore['putPending']>().mockResolvedValue(undefined);
    emit = vi.fn<EventBusService['emit']>();
    generator = vi
      .fn<ComplianceExportGenerator>()
      .mockResolvedValue({ buffer: Buffer.from('PK-xlsx-bytes'), rowCount: 7 });
  });

  describe('COMPLIANCE_EXPORT_GENERATORS', () => {
    it('should have a generator for every report type', () => {
      expect(Object.keys(COMPLIANCE_EXPORT_GENERATORS).sort()).toEqual(
        [
          'AWR',
          'BSEH_STAFF_STATEMENT',
          'CBSE_LOC',
          'CBSE_REGISTRATION',
          'RTE_REPORT',
          'SHALA_DARPAN',
          'TC_REGISTER',
          'UDISE_DCF',
        ].sort(),
      );
    });
  });

  describe('markExportRunning', () => {
    it('should move the export from PENDING to RUNNING as the institute', async () => {
      await activities().markExportRunning(INPUT);

      expect(repo.markRunning).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'institute', tenantId: TENANT }),
        REPORT,
        USER,
      );
    });

    it('should succeed on a retry whose earlier attempt already moved it to RUNNING', async () => {
      vi.mocked(repo.markRunning).mockRejectedValue(stateConflict());
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'RUNNING' }));

      await expect(activities().markExportRunning(INPUT)).resolves.toBeUndefined();
    });

    it('should fail without retrying when the export is already finished', async () => {
      vi.mocked(repo.markRunning).mockRejectedValue(stateConflict());
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'FAILED' }));

      const failure = await activities()
        .markExportRunning(INPUT)
        .catch((err: unknown) => err);

      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect(failure).toMatchObject({
        type: ErrorCode.INVALID_STATE_TRANSITION,
        nonRetryable: true,
      });
    });
  });

  describe('generateExportFile', () => {
    it('should store the generated workbook as a PENDING compliance export under the given file id', async () => {
      const result = await activities().generateExportFile(INPUT);

      expect(generator).toHaveBeenCalledWith(db, TENANT, YEAR);
      expect(putPending).toHaveBeenCalledWith({
        tenantId: TENANT,
        fileId: FILE,
        purpose: 'COMPLIANCE_EXPORT',
        fileName: 'RVQ-001-BSEH_STAFF_STATEMENT-2025-26.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: Buffer.from('PK-xlsx-bytes'),
        createdBy: USER,
      });
      expect(result).toEqual({ rowCount: 7, sizeBytes: Buffer.from('PK-xlsx-bytes').length });
    });

    it('should let a generator error through so Temporal retries it, storing nothing', async () => {
      generator.mockRejectedValue(new Error('connection reset'));

      await expect(activities().generateExportFile(INPUT)).rejects.toThrow('connection reset');
      expect(putPending).not.toHaveBeenCalled();
    });

    it('should refuse a workbook larger than the stored-file limit without retrying', async () => {
      generator.mockResolvedValue({ buffer: Buffer.alloc(50 * 1024 * 1024 + 1), rowCount: 1 });

      const failure = await activities()
        .generateExportFile(INPUT)
        .catch((err: unknown) => err);

      expect(failure).toMatchObject({ type: ErrorCode.FILE_TOO_LARGE, nonRetryable: true });
      expect(putPending).not.toHaveBeenCalled();
    });
  });

  describe('markExportCompleted', () => {
    it('should complete the export with its file and row count and emit EXPORT.completed', async () => {
      await activities().markExportCompleted({ ...INPUT, rowCount: 7 });

      expect(repo.markCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'institute', tenantId: TENANT }),
        { id: REPORT, tenantId: TENANT, fileId: FILE, rowCount: 7, userId: USER },
      );
      expect(emit).toHaveBeenCalledWith(EVENT_PATTERNS.EXPORT.completed, {
        tenantId: TENANT,
        exportReportId: REPORT,
        reportType: 'BSEH_STAFF_STATEMENT',
        academicYearId: YEAR,
        requestedBy: USER,
        fileId: FILE,
        rowCount: 7,
      });
    });

    it('should succeed silently on a retry whose earlier attempt completed the same file', async () => {
      vi.mocked(repo.markCompleted).mockRejectedValue(stateConflict());
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'COMPLETED', fileId: FILE }));

      await activities().markExportCompleted({ ...INPUT, rowCount: 7 });

      expect(emit).not.toHaveBeenCalled();
    });

    it('should fail without retrying when the export failed meanwhile', async () => {
      vi.mocked(repo.markCompleted).mockRejectedValue(stateConflict());
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'FAILED' }));

      await expect(
        activities().markExportCompleted({ ...INPUT, rowCount: 7 }),
      ).rejects.toMatchObject({ type: ErrorCode.INVALID_STATE_TRANSITION, nonRetryable: true });
    });
  });

  describe('markExportFailed', () => {
    it('should fail a RUNNING export with EXPORT_GENERATION_FAILED for an unexpected error', async () => {
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'RUNNING' }));

      await activities().markExportFailed({ ...INPUT, failureType: 'Error' });

      expect(repo.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'institute', tenantId: TENANT }),
        {
          id: REPORT,
          from: 'RUNNING',
          errorCode: ErrorCode.EXPORT_GENERATION_FAILED,
          userId: USER,
        },
      );
      expect(emit).toHaveBeenCalledWith(EVENT_PATTERNS.EXPORT.failed, {
        tenantId: TENANT,
        exportReportId: REPORT,
        reportType: 'BSEH_STAFF_STATEMENT',
        academicYearId: YEAR,
        requestedBy: USER,
        errorCode: ErrorCode.EXPORT_GENERATION_FAILED,
      });
    });

    it('should fail a PENDING export, keeping a FILE_TOO_LARGE code', async () => {
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'PENDING' }));

      await activities().markExportFailed({ ...INPUT, failureType: ErrorCode.FILE_TOO_LARGE });

      expect(repo.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'institute' }),
        { id: REPORT, from: 'PENDING', errorCode: ErrorCode.FILE_TOO_LARGE, userId: USER },
      );
    });

    it('should leave an export that already finished untouched', async () => {
      vi.mocked(repo.findById).mockResolvedValue(record({ status: 'COMPLETED', fileId: FILE }));

      await activities().markExportFailed({ ...INPUT, failureType: null });

      expect(repo.markFailed).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('exportErrorCode', () => {
    it.each([
      [ErrorCode.FILE_TOO_LARGE, ErrorCode.FILE_TOO_LARGE],
      [ErrorCode.INVALID_STATE_TRANSITION, ErrorCode.INVALID_STATE_TRANSITION],
      ['Error', ErrorCode.EXPORT_GENERATION_FAILED],
      [null, ErrorCode.EXPORT_GENERATION_FAILED],
    ])('should map %s to %s', (failureType, expected) => {
      expect(exportErrorCode(failureType)).toBe(expected);
    });
  });
});
