/** ROV-167 — Unit tests for StudentService with its repositories mocked (no DB). */

import { createMongoAbility } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { AcademicStatus, AdmissionType, ErrorCode, SocialCategory } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityService } from '../../../auth/identity.service';
import type { FileService } from '../../../files/file.service';
import type { StudentRepository } from '../repositories/student.repository';
import { StudentService } from '../student.service';
import type { StudentReadRepository } from '../student-read.repository';

vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    correlationId: 'test',
  })),
}));

type StudentRow = Awaited<ReturnType<StudentReadRepository['findForMutation']>>;

const FIXED_TS = new Date('2026-04-23T10:00:00Z');

function buildStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    tenantId: 'tenant-1',
    userId: 'student-user-1',
    membershipId: 'membership-1',
    admissionNumber: 'ADM-0001',
    admissionDate: '2026-04-01',
    admissionClass: null,
    admissionType: AdmissionType.NEW,
    academicStatus: AcademicStatus.ENROLLED,
    socialCategory: SocialCategory.GENERAL,
    caste: null,
    isMinority: false,
    minorityType: null,
    isBpl: false,
    isCwsn: false,
    cwsnType: null,
    isRteAdmitted: false,
    rteCertificate: null,
    tcIssued: false,
    tcNumber: null,
    tcIssuedDate: null,
    tcReason: null,
    dateOfLeaving: null,
    previousSchoolName: null,
    previousSchoolBoard: null,
    medicalInfo: null,
    version: 2,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    firstName: { en: 'Asha' },
    lastName: null,
    gender: null,
    dateOfBirth: null,
    bloodGroup: null,
    religion: null,
    motherTongue: null,
    profileImageFileId: null,
    currentStudentAcademicId: null,
    currentStandardId: null,
    currentSectionId: null,
    currentAcademicYearId: null,
    rollNumber: null,
    currentStandardName: null,
    currentSectionName: null,
    promotionStatus: null,
    ...overrides,
  };
}

