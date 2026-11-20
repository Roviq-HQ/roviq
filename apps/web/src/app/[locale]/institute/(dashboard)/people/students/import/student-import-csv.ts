import {
  STUDENT_IMPORT_REQUIRED_FIELDS,
  type StudentImportField,
  studentImportFieldForHeader,
} from '@roviq/common-types';
import Papa from 'papaparse';

/** Column header → the field it fills, or null to leave the column out. */
export type ColumnMapping = Record<string, StudentImportField | null>;

export type HeaderProblem = 'EMPTY' | 'DUPLICATE_HEADERS';

export interface MappingProblems {
  missing: StudentImportField[];
  duplicates: StudentImportField[];
}

// The header row of any real file fits well inside this; reading the whole file is not needed.
const HEADER_READ_BYTES = 64 * 1024;

/** Header row of a CSV as the import will see it (trimmed, BOM removed). */
export async function readCsvHeaders(
  file: Blob,
): Promise<{ headers: string[]; problem: HeaderProblem | null }> {
  const text = (await file.slice(0, HEADER_READ_BYTES).text()).replace(/^\uFEFF/, '');
  const [row] = Papa.parse<string[]>(text, { preview: 1 }).data;
  const headers = (row ?? []).map((header) => header.trim()).filter((header) => header !== '');
  if (headers.length === 0) return { headers, problem: 'EMPTY' };
  if (new Set(headers).size !== headers.length) return { headers, problem: 'DUPLICATE_HEADERS' };
  return { headers, problem: null };
}

/** Columns whose header already names a field start mapped to it; the rest start left out. */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  return Object.fromEntries(headers.map((header) => [header, studentImportFieldForHeader(header)]));
}

/**
 * Whether a column may be left out. The import reads a column whose header names a field even
 * when the mapping omits it, so such a column can only be pointed at another field.
 */
export function canSkipColumn(header: string): boolean {
  return studentImportFieldForHeader(header) === null;
}

export function mappingProblems(mapping: ColumnMapping): MappingProblems {
  const used = Object.values(mapping).filter(
    (field): field is StudentImportField => field !== null,
  );
  const duplicates = [...new Set(used.filter((field, i) => used.indexOf(field) !== i))];
  const missing = STUDENT_IMPORT_REQUIRED_FIELDS.filter((field) => !used.includes(field));
  return { missing, duplicates };
}

/** The `fieldMapping` argument of `bulkCreateStudents`. */
export function toFieldMapping(mapping: ColumnMapping): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).flatMap(([header, field]) => (field ? [[header, field]] : [])),
  );
}

const SAMPLE_ROWS: readonly (readonly string[])[] = [
  [
    'first_name',
    'last_name',
    'date_of_birth',
    'gender',
    'phone',
    'father_name',
    'mother_name',
    'email',
    'admission_number',
    'social_category',
    'admission_type',
    'blood_group',
    'religion',
    'previous_school_name',
  ],
  [
    'Aarav',
    'Sharma',
    '15/08/2014',
    'male',
    '9876543210',
    'Rakesh Sharma',
    'Sunita Sharma',
    '',
    '',
    'GENERAL',
    'NEW',
    'B+',
    '',
    '',
  ],
  ['Diya', 'Patel', '2013-02-03', 'female', '', '', '', '', '', 'OBC', 'TRANSFER', '', '', ''],
];

export const SAMPLE_CSV_FILE_NAME = 'student-import-sample.csv';

export function sampleCsv(): string {
  return `${Papa.unparse(SAMPLE_ROWS.map((row) => [...row]))}\r\n`;
}

export function downloadSampleCsv(): void {
  // BOM so Excel opens the file as UTF-8.
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${sampleCsv()}`], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = SAMPLE_CSV_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
