/**
 * CBSE Class 9/11 Registration Export (ROV-171, ROV-296).
 *
 * Only students of Class IX and Class XI (UDISE+ class codes 9 and 11) in the chosen year,
 * one sheet per class: CBSE registers the two classes separately ("Checklist of students
 * registered for Class…", CBSE circular "Submission of Registration Data of Class IX/XI
 * 2025-26", 15.09.2025). Columns are the Pariksha Sangam set held in @roviq/compliance.
 * Subject codes, e-mail and annual income are not held, so those cells stay empty.
 */
import { CBSE_REGISTRATION_HEADERS } from '@roviq/compliance';
import type { DrizzleDB } from '@roviq/database';
import * as XLSX from 'xlsx';
import { type CbseCandidateData, cbseCandidates, fetchCbseCandidates } from './cbse-candidates';
import type { ComplianceExportOutput } from './types';

/** UDISE+ class code → sheet name. */
export const CBSE_REGISTRATION_CLASSES = [
  { code: 9, sheet: 'Class IX' },
  { code: 11, sheet: 'Class XI' },
] as const;

export async function generateCbseRegistrationExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const data = await fetchCbseCandidates(
    db,
    tenantId,
    academicYearId,
    CBSE_REGISTRATION_CLASSES.map((c) => c.code),
    'workflow:compliance-export-cbse-registration',
  );
  return buildCbseRegistration(data);
}

export function buildCbseRegistration(data: CbseCandidateData): ComplianceExportOutput {
  const candidates = cbseCandidates(data);
  const wb = XLSX.utils.book_new();
  let rowCount = 0;

  for (const { code, sheet } of CBSE_REGISTRATION_CLASSES) {
    const rows = candidates
      .filter((c) => c.udiseClassCode === code)
      .map((c) => ({
        'Student Name (CAPITALS)': c.nameCapitals,
        "Mother's Name": c.motherName,
        "Father's/Guardian's Name": c.fatherOrGuardianName,
        'Date of Birth': c.dateOfBirth,
        Gender: c.gender,
        'APAAR ID': c.apaarId,
        'Subject Code 1': '',
        'Subject Code 2': '',
        'Subject Code 3': '',
        'Subject Code 4': '',
        'Subject Code 5': '',
        'Subject Code 6': '',
        'Subject Code 7': '',
        'CWSN Status': c.cwsnStatus,
        'Mobile Number': c.mobile,
        Email: '',
        'Annual Income': '',
      }));
    rowCount += rows.length;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows, { header: CBSE_REGISTRATION_HEADERS }),
      sheet,
    );
  }

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount,
  };
}
