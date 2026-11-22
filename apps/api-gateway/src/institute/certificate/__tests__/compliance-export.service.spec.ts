import assert from 'node:assert';
import { Logger } from '@nestjs/common';
import { ErrorCode, type InstituteContext, type PlatformContext } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemporalClientService } from '../../../common/temporal/temporal-client.service';
import type { FileService } from '../../../files/file.service';
import type { FileRecord } from '../../../files/repositories/types';
import { ComplianceExportService, EXPORT_HISTORY_LIMIT } from '../compliance-export.service';
import type { ExportReportRepository } from '../repositories/export-report.repository';
import type { ExportInstituteRecord, ExportReportRecord } from '../repositories/types';
import {
  COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
  COMPLIANCE_EXPORT_STALE_AFTER_MS,
} from '../workflows/compliance-export.types';

const TENANT = '00000000-0000-7000-a000-0000000000a1';
const YEAR = '00000000-0000-7000-a000-0000000000c1';
const USER = '00000000-0000-7000-a000-0000000000d1';
const REPORT = '00000000-0000-7000-a000-0000000000b1';
const FILE = '00000000-0000-7000-a000-0000000000f1';
const NOW = new Date('2026-11-20T10:00:00Z');

const institute: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  tenantId: TENANT,
  userId: USER,
  membershipId: '00000000-0000-7000-a000-0000000000e1',
  roleId: '00000000-0000-7000-a000-0000000000e2',
  type: 'access',
};

const admin: PlatformContext = {
  _scope: 'platform',
  scope: 'platform',
  userId: USER,
  membershipId: '00000000-0000-7000-a000-0000000000e3',
  roleId: '00000000-0000-7000-a000-0000000000e4',
  type: 'access',
};

const CBSE_INSTITUTE: ExportInstituteRecord = {
  code: 'DPS/RK 01',
  slug: 'dps-rk',
  eligibility: { boards: ['CBSE'], state: 'Haryana', identifierTypes: [] },
};

function pending(workflowId: string, reportType: ExportReportRecord['reportType']) {
  const report: ExportReportRecord = {
    id: REPORT,
    tenantId: TENANT,
    reportType,
    academicYearId: YEAR,
    academicYearLabel: '2025-26',
    status: 'PENDING',
    workflowId,
    fileId: null,
    rowCount: null,
    errorCode: null,
    requestedBy: USER,
    requesterFirstName: { en: 'Asha' },
    requesterLastName: null,
    requestedAt: NOW,
    completedAt: null,
    version: 1,
  };
  return { report, fileId: FILE };
}

