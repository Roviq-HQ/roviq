/**
 * ROV-170 — Unit tests for CertificateService "other certificates" methods.
 *
 * Pure unit: the repositories are mocked, so no DB is touched. Covers findCertificateById,
 * listCertificates with a type filter, and the shape of the certificate requestCertificate creates.
 */
import type { ConfigService } from '@nestjs/config';
import {
  AcademicStatus,
  CertificateStatus,
  CertificateTemplateType,
  type InstituteContext,
  TcStatus,
} from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import type { TemporalClientService } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CertificateService } from '../certificate.service';
import { CertificatePdfService } from '../certificate-pdf.service';
import { CertificateRepository } from '../repositories/certificate.repository';
import type { CertificateDetailsRow } from '../repositories/certificate.types';
import { TcRepository } from '../repositories/tc.repository';
import type { TcDetailsRow } from '../repositories/tc.types';

const ctx: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'membership-1',
  roleId: 'role-1',
  type: 'access',
};

function certificateRow(overrides: Partial<CertificateDetailsRow> = {}): CertificateDetailsRow {
  return {
    id: 'cert-1',
    tenantId: 'tenant-1',
    templateId: 'tpl-1',
    studentProfileId: null,
    staffProfileId: null,
    serialNumber: 'CERT/TRA/0001',
    status: CertificateStatus.ISSUED,
    certificateData: {},
    pdfFileId: null,
    issuedDate: null,
    issuedBy: null,
    purpose: null,
    validUntil: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: new Date('2026-04-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    deletedBy: null,
    version: 1,
    studentFirstName: null,
    studentLastName: null,
    studentAdmissionNumber: null,
    ...overrides,
  };
}

function tcDetailsRow(overrides: Partial<TcDetailsRow> = {}): TcDetailsRow {
  return {
    id: 'tc-1',
    studentProfileId: 'student-1',
    tcSerialNumber: 'TC-REQ-1',
    academicYearId: 'year-1',
    status: TcStatus.REQUESTED,
    reason: 'Family relocation',
    tcData: {
      studentName: 'Rajesh Kumar',
      motherName: null,
      fatherOrGuardianName: null,
      nationality: null,
      socialCategory: 'General',
      dateOfBirthFigures: null,
      dateOfBirthWords: null,
      whetherFailed: 'No',
      subjectsStudied: '',
      classLastStudied: null,
      lastExamResult: '',
      qualifiedForPromotion: '',
      feesPaidUpTo: '',
      feeConcession: '',
      nccScoutGuide: '',
      dateOfLeaving: null,
      reasonForLeaving: 'Family relocation',
      totalWorkingDays: '',
      totalPresentDays: '',
      generalConduct: '',
      remarks: '',
      dateOfIssue: null,
    },
    clearances: null,
    pdfFileId: null,
    verificationToken: null,
    issuedAt: null,
    admissionNumber: 'ADM-1',
    isDuplicate: false,
    originalTcId: null,
    isCounterSigned: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    studentFirstName: { en: 'Rajesh' },
    studentLastName: { en: 'Kumar' },
    standardName: { en: 'Class 5' },
    ...overrides,
  };
}

describe('CertificateService (unit)', () => {
  let service: CertificateService;
  let certificates: CertificateRepository;
  let tcs: TcRepository;
  let pdfs: CertificatePdfService;
  let temporal: TemporalClientService;

  beforeEach(() => {
    certificates = createMock<CertificateRepository>();
    tcs = createMock<TcRepository>();
    pdfs = createMock<CertificatePdfService>();
    temporal = createMock<TemporalClientService>();
    const eventBus = createMock<EventBusService>({ emit: vi.fn() });
    const configValues: Record<string, string> = { TEMPORAL_TC_TASK_QUEUE: 'tc-issuance-test' };
    const config = createMock<ConfigService>({ get: vi.fn((key: string) => configValues[key]) });
    service = new CertificateService(tcs, certificates, eventBus, config, pdfs, temporal);
  });

  describe('requestTC', () => {
    const input = {
      studentProfileId: 'student-1',
      reason: 'Family relocation',
      academicYearId: 'year-1',
    };

    beforeEach(() => {
      vi.mocked(tcs.findStudentStatus).mockResolvedValue({
        academicStatus: AcademicStatus.ENROLLED,
      });
      vi.mocked(tcs.academicYearExists).mockResolvedValue(true);
      vi.mocked(tcs.createRequest).mockResolvedValue({ id: 'tc-1' });
      vi.mocked(tcs.findDetails).mockResolvedValue(tcDetailsRow());
      vi.mocked(pdfs.verificationUrl).mockReturnValue(null);
    });

    it('starts TCIssuanceWorkflow on the shared client with the TC id and the request', async () => {
      vi.mocked(temporal.startWorkflow).mockResolvedValue('run-1');

      await service.requestTC(ctx, input);

      expect(temporal.startWorkflow).toHaveBeenCalledTimes(1);
      expect(temporal.startWorkflow).toHaveBeenCalledWith('TCIssuanceWorkflow', {
        taskQueue: 'tc-issuance-test',
        workflowId: 'tc-issuance-tc-1',
        workflowExecutionTimeout: '7 days',
        args: [
          {
            tenantId: 'tenant-1',
            tcRegisterId: 'tc-1',
            studentProfileId: 'student-1',
            academicYearId: 'year-1',
            reason: 'Family relocation',
            requestedBy: 'user-1',
          },
        ],
      });
    });

    it('still returns the requested TC when the workflow cannot be started', async () => {
      vi.mocked(temporal.startWorkflow).mockRejectedValue(new Error('temporal unavailable'));

      const result = await service.requestTC(ctx, input);

      const { verificationToken: _token, ...rest } = tcDetailsRow();
      expect(result).toEqual({ ...rest, verificationUrl: null, clearances: undefined });
      expect(tcs.findDetails).toHaveBeenCalledWith(ctx, 'tc-1');
    });
  });

  describe('findCertificateById', () => {
    it('returns the row the repository finds', async () => {
      const certRow = certificateRow();
      vi.mocked(certificates.findById).mockResolvedValue(certRow);

      const result = await service.findCertificateById(ctx, 'cert-1');

      expect(result).toEqual(certRow);
      expect(certificates.findById).toHaveBeenCalledWith(ctx, 'cert-1');
    });

    it('rejects when no row is returned', async () => {
      vi.mocked(certificates.findById).mockResolvedValue(null);

      await expect(service.findCertificateById(ctx, 'missing')).rejects.toThrow(/not found/i);
    });
  });

  describe('listCertificates', () => {
    it('returns rows for a type filter', async () => {
      const rows = [certificateRow()];
      vi.mocked(certificates.list).mockResolvedValue(rows);

      const result = await service.listCertificates(ctx, {
        type: CertificateTemplateType.TRANSFER_CERTIFICATE,
      });

      expect(result).toEqual(rows);
      expect(certificates.list).toHaveBeenCalledWith(ctx, {
        type: CertificateTemplateType.TRANSFER_CERTIFICATE,
      });
    });
  });

  describe('requestCertificate', () => {
    it('creates an issued certificate with the template, purpose and the caller as actor', async () => {
      vi.mocked(certificates.findTemplate).mockResolvedValue({
        id: 'tpl-1',
        type: CertificateTemplateType.CHARACTER_CERTIFICATE,
        name: 'Character',
        templateContent: null,
        approvalChain: [],
      });
      vi.mocked(certificates.nextSerial).mockResolvedValue('CERT/CHA/0001');
      const created = certificateRow({
        id: 'cert-new',
        serialNumber: 'CERT/CHA/0001',
        status: CertificateStatus.DRAFT,
      });
      vi.mocked(certificates.create).mockResolvedValue(created);

      const result = await service.requestCertificate(ctx, {
        templateId: 'tpl-1',
        purpose: 'Bonafide for passport',
      });

      expect(result.id).toBe('cert-new');
      expect(certificates.nextSerial).toHaveBeenCalledWith(ctx, 'CHA');
      // No approval chain → status starts as draft. The tenant comes from ctx.
      expect(certificates.create).toHaveBeenCalledWith(ctx, {
        templateId: 'tpl-1',
        studentProfileId: null,
        staffProfileId: null,
        serialNumber: 'CERT/CHA/0001',
        status: CertificateStatus.DRAFT,
        certificateData: {},
        purpose: 'Bonafide for passport',
        actorId: 'user-1',
      });
    });

    it("returns the student's name and admission number with the new certificate", async () => {
      vi.mocked(certificates.findTemplate).mockResolvedValue({
        id: 'tpl-1',
        type: CertificateTemplateType.BONAFIDE_CERTIFICATE,
        name: 'Bonafide',
        templateContent: null,
        approvalChain: [],
      });
      vi.mocked(certificates.findStudent).mockResolvedValue({
        admissionNumber: 'ADM-7',
        admissionClass: '5',
        firstName: { en: 'Asha', hi: 'आशा' },
        lastName: { en: 'Verma' },
      });
      vi.mocked(certificates.nextSerial).mockResolvedValue('CERT/BON/0001');
      vi.mocked(certificates.create).mockResolvedValue(
        certificateRow({ id: 'cert-new', studentProfileId: 'student-1' }),
      );

      const result = await service.requestCertificate(ctx, {
        templateId: 'tpl-1',
        studentProfileId: 'student-1',
        purpose: 'Passport',
      });

      expect(result).toMatchObject({
        id: 'cert-new',
        studentFirstName: { en: 'Asha', hi: 'आशा' },
        studentLastName: { en: 'Verma' },
        studentAdmissionNumber: 'ADM-7',
      });
    });
  });
});
