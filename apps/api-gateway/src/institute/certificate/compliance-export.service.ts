import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  BusinessException,
  type ComplianceReportType,
  ErrorCode,
  eligibleComplianceReportTypes,
  type InstituteContext,
  type PlatformContext,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { TemporalClientService } from '../../common/temporal/temporal-client.service';
import { FileService } from '../../files/file.service';
import { complianceExportFileName } from './export-file-name';
import { ExportReportRepository } from './repositories/export-report.repository';
import type {
  ExportAcademicYearRecord,
  ExportReportCtx,
  ExportReportRecord,
} from './repositories/types';
import {
  COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
  COMPLIANCE_EXPORT_STALE_AFTER_MS,
  COMPLIANCE_EXPORT_TASK_QUEUE,
  COMPLIANCE_EXPORT_WORKFLOW_TYPE,
  type ComplianceExportInput,
} from './workflows/compliance-export.types';

/** How many past exports a history list shows. */
export const EXPORT_HISTORY_LIMIT = 50;

export interface RequestExportInput {
  reportType: ComplianceReportType;
  academicYearId: string;
}

function eventOf(input: {
  tenantId: string;
  exportReportId: string;
  reportType: ComplianceReportType;
  academicYearId: string;
  requestedBy: string;
}) {
  return {
    tenantId: input.tenantId,
    exportReportId: input.exportReportId,
    reportType: input.reportType,
    academicYearId: input.academicYearId,
    requestedBy: input.requestedBy,
  };
}

@Injectable()
export class ComplianceExportService {
  private readonly logger = new Logger(ComplianceExportService.name);

  constructor(
    private readonly repo: ExportReportRepository,
    private readonly temporal: TemporalClientService,
    private readonly eventBus: EventBusService,
    private readonly files: FileService,
  ) {}

  /** An institute user exports their own institute. */
  requestForInstitute(
    user: InstituteContext,
    input: RequestExportInput,
  ): Promise<ExportReportRecord> {
    return this.request(user, user.tenantId, input);
  }

  /** A platform admin exports any institute. */
  requestAsAdmin(
    admin: PlatformContext,
    input: RequestExportInput & { instituteId: string },
  ): Promise<ExportReportRecord> {
    return this.request(admin, input.instituteId, input);
  }

  async list(ctx: ExportReportCtx, tenantId: string): Promise<ExportReportRecord[]> {
    await this.failTimedOut(ctx, tenantId);
    return this.repo.listForInstitute(ctx, tenantId, EXPORT_HISTORY_LIMIT);
  }

  listAcademicYears(ctx: ExportReportCtx, tenantId: string): Promise<ExportAcademicYearRecord[]> {
    return this.repo.listAcademicYears(ctx, tenantId);
  }

  /** 60-second link to a finished export, for a platform admin. */
  async adminDownloadUrl(admin: PlatformContext, fileId: string): Promise<string> {
    const file = await this.repo.findCompletedExportFile(admin, fileId);
    if (!file) throw new BusinessException(ErrorCode.EXPORT_REPORT_NOT_FOUND, 'Export not found.');
    return this.files.signedDownloadUrl(file);
  }

  /** A run Temporal has already ended never updates its row; close such rows here. */
  private async failTimedOut(ctx: ExportReportCtx, tenantId: string): Promise<void> {
    const timedOut = await this.repo.failTimedOut(
      ctx,
      tenantId,
      new Date(Date.now() - COMPLIANCE_EXPORT_STALE_AFTER_MS),
    );
    for (const report of timedOut) {
      this.logger.warn(`Compliance export ${report.id} timed out; marked FAILED`);
      this.eventBus.emit(EVENT_PATTERNS.EXPORT.failed, {
        ...eventOf({ ...report, exportReportId: report.id }),
        errorCode: ErrorCode.EXPORT_TIMED_OUT,
      });
    }
  }

  private async request(
    ctx: ExportReportCtx,
    tenantId: string,
    input: RequestExportInput,
  ): Promise<ExportReportRecord> {
    const institute = await this.repo.findInstitute(ctx, tenantId);
    if (!institute) {
      throw new BusinessException(ErrorCode.INSTITUTE_NOT_FOUND, 'Institute not found.');
    }
    if (!eligibleComplianceReportTypes(institute.eligibility).includes(input.reportType)) {
      throw new BusinessException(
        ErrorCode.EXPORT_TYPE_NOT_AVAILABLE,
        'This institute does not qualify for this report type.',
      );
    }
    if (!(await this.repo.academicYearBelongsTo(ctx, tenantId, input.academicYearId))) {
      throw new BusinessException(
        ErrorCode.ACADEMIC_YEAR_NOT_FOUND,
        'Academic year not found for this institute.',
      );
    }
    await this.failTimedOut(ctx, tenantId);

    const { report, fileId } = await this.repo.create(ctx, {
      tenantId,
      reportType: input.reportType,
      academicYearId: input.academicYearId,
      workflowId: `compliance-export-${randomUUID()}`,
      requestedBy: ctx.userId,
    });
    const workflowInput: ComplianceExportInput = {
      exportReportId: report.id,
      tenantId,
      reportType: report.reportType,
      academicYearId: report.academicYearId,
      requestedBy: report.requestedBy,
      fileId,
      fileName: complianceExportFileName({
        instituteCode: institute.code ?? institute.slug,
        reportType: report.reportType,
        academicYearLabel: report.academicYearLabel ?? report.academicYearId,
      }),
    };

    try {
      await this.temporal.startWorkflow(COMPLIANCE_EXPORT_WORKFLOW_TYPE, {
        taskQueue: COMPLIANCE_EXPORT_TASK_QUEUE,
        workflowId: report.workflowId,
        workflowExecutionTimeout: COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS,
        args: [workflowInput],
      });
    } catch (err) {
      // The row exists; leaving it PENDING would show a progress bar that never ends.
      this.logger.error(
        `Compliance export ${report.id} could not be started`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.repo.markFailed(ctx, {
        id: report.id,
        from: 'PENDING',
        errorCode: ErrorCode.EXPORT_START_FAILED,
        userId: ctx.userId,
      });
      this.eventBus.emit(EVENT_PATTERNS.EXPORT.failed, {
        ...eventOf(workflowInput),
        errorCode: ErrorCode.EXPORT_START_FAILED,
      });
      throw new BusinessException(
        ErrorCode.EXPORT_START_FAILED,
        'The export could not be started. Try again in a few minutes.',
      );
    }

    this.eventBus.emit(EVENT_PATTERNS.EXPORT.requested, eventOf(workflowInput));
    return report;
  }
}
