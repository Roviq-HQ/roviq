/**
 * ROV-169 — Unit tests for StaffQualificationService (no DB).
 *
 * The repository is mocked; the queries and the file transitions inside its transactions are
 * covered by the e2e staff certificate spec.
 */

import { ErrorCode, QualificationType } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { FileService } from '../../../files/file.service';
import { StaffQualificationRepository } from '../repositories/staff-qualification.repository';
import type {
  StaffQualificationRow,
  StaffQualificationWriteRow,
} from '../repositories/staff-qualification.types';
import { StaffQualificationService } from '../staff-qualification.service';

// The service imports FileService for its type only; its module pulls in storage and sharp.
vi.mock('../../../files/file.service', () => ({ FileService: class {} }));

vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    correlationId: 'test',
  })),
}));

function qualification(overrides: Partial<StaffQualificationWriteRow>): StaffQualificationWriteRow {
  return {
    id: 'q',
    tenantId: 'tenant-1',
    staffProfileId: 'staff-1',
    type: QualificationType.ACADEMIC,
    degreeName: 'B.Ed',
    institution: null,
    boardUniversity: null,
    yearOfPassing: null,
    gradePercentage: null,
    certificateFileId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    deletedBy: null,
    version: 1,
    ...overrides,
  };
}

function createService(repo: StaffQualificationRepository, files: FileService) {
  return new StaffQualificationService(repo, files);
}

describe('StaffQualificationService (unit)', () => {
  let repo: StaffQualificationRepository;
  let verifyUploads: Mock<FileService['verifyUploads']>;
  let service: StaffQualificationService;

  beforeEach(() => {
    repo = createMock<StaffQualificationRepository>();
    verifyUploads = vi.fn<FileService['verifyUploads']>();
    service = createService(repo, createMock<FileService>({ verifyUploads }));
  });

  it('listForStaff returns the rows from the repository', async () => {
    const rows: StaffQualificationRow[] = [
      qualification({ id: 'q1', degreeName: 'B.Ed' }),
      qualification({ id: 'q2', degreeName: 'M.Sc' }),
    ];
    vi.mocked(repo.listForStaff).mockResolvedValue(rows);

    const result = await service.listForStaff('staff-1');

    expect(result).toEqual(rows);
    expect(repo.listForStaff).toHaveBeenCalledWith('tenant-1', 'staff-1');
  });

  describe('create', () => {
    const input = {
      staffProfileId: 'staff-1',
      type: QualificationType.ACADEMIC,
      degreeName: 'B.Ed',
    };
    const inserted = qualification({ id: 'q3' });

    it('should return the inserted row and touch no file when there is no certificate', async () => {
      vi.mocked(repo.staffExists).mockResolvedValue(true);
      vi.mocked(repo.create).mockResolvedValue(inserted);

      const result = await service.create(input);

      expect(result).toEqual(inserted);
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        staffProfileId: 'staff-1',
        type: QualificationType.ACADEMIC,
        degreeName: 'B.Ed',
        institution: null,
        boardUniversity: null,
        yearOfPassing: null,
        gradePercentage: null,
        certificateFileId: null,
      });
    });

    it('should verify the certificate upload and make it ready with the row', async () => {
      vi.mocked(repo.staffExists).mockResolvedValue(true);
      vi.mocked(repo.create).mockResolvedValue({ ...inserted, certificateFileId: 'file-1' });

      await service.create({ ...input, certificateFileId: 'file-1' });

      expect(verifyUploads).toHaveBeenCalledWith(['file-1'], 'STAFF_CERTIFICATE');
      expect(repo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        actorId: 'user-1',
        staffProfileId: 'staff-1',
        type: QualificationType.ACADEMIC,
        degreeName: 'B.Ed',
        institution: null,
        boardUniversity: null,
        yearOfPassing: null,
        gradePercentage: null,
        certificateFileId: 'file-1',
      });
    });

    it('should refuse a staff member that is not in this institute before looking at the file', async () => {
      vi.mocked(repo.staffExists).mockResolvedValue(false);

      await expect(service.create({ ...input, certificateFileId: 'file-1' })).rejects.toMatchObject(
        { code: ErrorCode.STAFF_NOT_FOUND },
      );
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const updated = qualification({ id: 'q4', degreeName: 'B.Ed (Revised)' });

    beforeEach(() => {
      vi.mocked(repo.findLive).mockResolvedValue({ id: 'q4', certificateFileId: 'old-file' });
      vi.mocked(repo.update).mockResolvedValue(updated);
    });

    it('should keep the certificate when the input does not mention it', async () => {
      const result = await service.update('q4', { degreeName: 'B.Ed (Revised)' });

      expect(result).toEqual(updated);
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'tenant-1',
        'q4',
        'user-1',
        { degreeName: 'B.Ed (Revised)' },
        null,
      );
    });

    it('should attach the new certificate and delete the one it replaces', async () => {
      await service.update('q4', { certificateFileId: 'new-file' });

      expect(verifyUploads).toHaveBeenCalledWith(['new-file'], 'STAFF_CERTIFICATE');
      expect(repo.update).toHaveBeenCalledWith(
        'tenant-1',
        'q4',
        'user-1',
        {},
        { newFileId: 'new-file', previousFileId: 'old-file' },
      );
    });

    it('should delete the certificate when the input sets it to null', async () => {
      await service.update('q4', { certificateFileId: null });

      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        'tenant-1',
        'q4',
        'user-1',
        {},
        { newFileId: null, previousFileId: 'old-file' },
      );
    });

    it('should do nothing to files when the same certificate is sent again', async () => {
      await service.update('q4', { certificateFileId: 'old-file' });

      expect(verifyUploads).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('tenant-1', 'q4', 'user-1', {}, null);
    });

    it('should reject when no live row matches', async () => {
      vi.mocked(repo.findLive).mockResolvedValue(null);

      await expect(service.update('missing', { degreeName: 'X' })).rejects.toMatchObject({
        code: ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
      });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should soft-delete the row together with its certificate', async () => {
      vi.mocked(repo.findLive).mockResolvedValue({ id: 'q5', certificateFileId: 'file-5' });

      const result = await service.delete('q5');

      expect(result).toBe(true);
      expect(repo.softDelete).toHaveBeenCalledOnce();
      expect(repo.softDelete).toHaveBeenCalledWith('tenant-1', 'q5', 'user-1', 'file-5');
    });

    it('should reject when no live row matches', async () => {
      vi.mocked(repo.findLive).mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toMatchObject({
        code: ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
      });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
