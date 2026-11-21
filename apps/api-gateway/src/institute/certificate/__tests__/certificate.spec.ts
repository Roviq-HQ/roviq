/**
 * ROV-170 — Unit tests for CertificateService "other certificates" methods.
 *
 * Pure unit: the repositories are mocked, so no DB is touched. Covers findCertificateById,
 * listCertificates with a type filter, and the shape of the certificate requestCertificate creates.
 */
import type { ConfigService } from '@nestjs/config';
import {
  CertificateStatus,
  CertificateTemplateType,
  type InstituteContext,
} from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CertificateService } from '../certificate.service';
import { CertificatePdfService } from '../certificate-pdf.service';
import { CertificateRepository } from '../repositories/certificate.repository';
import type { IssuedCertificateRow } from '../repositories/certificate.types';
import { TcRepository } from '../repositories/tc.repository';

const ctx: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  tenantId: 'tenant-1',
  userId: 'user-1',
  membershipId: 'membership-1',
  roleId: 'role-1',
  type: 'access',
};

function certificateRow(overrides: Partial<IssuedCertificateRow> = {}): IssuedCertificateRow {
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
    ...overrides,
  };
}

vi.mock('@temporalio/client', () => {
  class FakeTemporalClient {
    workflow = { start: vi.fn(() => Promise.resolve()) };
  }
  return {
    Client: FakeTemporalClient,
    Connection: { connect: vi.fn(() => Promise.resolve({ close: vi.fn() })) },
  };
});

describe('CertificateService (unit)', () => {
  let service: CertificateService;
  let certificates: CertificateRepository;

  beforeEach(() => {
    certificates = createMock<CertificateRepository>();
    const eventBus = createMock<EventBusService>({ emit: vi.fn() });
    const config = createMock<ConfigService>({ get: vi.fn(() => 'localhost:7233') });
    service = new CertificateService(
      createMock<TcRepository>(),
      certificates,
      eventBus,
      config,
      createMock<CertificatePdfService>(),
    );
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
  });
});
