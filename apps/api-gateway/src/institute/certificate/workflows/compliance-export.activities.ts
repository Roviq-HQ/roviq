/**
 * Activities for ComplianceExportWorkflow (ROV-171, ROV-296).
 *
 * Every database call runs as the institute the workflow names (`mkInstituteCtx`), so RLS
 * still applies. Status writes are conditional on the prior status; a retried activity that
 * finds its own write already applied succeeds instead of failing.
 */
import { Logger } from '@nestjs/common';
import {
  BusinessException,
  type ComplianceReportType,
  ErrorCode,
  type ExportReportStatus,
  FILE_CONTENT_TYPE,
  FILE_PURPOSE_POLICY,
} from '@roviq/common-types';
import { type DrizzleDB, mkInstituteCtx } from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { ApplicationFailure } from '@temporalio/activity';
import type { WorkflowFileStore } from '../../../files/workflow-file-store';
import {
  type ComplianceExportOutput,
  generateAwrExport,
  generateBsehStaffStatementExport,
  generateCbseLocExport,
  generateCbseRegistrationExport,
  generateRteReport,
  generateShalaDarpanExport,
  generateTcRegisterExport,
  generateUdiseDcfExport,
} from '../exports';
import type { ExportReportRepository } from '../repositories/export-report.repository';
import type { ExportReportRecord } from '../repositories/types';
import type {
  CompleteExportInput,
  ComplianceExportActivities,
  ComplianceExportInput,
  FailExportInput,
  GeneratedExport,
} from './compliance-export.types';

const ORIGIN = 'workflow:compliance-export';

export type ComplianceExportGenerator = (
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
) => Promise<ComplianceExportOutput>;

export const COMPLIANCE_EXPORT_GENERATORS: {
  readonly [T in ComplianceReportType]: ComplianceExportGenerator;
} = {
  UDISE_DCF: generateUdiseDcfExport,
  CBSE_REGISTRATION: generateCbseRegistrationExport,
  CBSE_LOC: generateCbseLocExport,
  BSEH_STAFF_STATEMENT: generateBsehStaffStatementExport,
  SHALA_DARPAN: generateShalaDarpanExport,
  RTE_REPORT: generateRteReport,
  TC_REGISTER: generateTcRegisterExport,
  AWR: generateAwrExport,
};

/** Failure types an activity raises on purpose keep their code; anything else is a generation failure. */
export function exportErrorCode(failureType: string | null): ErrorCode {
  if (failureType === ErrorCode.FILE_TOO_LARGE) return ErrorCode.FILE_TOO_LARGE;
  if (failureType === ErrorCode.INVALID_STATE_TRANSITION) return ErrorCode.INVALID_STATE_TRANSITION;
  return ErrorCode.EXPORT_GENERATION_FAILED;
}

export interface ComplianceExportActivityDeps {
  db: DrizzleDB;
  repo: ExportReportRepository;
  fileStore: Pick<WorkflowFileStore, 'putPending'>;
  eventBus: Pick<EventBusService, 'emit'>;
  generators?: { readonly [T in ComplianceReportType]: ComplianceExportGenerator };
  logger?: Pick<Logger, 'log' | 'warn'>;
}

function isStateConflict(err: unknown): boolean {
  return err instanceof BusinessException && err.code === ErrorCode.INVALID_STATE_TRANSITION;
}

function conflict(record: ExportReportRecord | null, wanted: ExportReportStatus): never {
  throw ApplicationFailure.nonRetryable(
    `Export report ${record?.id ?? 'unknown'} is ${record?.status ?? 'missing'}, not ready to become ${wanted}`,
    ErrorCode.INVALID_STATE_TRANSITION,
  );
}

export function createComplianceExportActivities(
  deps: ComplianceExportActivityDeps,
): ComplianceExportActivities {
  const { db, repo, fileStore, eventBus } = deps;
  const generators = deps.generators ?? COMPLIANCE_EXPORT_GENERATORS;
  const logger = deps.logger ?? new Logger('ComplianceExportActivities');
  const ctx = (tenantId: string) => mkInstituteCtx(tenantId, ORIGIN);

  function eventBase(input: ComplianceExportInput) {
    return {
      tenantId: input.tenantId,
      exportReportId: input.exportReportId,
      reportType: input.reportType,
      academicYearId: input.academicYearId,
      requestedBy: input.requestedBy,
    };
  }

  return {
    async markExportRunning(input: ComplianceExportInput): Promise<void> {
      try {
        await repo.markRunning(ctx(input.tenantId), input.exportReportId, input.requestedBy);
      } catch (err) {
        if (!isStateConflict(err)) throw err;
        const record = await repo.findById(ctx(input.tenantId), input.exportReportId);
        // A retry of a call whose write already landed.
        if (record?.status !== 'RUNNING') conflict(record, 'RUNNING');
      }
    },

    async generateExportFile(input: ComplianceExportInput): Promise<GeneratedExport> {
      logger.log(`Generating ${input.reportType} export ${input.exportReportId}`);
      const { buffer, rowCount } = await generators[input.reportType](
        db,
        input.tenantId,
        input.academicYearId,
      );
      if (buffer.length > FILE_PURPOSE_POLICY.COMPLIANCE_EXPORT.maxSizeBytes) {
        throw ApplicationFailure.nonRetryable(
          `Export is ${buffer.length} bytes, above the stored-file limit`,
          ErrorCode.FILE_TOO_LARGE,
        );
      }
      await fileStore.putPending({
        tenantId: input.tenantId,
        fileId: input.fileId,
        purpose: 'COMPLIANCE_EXPORT',
        fileName: input.fileName,
        contentType: FILE_CONTENT_TYPE.XLSX,
        body: buffer,
        createdBy: input.requestedBy,
      });
      return { rowCount, sizeBytes: buffer.length };
    },

    async markExportCompleted(input: CompleteExportInput): Promise<void> {
      try {
        await repo.markCompleted(ctx(input.tenantId), {
          id: input.exportReportId,
          tenantId: input.tenantId,
          fileId: input.fileId,
          rowCount: input.rowCount,
          userId: input.requestedBy,
        });
      } catch (err) {
        if (!isStateConflict(err)) throw err;
        const record = await repo.findById(ctx(input.tenantId), input.exportReportId);
        if (record?.status !== 'COMPLETED' || record.fileId !== input.fileId) {
          conflict(record, 'COMPLETED');
        }
        return;
      }
      eventBus.emit(EVENT_PATTERNS.EXPORT.completed, {
        ...eventBase(input),
        fileId: input.fileId,
        rowCount: input.rowCount,
      });
    },

    async markExportFailed(input: FailExportInput): Promise<void> {
      const record = await repo.findById(ctx(input.tenantId), input.exportReportId);
      if (!record) throw new Error(`Export report ${input.exportReportId} not found`);
      if (record.status === 'COMPLETED' || record.status === 'FAILED') {
        logger.warn(
          `Export report ${record.id} is already ${record.status}; not marking it FAILED`,
        );
        return;
      }
      const errorCode = exportErrorCode(input.failureType);
      // Conditional on the status just read: a concurrent change fails here and is retried.
      await repo.markFailed(ctx(input.tenantId), {
        id: record.id,
        from: record.status,
        errorCode,
        userId: input.requestedBy,
      });
      eventBus.emit(EVENT_PATTERNS.EXPORT.failed, { ...eventBase(input), errorCode });
    },
  };
}
