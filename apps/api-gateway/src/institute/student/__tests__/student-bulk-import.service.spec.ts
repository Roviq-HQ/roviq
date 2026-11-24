import type { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileService } from '../../../files/file.service';
import type { StudentRepository } from '../repositories/student.repository';
import { StudentBulkImportService } from '../student-bulk-import.service';

const connect = vi.hoisted(() => vi.fn());
const start = vi.hoisted(() => vi.fn());
vi.mock('@temporalio/client', () => ({
  Connection: { connect },
  Client: class {
    workflow = { start };
  },
}));

const TENANT_ID = '00000000-0000-7000-a000-000000000101';
const OTHER_TENANT_ID = '00000000-0000-7000-a000-000000000102';

describe('StudentBulkImportService', () => {
  let claimUploads: ReturnType<typeof vi.fn<FileService['claimUploads']>>;
  let checkAdmissionClass: ReturnType<typeof vi.fn<StudentRepository['checkAdmissionClass']>>;
  let service: StudentBulkImportService;

  const input = {
    tenantId: TENANT_ID,
    fileId: 'file-1',
    academicYearId: 'year-1',
    standardId: 'standard-1',
    sectionId: 'section-1',
    createdBy: 'user-1',
    fieldMapping: {},
  };

  beforeEach(() => {
    connect.mockReset().mockResolvedValue({ close: vi.fn() });
    start.mockReset().mockResolvedValue(undefined);
    claimUploads = vi.fn<FileService['claimUploads']>().mockResolvedValue(undefined);
    checkAdmissionClass = vi
      .fn<StudentRepository['checkAdmissionClass']>()
      .mockResolvedValue({ kind: 'ok' });
    service = new StudentBulkImportService(
      createMock<ConfigService>({ get: vi.fn().mockReturnValue('temporal:7233') }),
      createMock<FileService>({ claimUploads }),
      createMock<StudentRepository>({ checkAdmissionClass }),
    );
  });

  describe('startBulkImport', () => {
    it('should claim the uploaded CSV, then start a workflow named after the institute', async () => {
      const workflowId = await service.startBulkImport(input);

      expect(claimUploads).toHaveBeenCalledWith(['file-1'], 'BULK_IMPORT_CSV');
      expect(workflowId.startsWith(`bulk-student-import-${TENANT_ID}-`)).toBe(true);
      expect(start).toHaveBeenCalledWith('BulkStudentImportWorkflow', {
        taskQueue: 'student-bulk-import',
        workflowId,
        workflowExecutionTimeout: '10 minutes',
        args: [input],
      });
    });

    it('should refuse a class that is not of the institute before claiming the upload', async () => {
      checkAdmissionClass.mockResolvedValue({ kind: 'section_not_found' });

      await expect(service.startBulkImport(input)).rejects.toMatchObject({
        code: ErrorCode.SECTION_NOT_FOUND,
      });

      expect(checkAdmissionClass).toHaveBeenCalledWith(TENANT_ID, {
        academicYearId: 'year-1',
        standardId: 'standard-1',
        sectionId: 'section-1',
      });
      expect(claimUploads).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    });

    it('should not start a workflow when the upload cannot be claimed', async () => {
      claimUploads.mockRejectedValue(new Error('FILE_NOT_FOUND'));

      await expect(service.startBulkImport(input)).rejects.toThrow('FILE_NOT_FOUND');
      expect(start).not.toHaveBeenCalled();
    });
  });

  describe('getProgress', () => {
    it("should answer not found for another institute's import without asking Temporal", async () => {
      const foreign = `bulk-student-import-${OTHER_TENANT_ID}-1763000000000`;

      await expect(service.getProgress(TENANT_ID, foreign)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
      expect(connect).not.toHaveBeenCalled();
    });
  });
});