describe('StudentService (unit)', () => {
  let service: StudentService;
  let repository: ReturnType<typeof createMock<StudentRepository>>;
  let readRepository: ReturnType<typeof createMock<StudentReadRepository>>;
  let eventBus: ReturnType<typeof createMock<EventBusService>>;

  beforeEach(() => {
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    repository = createMock<StudentRepository>();
    readRepository = createMock<StudentReadRepository>();
    service = new StudentService(
      repository,
      eventBus,
      createMock<IdentityService>(),
      readRepository,
      createMock<FileService>(),
    );
  });

  describe('update', () => {
    it('rejects with CONCURRENT_MODIFICATION on version mismatch', async () => {
      repository.updateProfile.mockResolvedValue(null);
      repository.exists.mockResolvedValue(true);

      await expect(
        service.update('student-1', { version: 1, socialCategory: SocialCategory.GENERAL }),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
      expect(repository.updateProfile).toHaveBeenCalledWith('tenant-1', 'student-1', 1, {
        updatedBy: 'user-1',
        socialCategory: SocialCategory.GENERAL,
      });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('rejects when the student does not exist', async () => {
      repository.updateProfile.mockResolvedValue(null);
      repository.exists.mockResolvedValue(false);

      await expect(
        service.update('missing', { version: 1, socialCategory: SocialCategory.GENERAL }),
      ).rejects.toMatchObject({ code: ErrorCode.STUDENT_NOT_FOUND });
    });

    it('emits STUDENT.left when academicStatus transitions to a departure status', async () => {
      // tcIssued must be true so the TRANSFERRED_OUT guard does not reject.
      repository.findStatus.mockResolvedValue({
        academicStatus: AcademicStatus.ENROLLED,
        tcIssued: true,
      });
      repository.updateProfile.mockResolvedValue({ strength: [] });
      readRepository.findForMutation.mockResolvedValue(
        buildStudent({ academicStatus: AcademicStatus.TRANSFERRED_OUT }),
      );

      await service.update('student-1', {
        version: 1,
        academicStatus: AcademicStatus.TRANSFERRED_OUT,
        tcNumber: 'TC-001',
      });

      expect(eventBus.emit).toHaveBeenCalledWith('STUDENT.left', {
        studentProfileId: 'student-1',
        reason: AcademicStatus.TRANSFERRED_OUT,
        tcNumber: 'TC-001',
        tenantId: 'tenant-1',
      });
      expect(repository.updateTenantProfile).not.toHaveBeenCalled();
    });

    it('does NOT emit STUDENT.left for a non-departure status change', async () => {
      repository.findStatus.mockResolvedValue({
        academicStatus: AcademicStatus.ENROLLED,
        tcIssued: false,
      });
      repository.updateProfile.mockResolvedValue({ strength: [] });
      readRepository.findForMutation.mockResolvedValue(
        buildStudent({ academicStatus: AcademicStatus.GRADUATED }),
      );

      await service.update('student-1', {
        version: 1,
        academicStatus: AcademicStatus.GRADUATED,
      });

      expect(eventBus.emit).not.toHaveBeenCalledWith('STUDENT.left', expect.anything());
    });

    it('should emit STUDENT.statusChanged from the stored status to the new one', async () => {
      repository.findStatus.mockResolvedValue({
        academicStatus: AcademicStatus.ENROLLED,
        tcIssued: false,
      });
      repository.updateProfile.mockResolvedValue({ strength: [] });
      readRepository.findForMutation.mockResolvedValue(
        buildStudent({ academicStatus: AcademicStatus.PROMOTED }),
      );

      await service.update('student-1', { version: 1, academicStatus: AcademicStatus.PROMOTED });

      expect(eventBus.emit).toHaveBeenCalledWith('STUDENT.statusChanged', {
        studentProfileId: 'student-1',
        fromStatus: AcademicStatus.ENROLLED,
        toStatus: AcademicStatus.PROMOTED,
        reason: null,
        tenantId: 'tenant-1',
      });
    });

    it('should not emit STUDENT.statusChanged when academicStatus is not changed', async () => {
      repository.updateProfile.mockResolvedValue({ strength: [] });
      readRepository.findForMutation.mockResolvedValue(buildStudent());

      await service.update('student-1', { version: 1, socialCategory: SocialCategory.OBC });

      expect(repository.findStatus).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalledWith('STUDENT.statusChanged', expect.anything());
    });

    it('should not emit STUDENT.statusChanged when the status write loses a version race', async () => {
      repository.findStatus.mockResolvedValue({
        academicStatus: AcademicStatus.ENROLLED,
        tcIssued: false,
      });
      repository.updateProfile.mockResolvedValue(null);
      repository.exists.mockResolvedValue(true);

      await expect(
        service.update('student-1', { version: 1, academicStatus: AcademicStatus.PROMOTED }),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('deleteDocument', () => {
    const admin = createMongoAbility<AppAbility>([{ action: 'manage', subject: 'all' }]);
    const noAadhaar = createMongoAbility<AppAbility>([
      { action: 'manage', subject: 'Student' },
      { action: 'read', subject: 'Student', fields: ['aadhaar'], inverted: true },
    ]);

    it('rejects with STUDENT_NOT_FOUND when the caller cannot reach the document', async () => {
      repository.findReadableDocumentType.mockResolvedValue(null);

      await expect(service.deleteDocument('doc-1', admin)).rejects.toMatchObject({
        code: ErrorCode.STUDENT_NOT_FOUND,
      });
      expect(repository.removeDocument).not.toHaveBeenCalled();
    });

    it('rejects an Aadhaar document for a caller without the aadhaar field, with STUDENT_NOT_FOUND', async () => {
      repository.findReadableDocumentType.mockResolvedValue('AADHAAR_CARD');

      await expect(service.deleteDocument('doc-1', noAadhaar)).rejects.toMatchObject({
        code: ErrorCode.STUDENT_NOT_FOUND,
      });
      expect(repository.removeDocument).not.toHaveBeenCalled();
    });

    it('rejects with STUDENT_NOT_FOUND when the document was removed meanwhile', async () => {
      repository.findReadableDocumentType.mockResolvedValue('BIRTH_CERTIFICATE');
      repository.removeDocument.mockResolvedValue(false);

      await expect(service.deleteDocument('doc-1', admin)).rejects.toMatchObject({
        code: ErrorCode.STUDENT_NOT_FOUND,
      });
    });

    it('removes another document type for a caller without the aadhaar field', async () => {
      repository.findReadableDocumentType.mockResolvedValue('BIRTH_CERTIFICATE');
      repository.removeDocument.mockResolvedValue(true);

      await expect(service.deleteDocument('doc-1', noAadhaar)).resolves.toBe(true);
      expect(repository.removeDocument).toHaveBeenCalledTimes(1);
    });

    it('removes the document for the acting user, once', async () => {
      repository.findReadableDocumentType.mockResolvedValue('AADHAAR_CARD');
      repository.removeDocument.mockResolvedValue(true);

      await expect(service.deleteDocument('doc-1', admin)).resolves.toBe(true);

      expect(repository.findReadableDocumentType).toHaveBeenCalledWith('tenant-1', 'doc-1', admin);
      expect(repository.removeDocument).toHaveBeenCalledTimes(1);
      expect(repository.removeDocument).toHaveBeenCalledWith('doc-1', 'user-1');
      // No event: EVENT_PATTERNS has no student-document group; the mutation is audited instead.
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
