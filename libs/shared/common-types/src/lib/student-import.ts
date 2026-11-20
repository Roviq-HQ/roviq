export const STUDENT_IMPORT_FIELD_VALUES = [
  // Student's first name; required
  'first_name',
  // Student's last name
  'last_name',
  // DD/MM/YYYY or YYYY-MM-DD; required
  'date_of_birth',
  // male, female or other (any case); required
  'gender',
  // Father's name
  'father_name',
  // Mother's name
  'mother_name',
  // 10-digit Indian mobile, +91 prefix allowed
  'phone',
  // Email address
  'email',
  // GENERAL, SC, ST, OBC or EWS
  'social_category',
  // Admission type value, e.g. NEW or LATERAL_ENTRY
  'admission_type',
  // Institute's own admission number; generated when empty
  'admission_number',
  // Standard id overriding the import's default standard for this row
  'standard_id',
  // Section id overriding the import's default section for this row
  'section_id',
  // Religion
  'religion',
  // A+, A-, B+, B-, AB+, AB-, O+ or O-
  'blood_group',
  // Name of the institute the student came from
  'previous_school_name',
] as const;
export type StudentImportField = (typeof STUDENT_IMPORT_FIELD_VALUES)[number];

export const STUDENT_IMPORT_REQUIRED_FIELDS: readonly StudentImportField[] = [
  'first_name',
  'date_of_birth',
  'gender',
];

export function isStudentImportField(value: string): value is StudentImportField {
  return (STUDENT_IMPORT_FIELD_VALUES as readonly string[]).includes(value);
}

/**
 * The field a CSV header names by itself ("Date of Birth" → date_of_birth), or null. The import
 * reads such a column as that field even when the mapping leaves it out.
 */
export function studentImportFieldForHeader(header: string): StudentImportField | null {
  const snaked = header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return isStudentImportField(snaked) ? snaked : null;
}
