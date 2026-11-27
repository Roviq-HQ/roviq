/**
 * Column lists for queries on tables that hold personal data. `tx.select()` and `.returning()`
 * with no argument return every column a table has, also one added later; a query on such a
 * table names its columns instead (`pnpm check:select-columns`).
 *
 * A list below is the whole row as of today, for a reader that hands the row on as it is. A
 * column added to the table is added to a list only after checking who receives that row.
 */

/**
 * The named columns of a table or view, as the object `select()` and `returning()` take:
 * `tx.select(namedColumns(studentProfilesLive, STUDENT_PROFILE_COLUMNS))`.
 */
export function namedColumns<T extends object, const K extends keyof T & string>(
  source: T,
  keys: readonly K[],
): { [P in K]: T[P] } {
  const picked = {} as { [P in K]: T[P] };
  for (const key of keys) picked[key] = source[key];
  return picked;
}

const AUDIT_COLUMNS = [
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'deletedBy',
  'version',
] as const;

export const STUDENT_PROFILE_COLUMNS = [
  'id',
  'userId',
  'membershipId',
  'admissionNumber',
  'admissionDate',
  'admissionClass',
  'admissionType',
  'academicStatus',
  'socialCategory',
  'caste',
  'isMinority',
  'minorityType',
  'isBpl',
  'isCwsn',
  'cwsnType',
  'isRteAdmitted',
  'rteCertificate',
  'previousSchoolName',
  'previousSchoolBoard',
  'previousSchoolUdise',
  'incomingTcNumber',
  'incomingTcDate',
  'tcIssued',
  'tcNumber',
  'tcIssuedDate',
  'tcReason',
  'dateOfLeaving',
  'stream',
  'batchStartDate',
  'batchEndDate',
  'courseName',
  'medicalInfo',
  'tenantId',
  ...AUDIT_COLUMNS,
] as const;

export const STAFF_PROFILE_COLUMNS = [
  'id',
  'userId',
  'membershipId',
  'employeeId',
  'designation',
  'department',
  'dateOfJoining',
  'dateOfLeaving',
  'leavingReason',
  'employmentType',
  'isClassTeacher',
  'trainedForCwsn',
  'natureOfAppointment',
  'socialCategory',
  'isDisabled',
  'disabilityType',
  'specialization',
  'tenantId',
  ...AUDIT_COLUMNS,
] as const;

export const GUARDIAN_PROFILE_COLUMNS = [
  'id',
  'userId',
  'membershipId',
  'occupation',
  'organization',
  'designation',
  'annualIncome',
  'educationLevel',
  'tenantId',
  ...AUDIT_COLUMNS,
] as const;

export const USER_DOCUMENT_COLUMNS = [
  'id',
  'userId',
  'type',
  'description',
  'referenceNumber',
  'isVerified',
  'verifiedAt',
  'verifiedBy',
  'rejectionReason',
  'expiryDate',
  ...AUDIT_COLUMNS,
] as const;
