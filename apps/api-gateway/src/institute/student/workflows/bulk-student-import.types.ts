/**
 * Types for BulkStudentImportWorkflow (ROV-155, PRD §7.1).
 *
 * Temporal workflow that parses a CSV file, validates rows, batch-inserts
 * students (user → membership → profile → academics → admission number),
 * and generates an import report.
 */
import { AdmissionType, Gender, SocialCategory } from '@roviq/common-types';

// ── Workflow input ────────────────────────────────────────

/** Input to the BulkStudentImportWorkflow */
export interface BulkStudentImportInput {
  /** Tenant (institute) this import targets */
  tenantId: string;
  /** READY file of purpose BULK_IMPORT_CSV holding the uploaded CSV */
  fileId: string;
  /** Academic year for enrollment */
  academicYearId: string;
  /** Default standard (grade level) for all rows unless overridden per row */
  standardId: string;
  /** Default section for all rows unless overridden per row */
  sectionId: string;
  /** User who initiated the import (audit trail) */
  createdBy: string;
  /**
   * Maps CSV column headers to internal field names.
   * Example: `{ "Student Name": "first_name", "DOB": "date_of_birth" }`
   */
  fieldMapping: Record<string, string>;
}

// ── Row-level types ───────────────────────────────────────

/** Validated, mapped row ready for insertion */
export interface ValidatedRow {
  /** 1-based row number from the CSV (excluding header) */
  rowNumber: number;
  firstName: string;
  lastName?: string;
  dateOfBirth: string;
  gender: Gender;
  /** Father's name — required for guardian creation */
  fatherName?: string;
  /** Mother's name — required for guardian creation */
  motherName?: string;
  /** 10-digit Indian mobile number (without +91) */
  phone?: string;
  email?: string;
  socialCategory?: SocialCategory;
  admissionType?: AdmissionType;
  /** Pre-assigned admission number — if provided, skip auto-generation */
  admissionNumber?: string;
  /** Override default standard */
  standardId?: string;
  /** Override default section */
  sectionId?: string;
  /** Free text religion */
  religion?: string;
  /** A+ / A- / B+ / B- / AB+ / AB- / O+ / O- */
  bloodGroup?: string;
  /** Previous school name (for lateral entry / transfer) */
  previousSchoolName?: string;
}

/** Error for a single field in a single row */
export interface RowError {
  /** 1-based row number from the CSV */
  rowNumber: number;
  /** Field name that failed validation */
  field: string;
  /** Human-readable reason */
  reason: string;
  /** Original value from the CSV (for error report) */
  originalValue?: string;
}

// ── Activity results ──────────────────────────────────────

/** Result from the parseCsv activity */
export interface ParseCsvResult {
  /** Successfully validated rows */
  validRows: ValidatedRow[];
  /** Validation errors collected during parsing */
  errors: RowError[];
  /** Total number of data rows in the CSV (excluding header) */
  totalRows: number;
}

/** Result from a single batch insert activity */
export interface BatchInsertResult {
  /** Number of students created in this batch */
  created: number;
  /** Number of rows skipped (duplicate phone, duplicate admission number) */
  skipped: number;
  /** Errors encountered during insertion */
  errors: RowError[];
}

/** Result from the generateReport activity */
export interface ImportReportResult {
  /** Stored error report (purpose BULK_IMPORT_REPORT) */
  reportFileId: string;
}

// ── Workflow result / progress ─────────────────────────────

/**
 * Status of the bulk import workflow.
 * - `parsing`: CSV file is being downloaded and parsed
 * - `validating`: Rows are being validated
 * - `inserting`: Batch inserts in progress
 * - `generating_report`: Creating error CSV and uploading
 * - `completed`: All done
 * - `failed`: Workflow failed (unrecoverable)
 */
export type BulkImportStatus =
  | 'parsing'
  | 'validating'
  | 'inserting'
  | 'generating_report'
  | 'completed'
  | 'failed';

/** Final result of the BulkStudentImportWorkflow */
export interface BulkStudentImportResult {
  status: BulkImportStatus;
  totalRows: number;
  created: number;
  skipped: number;
  errorCount: number;
  errors: RowError[];
  /** File id of the error report CSV (null if no errors) */
  reportFileId: string | null;
}

/** Progress update queryable via bulkImportProgress */
export interface BulkImportProgress {
  status: BulkImportStatus;
  totalRows: number;
  processed: number;
  created: number;
  skipped: number;
  errorCount: number;
  /** File id of the error report CSV — only populated when status = completed */
  reportFileId: string | null;
}

// ── Activities interface ──────────────────────────────────

/** Activities interface for proxyActivities in the workflow */
export interface BulkStudentImportActivities {
  /**
   * Read the CSV from file storage, detect encoding, parse with Papaparse,
   * validate each row, apply field mapping, and return validated rows + errors.
   */
  parseCsv(
    tenantId: string,
    fileId: string,
    fieldMapping: Record<string, string>,
  ): Promise<ParseCsvResult>;

  /**
   * Insert a batch of validated rows. For each row:
   * 1. Dedup by phone number → link existing user instead of creating
   * 2. Dedup by admission number → skip if already exists
   * 3. Create user via Auth NATS (or find existing)
   * 4. Create membership (student role)
   * 5. Create user_profile
   * 6. Create student_profile with admission number (via tenant_sequences)
   * 7. Create student_academics (section assignment)
   */
  insertBatch(
    tenantId: string,
    academicYearId: string,
    defaultStandardId: string,
    defaultSectionId: string,
    createdBy: string,
    rows: ValidatedRow[],
  ): Promise<BatchInsertResult>;

  /** Store the error report as a file. A retry writes the same `reportFileId` again. */
  generateReport(params: GenerateReportParams): Promise<ImportReportResult>;
}

export interface GenerateReportParams {
  tenantId: string;
  /** Chosen by the workflow so that a retried activity does not create a second file. */
  reportFileId: string;
  /** The user who started the import; recorded as the report's uploader. */
  createdBy: string;
  errors: RowError[];
  totalRows: number;
  created: number;
  skipped: number;
}

/** What the import activities need from file storage. */
export interface ImportFileStore {
  read(tenantId: string, fileId: string, purpose: 'BULK_IMPORT_CSV'): Promise<Buffer>;
  put(write: {
    tenantId: string;
    fileId: string;
    purpose: 'BULK_IMPORT_REPORT';
    fileName: string;
    contentType: 'text/csv';
    body: Buffer;
    createdBy: string;
  }): Promise<void>;
}
