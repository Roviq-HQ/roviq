import type {
  ComplianceReportType,
  ErrorCode,
  ExportEligibilityInput,
  ExportReportStatus,
  InstituteContext,
  PlatformContext,
} from '@roviq/common-types';

/** Who is asking: an institute user (RLS to its own institute) or a platform admin. */
export type ExportReportCtx = InstituteContext | PlatformContext;

export interface ExportReportRecord {
  id: string;
  tenantId: string;
  reportType: ComplianceReportType;
  academicYearId: string;
  /** Null when the year is no longer readable (soft-deleted). */
  academicYearLabel: string | null;
  status: ExportReportStatus;
  workflowId: string;
  fileId: string | null;
  rowCount: number | null;
  errorCode: string | null;
  requestedBy: string;
  /** Null when the caller may not read the requester's profile (a platform admin, for an institute). */
  requesterFirstName: Record<string, string> | null;
  requesterLastName: Record<string, string> | null;
  requestedAt: Date;
  completedAt: Date | null;
  version: number;
}

export interface CreateExportReportData {
  tenantId: string;
  reportType: ComplianceReportType;
  academicYearId: string;
  workflowId: string;
  requestedBy: string;
}

export interface CompleteExportReportData {
  id: string;
  tenantId: string;
  fileId: string;
  rowCount: number;
  /** The requester: the file was stored as theirs, so only they can make it READY. */
  userId: string;
}

export interface FailExportReportData {
  id: string;
  from: Extract<ExportReportStatus, 'PENDING' | 'RUNNING'>;
  errorCode: ErrorCode;
  userId: string;
}

export interface ExportAcademicYearRecord {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface CreatedExportReport {
  report: ExportReportRecord;
  /** A fresh id (database `uuidv7()`) for the file the workflow will store. */
  fileId: string;
}

/** What the service needs about an institute to check and name an export. */
export interface ExportInstituteRecord {
  code: string | null;
  slug: string;
  eligibility: ExportEligibilityInput;
}

/** An export the stale sweep marked FAILED with EXPORT_TIMED_OUT. */
export interface TimedOutExport {
  id: string;
  tenantId: string;
  reportType: ComplianceReportType;
  academicYearId: string;
  requestedBy: string;
}