describe('ComplianceExportService', () => {
  let repo: ExportReportRepository;
  let temporal: TemporalClientService;
  let eventBus: EventBusService;
  let files: FileService;
  let service: ComplianceExportService;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    repo = createMock<ExportReportRepository>({
      findInstitute: vi.fn(async () => CBSE_INSTITUTE),
      academicYearBelongsTo: vi.fn(async () => true),
      failTimedOut: vi.fn(async () => []),
      create: vi.fn(async (_ctx, data) => pending(data.workflowId, data.reportType)),
    });
    temporal = createMock<TemporalClientService>({ startWorkflow: vi.fn(async () => 'run-1') });
    eventBus = createMock<EventBusService>();
    files = createMock<FileService>();
    service = new ComplianceExportService(repo, temporal, eventBus, files);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requestForInstitute', () => {
    it('should create a PENDING export, start its workflow with a reserved file id and name, and emit EXPORT.requested', async () => {
      const report = await service.requestForInstitute(institute, {
        reportType: 'UDISE_DCF',
        academicYearId: YEAR,
      });

      expect(report.status).toBe('PENDING');
      const [, created] = vi.mocked(repo.create).mock.calls[0] ?? [];
      assert(created);
      expect(created).toEqual({
        tenantId: TENANT,
        reportType: 'UDISE_DCF',
        academicYearId: YEAR,
        workflowId: report.workflowId,
        requestedBy: USER,
      });
      expect(report.workflowId).toMatch(/^compliance-export-[0-9a-f-]{36}$/);
      expect(temporal.startWorkflow).toHaveBeenCalledWith('ComplianceExportWorkflow', {
        taskQueue: 'compliance-export',
        workflowId: report.workflowId,
        workflowExecutionTimeout: COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
        args: [
          {
            exportReportId: REPORT,
            tenantId: TENANT,
            reportType: 'UDISE_DCF',
            academicYearId: YEAR,
            requestedBy: USER,
            fileId: FILE,
            fileName: 'DPS-RK-01-UDISE_DCF-2025-26.xlsx',
          },
        ],
      });
      expect(eventBus.emit).toHaveBeenCalledWith(EVENT_PATTERNS.EXPORT.requested, {
        exportReportId: REPORT,
        tenantId: TENANT,
        reportType: 'UDISE_DCF',
        academicYearId: YEAR,
        requestedBy: USER,
      });
    });

    it('should name the file after the slug when the institute has no code', async () => {
      vi.mocked(repo.findInstitute).mockResolvedValue({ ...CBSE_INSTITUTE, code: null });

      await service.requestForInstitute(institute, { reportType: 'AWR', academicYearId: YEAR });

      const options = vi.mocked(temporal.startWorkflow).mock.calls[0]?.[1];
      const [input] = options?.args ?? [];
      expect(input).toEqual({
        exportReportId: REPORT,
        tenantId: TENANT,
        reportType: 'AWR',
        academicYearId: YEAR,
        requestedBy: USER,
        fileId: FILE,
        fileName: 'dps-rk-AWR-2025-26.xlsx',
      });
    });

    it('should refuse a report type the institute does not qualify for, creating nothing', async () => {
      await expect(
        service.requestForInstitute(institute, {
          reportType: 'BSEH_STAFF_STATEMENT',
          academicYearId: YEAR,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.EXPORT_TYPE_NOT_AVAILABLE });
      expect(repo.create).not.toHaveBeenCalled();
      expect(temporal.startWorkflow).not.toHaveBeenCalled();
    });

    it('should refuse an academic year that is not the institute’s', async () => {
      vi.mocked(repo.academicYearBelongsTo).mockResolvedValue(false);

      await expect(
        service.requestForInstitute(institute, { reportType: 'AWR', academicYearId: YEAR }),
      ).rejects.toMatchObject({ code: ErrorCode.ACADEMIC_YEAR_NOT_FOUND });
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.academicYearBelongsTo).toHaveBeenCalledWith(institute, TENANT, YEAR);
    });

    it('should close timed-out exports of the institute before creating a new one', async () => {
      await service.requestForInstitute(institute, { reportType: 'AWR', academicYearId: YEAR });

      expect(repo.failTimedOut).toHaveBeenCalledWith(
        institute,
        TENANT,
        new Date(NOW.getTime() - COMPLIANCE_EXPORT_STALE_AFTER_MS),
      );
      const sweptAt = vi.mocked(repo.failTimedOut).mock.invocationCallOrder[0];
      const createdAt = vi.mocked(repo.create).mock.invocationCallOrder[0];
      assert(sweptAt !== undefined && createdAt !== undefined);
      expect(sweptAt).toBeLessThan(createdAt);
    });

    it('should mark the export FAILED and answer EXPORT_START_FAILED when Temporal refuses', async () => {
      vi.mocked(temporal.startWorkflow).mockRejectedValue(new Error('temporal down'));

      await expect(
        service.requestForInstitute(institute, { reportType: 'UDISE_DCF', academicYearId: YEAR }),
      ).rejects.toMatchObject({ code: ErrorCode.EXPORT_START_FAILED });

      expect(repo.markFailed).toHaveBeenCalledWith(institute, {
        id: REPORT,
        from: 'PENDING',
        errorCode: ErrorCode.EXPORT_START_FAILED,
        userId: USER,
      });
      expect(eventBus.emit).toHaveBeenCalledWith(EVENT_PATTERNS.EXPORT.failed, {
        exportReportId: REPORT,
        tenantId: TENANT,
        reportType: 'UDISE_DCF',
        academicYearId: YEAR,
        requestedBy: USER,
        errorCode: ErrorCode.EXPORT_START_FAILED,
      });
    });
  });

  describe('requestAsAdmin', () => {
    it('should refuse an institute that does not exist', async () => {
      vi.mocked(repo.findInstitute).mockResolvedValue(null);

      await expect(
        service.requestAsAdmin(admin, {
          instituteId: TENANT,
          reportType: 'UDISE_DCF',
          academicYearId: YEAR,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INSTITUTE_NOT_FOUND });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('should refuse a report type the institute does not qualify for', async () => {
      await expect(
        service.requestAsAdmin(admin, {
          instituteId: TENANT,
          reportType: 'SHALA_DARPAN',
          academicYearId: YEAR,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.EXPORT_TYPE_NOT_AVAILABLE });
      expect(repo.findInstitute).toHaveBeenCalledWith(admin, TENANT);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('should refuse an academic year of another institute', async () => {
      vi.mocked(repo.academicYearBelongsTo).mockResolvedValue(false);

      await expect(
        service.requestAsAdmin(admin, {
          instituteId: TENANT,
          reportType: 'UDISE_DCF',
          academicYearId: YEAR,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ACADEMIC_YEAR_NOT_FOUND });
      expect(repo.academicYearBelongsTo).toHaveBeenCalledWith(admin, TENANT, YEAR);
    });

    it('should create the export for the named institute as the admin', async () => {
      await service.requestAsAdmin(admin, {
        instituteId: TENANT,
        reportType: 'CBSE_LOC',
        academicYearId: YEAR,
      });

      const [ctx, created] = vi.mocked(repo.create).mock.calls[0] ?? [];
      assert(created);
      expect(ctx).toBe(admin);
      expect(created).toEqual({
        tenantId: TENANT,
        reportType: 'CBSE_LOC',
        academicYearId: YEAR,
        workflowId: created.workflowId,
        requestedBy: USER,
      });
      expect(created.workflowId).toMatch(/^compliance-export-[0-9a-f-]{36}$/);
    });
  });

  describe('list', () => {
    it('should close timed-out exports, emit EXPORT.failed for each, then read the newest', async () => {
      vi.mocked(repo.failTimedOut).mockResolvedValue([
        {
          id: REPORT,
          tenantId: TENANT,
          reportType: 'AWR',
          academicYearId: YEAR,
          requestedBy: USER,
        },
      ]);

      await service.list(admin, TENANT);

      expect(repo.failTimedOut).toHaveBeenCalledWith(
        admin,
        TENANT,
        new Date(NOW.getTime() - COMPLIANCE_EXPORT_STALE_AFTER_MS),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(EVENT_PATTERNS.EXPORT.failed, {
        exportReportId: REPORT,
        tenantId: TENANT,
        reportType: 'AWR',
        academicYearId: YEAR,
        requestedBy: USER,
        errorCode: ErrorCode.EXPORT_TIMED_OUT,
      });
      expect(repo.listForInstitute).toHaveBeenCalledWith(admin, TENANT, EXPORT_HISTORY_LIMIT);
    });

    it('should wait longer than the workflow may run before calling an export lost', () => {
      expect(COMPLIANCE_EXPORT_STALE_AFTER_MS).toBeGreaterThan(
        COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
      );
    });
  });

  describe('adminDownloadUrl', () => {
    const EXPORT_TENANT = '00000000-0000-7000-a000-0000000000e1';

    it('should answer EXPORT_REPORT_NOT_FOUND for a file that is not a finished export', async () => {
      vi.mocked(repo.findCompletedExportFile).mockResolvedValue(null);

      await expect(service.adminDownloadUrl(admin, REPORT)).rejects.toMatchObject({
        code: ErrorCode.EXPORT_REPORT_NOT_FOUND,
      });
      expect(files.signedDownloadUrl).not.toHaveBeenCalled();
    });

    it('should sign a short-lived link for a finished export', async () => {
      const file = createMock<FileRecord>({
        id: REPORT,
        purpose: 'COMPLIANCE_EXPORT',
        tenantId: EXPORT_TENANT,
      });
      vi.mocked(repo.findCompletedExportFile).mockResolvedValue(file);
      vi.mocked(files.signedDownloadUrl).mockResolvedValue('https://storage.example/x.xlsx');

      // The institute comes back with the link so the download is audited against it.
      await expect(service.adminDownloadUrl(admin, REPORT)).resolves.toEqual({
        url: 'https://storage.example/x.xlsx',
        tenantId: EXPORT_TENANT,
      });
      expect(files.signedDownloadUrl).toHaveBeenCalledWith(file);
    });
  });
});
