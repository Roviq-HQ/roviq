/**
 * CBSE Class 10/12 LOC (List of Candidates) Export (ROV-171, ROV-296).
 *
 * Only students of Class X and Class XII (UDISE+ class codes 10 and 12) in the chosen year,
 * one sheet per class (CBSE circular CBSE/LOC/X-XII/2026-2027, 17.09.2026: "Submission of
 * List of Candidates (LOC) for Class X and Class XII"). The Registration No. is the one CBSE
 * issued at Class IX/XI registration (e.g. A119/03001/0057), read from the student's
 * `CBSE_REGISTRATION` identifier. Subject codes are not held, so those cells stay empty.
 */
import type { DrizzleDB } from '@roviq/database';
import * as XLSX from 'xlsx';
import { type CbseCandidateData, cbseCandidates, fetchCbseCandidates } from './cbse-candidates';
import type { ComplianceExportOutput } from './types';

export const LOC_HEADERS = [
  'Registration Number',
  'Student Name (CAPITALS)',
  'Date of Birth',
  'Gender',
  'APAAR ID',
  'Subject Code 1',
  'Subject Code 2',
  'Subject Code 3',
  'Subject Code 4',
  'Subject Code 5',
  'Subject Code 6',
  'CWSN Status',
];

/** UDISE+ class code → sheet name. */
export const CBSE_LOC_CLASSES = [
  { code: 10, sheet: 'Class X' },
  { code: 12, sheet: 'Class XII' },
] as const;

export async function generateCbseLocExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const data = await fetchCbseCandidates(
    db,
    tenantId,
    academicYearId,
    CBSE_LOC_CLASSES.map((c) => c.code),
    'workflow:compliance-export-cbse-loc',
  );
  return buildCbseLoc(data);
}

export function buildCbseLoc(data: CbseCandidateData): ComplianceExportOutput {
  const candidates = cbseCandidates(data);
  const wb = XLSX.utils.book_new();
  let rowCount = 0;

  for (const { code, sheet } of CBSE_LOC_CLASSES) {
    const rows = candidates
      .filter((c) => c.udiseClassCode === code)
      .map((c) => ({
        'Registration Number': c.registrationNumber,
        'Student Name (CAPITALS)': c.nameCapitals,
        'Date of Birth': c.dateOfBirth,
        Gender: c.gender,
        'APAAR ID': c.apaarId,
        'Subject Code 1': '',
        'Subject Code 2': '',
        'Subject Code 3': '',
        'Subject Code 4': '',
        'Subject Code 5': '',
        'Subject Code 6': '',
        'CWSN Status': c.cwsnStatus,
      }));
    rowCount += rows.length;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows, { header: LOC_HEADERS }),
      sheet,
    );
  }

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount,
  };
}
