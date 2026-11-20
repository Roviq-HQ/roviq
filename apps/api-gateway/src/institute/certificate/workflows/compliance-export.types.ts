/**
 * Types for ComplianceExportWorkflow (ROV-171, ROV-296). Type-only imports: the workflow
 * bundle must not pull in Node or NestJS code.
 */
import type { ComplianceReportType } from '@roviq/common-types';

export const COMPLIANCE_EXPORT_TASK_QUEUE = 'compliance-export';
export const COMPLIANCE_EXPORT_WORKFLOW_TYPE = 'ComplianceExportWorkflow';
/** Temporal ends the run after this; nothing marks the export, so the service does. */
export const COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;
/** An export still PENDING or RUNNING this long after it was requested can no longer finish. */
export const COMPLIANCE_EXPORT_STALE_AFTER_MS =
  COMPLIANCE_EXPORT_EXECUTION_TIMEOUT_MS + 5 * 60 * 1000;

export interface ComplianceExportInput {
  exportReportId: string;
  tenantId: string;
  reportType: ComplianceReportType;
  academicYearId: string;
  /** The user who asked; the stored file and every status write are attributed to them. */
  requestedBy: string;
  /** Chosen before the run starts, so a retried activity overwrites the same stored file. */
  fileId: string;
  /** Download name, e.g. `RVQ-001-UDISE_DCF-2025-26.xlsx`. */
  fileName: string;
}

export interface GeneratedExport {
  rowCount: number;
  sizeBytes: number;
}

export interface CompleteExportInput extends ComplianceExportInput {
  rowCount: number;
}

export interface FailExportInput extends ComplianceExportInput {
  /** `ApplicationFailure.type` of the failing activity, when it carried one. */
  failureType: string | null;
}

export interface ComplianceExportResult {
  exportReportId: string;
  fileId: string;
  rowCount: number;
}

export interface ComplianceExportActivities {
  markExportRunning(input: ComplianceExportInput): Promise<void>;
  generateExportFile(input: ComplianceExportInput): Promise<GeneratedExport>;
  markExportCompleted(input: CompleteExportInput): Promise<void>;
  markExportFailed(input: FailExportInput): Promise<void>;
}
