/** What every compliance export generator returns. */
export interface ComplianceExportOutput {
  /** The XLSX workbook. */
  buffer: Buffer;
  /** Records written across every data sheet (students, staff, classes or TCs). */
  rowCount: number;
}
