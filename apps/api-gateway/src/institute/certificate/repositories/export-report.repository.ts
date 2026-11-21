import type { FileRecord } from '../../../files/repositories/types';
import type {
  CompleteExportReportData,
  CreatedExportReport,
  CreateExportReportData,
  ExportAcademicYearRecord,
  ExportInstituteRecord,
  ExportReportCtx,
  ExportReportRecord,
  FailExportReportData,
  TimedOutExport,
} from './types';

/**
 * Access to `export_reports`. Reads go through `export_reports_live`. Every status write is
 * conditional on the expected prior status and throws INVALID_STATE_TRANSITION when the row
 * has moved on.
 */
export abstract class ExportReportRepository {
  abstract create(ctx: ExportReportCtx, data: CreateExportReportData): Promise<CreatedExportReport>;
  abstract findById(ctx: ExportReportCtx, id: string): Promise<ExportReportRecord | null>;
  /** Newest first. */
  abstract listForInstitute(
    ctx: ExportReportCtx,
    tenantId: string,
    limit: number,
  ): Promise<ExportReportRecord[]>;
  abstract markRunning(ctx: ExportReportCtx, id: string, userId: string): Promise<void>;
  /** RUNNING → COMPLETED and the file PENDING → READY, in one transaction. */
  abstract markCompleted(ctx: ExportReportCtx, data: CompleteExportReportData): Promise<void>;
  abstract markFailed(ctx: ExportReportCtx, data: FailExportReportData): Promise<void>;
  /** Null when the institute does not exist (or, for an institute caller, is not its own). */
  abstract findInstitute(
    ctx: ExportReportCtx,
    instituteId: string,
  ): Promise<ExportInstituteRecord | null>;
  /**
   * PENDING or RUNNING → FAILED with EXPORT_TIMED_OUT for the institute's exports requested
   * before `requestedBefore`, in one conditional UPDATE. Returns the rows it changed.
   */
  abstract failTimedOut(
    ctx: ExportReportCtx,
    tenantId: string,
    requestedBefore: Date,
  ): Promise<TimedOutExport[]>;
  abstract academicYearBelongsTo(
    ctx: ExportReportCtx,
    tenantId: string,
    academicYearId: string,
  ): Promise<boolean>;
  /** Newest first. */
  abstract listAcademicYears(
    ctx: ExportReportCtx,
    tenantId: string,
  ): Promise<ExportAcademicYearRecord[]>;
  /** The READY file of a live COMPLETED export; null for any other file. */
  abstract findCompletedExportFile(
    ctx: ExportReportCtx,
    fileId: string,
  ): Promise<FileRecord | null>;
}
