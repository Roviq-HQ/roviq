// ─── ComplianceReportType ─────────────────────────────────────────────────────

export const COMPLIANCE_REPORT_TYPE_VALUES = [
  // UDISE+ Data Capture Format: institute profile, students and teachers
  'UDISE_DCF',
  // CBSE Class 9/11 registration list for Pariksha Sangam
  'CBSE_REGISTRATION',
  // CBSE Class 10/12 List of Candidates
  'CBSE_LOC',
  // BSEH (Haryana board) staff statement
  'BSEH_STAFF_STATEMENT',
  // Shala Darpan (Rajasthan) student and staff return
  'SHALA_DARPAN',
  // RTE enrolment count by class, with fee reimbursement
  'RTE_REPORT',
  // Every transfer certificate issued in the academic year
  'TC_REGISTER',
  // Admission register, sorted by admission number
  'AWR',
] as const;

export type ComplianceReportType = (typeof COMPLIANCE_REPORT_TYPE_VALUES)[number];

export const ComplianceReportType = Object.fromEntries(
  COMPLIANCE_REPORT_TYPE_VALUES.map((v) => [v, v]),
) as { readonly [K in ComplianceReportType]: K };

// ─── ExportReportStatus ───────────────────────────────────────────────────────

export const EXPORT_REPORT_STATUS_VALUES = [
  // Requested; the workflow has not started generating yet
  'PENDING',
  // The workflow is reading data and building the file
  'RUNNING',
  // The file is stored and can be downloaded
  'COMPLETED',
  // Generation failed; `error_code` says why
  'FAILED',
] as const;

export type ExportReportStatus = (typeof EXPORT_REPORT_STATUS_VALUES)[number];

export const ExportReportStatus = Object.fromEntries(
  EXPORT_REPORT_STATUS_VALUES.map((v) => [v, v]),
) as { readonly [K in ExportReportStatus]: K };
