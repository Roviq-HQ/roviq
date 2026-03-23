import { HttpStatus } from '@nestjs/common';

/**
 * Structured error codes for institute-service mutations.
 * Each code maps to an HTTP status and a machine-readable identifier.
 * Messages are i18n-translated via the `errors` namespace.
 */
export const ErrorCode = {
  // ── Institute ──────────────────────────────────────────
  /** Institute not found or soft-deleted */
  INSTITUTE_NOT_FOUND: 'INSTITUTE_NOT_FOUND',
  /** Another non-deleted institute already uses this code */
  INSTITUTE_CODE_DUPLICATE: 'INSTITUTE_CODE_DUPLICATE',
  /** Another non-deleted institute already uses this primary email */
  INSTITUTE_EMAIL_DUPLICATE: 'INSTITUTE_EMAIL_DUPLICATE',
  /** Cannot activate institute before setup_status = completed */
  SETUP_NOT_COMPLETE: 'SETUP_NOT_COMPLETE',
  /** Referenced reseller does not exist or is inactive */
  RESELLER_INVALID: 'RESELLER_INVALID',
  /** The system reseller "Roviq Direct" cannot be modified or deleted */
  SYSTEM_RESELLER_PROTECTED: 'SYSTEM_RESELLER_PROTECTED',
  /** Version mismatch — another user updated the record simultaneously */
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  /** CASL permission denied — the current role lacks the required ability */
  FORBIDDEN: 'FORBIDDEN',

  // ── Academic Year ──────────────────────────────────────
  /** Date ranges overlap with another academic year (schools only) */
  ACADEMIC_YEAR_OVERLAP: 'ACADEMIC_YEAR_OVERLAP',
  /** Start date must be before end date */
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  /** Cannot delete the last remaining academic year */
  LAST_ACADEMIC_YEAR: 'LAST_ACADEMIC_YEAR',
  /** Another academic year is already active for this institute */
  YEAR_ALREADY_ACTIVE: 'YEAR_ALREADY_ACTIVE',

  // ── Standard / Section / Subject ───────────────────────
  /** A standard with this name already exists in the same academic year */
  STANDARD_NAME_DUPLICATE: 'STANDARD_NAME_DUPLICATE',
  /** A section with this name already exists in the same standard */
  SECTION_NAME_DUPLICATE: 'SECTION_NAME_DUPLICATE',
  /** Cannot delete — students are actively enrolled */
  HAS_ACTIVE_ENROLLMENTS: 'HAS_ACTIVE_ENROLLMENTS',
  /** Cannot delete subject — assessments have been recorded against it */
  HAS_RECORDED_ASSESSMENTS: 'HAS_RECORDED_ASSESSMENTS',
  /** Section under a stream-applicable standard must specify a stream */
  STREAM_REQUIRED: 'STREAM_REQUIRED',
  /** Section capacity exceeded — provide an override reason or increase capacity */
  SECTION_CAPACITY_EXCEEDED: 'SECTION_CAPACITY_EXCEEDED',
  /** Board code is already used by another subject in this standard */
  SUBJECT_CODE_DUPLICATE: 'SUBJECT_CODE_DUPLICATE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Maps each error code to its HTTP status.
 * Status categories per PRD §14:
 *   403 = CASL permission denied
 *   404 = not found
 *   400 = validation failure
 *   409 = conflict (concurrent/duplicate)
 *   422 = business rule violation
 */
export const ERROR_STATUS: Record<ErrorCode, HttpStatus> = {
  INSTITUTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSTITUTE_CODE_DUPLICATE: HttpStatus.CONFLICT,
  INSTITUTE_EMAIL_DUPLICATE: HttpStatus.CONFLICT,
  SETUP_NOT_COMPLETE: HttpStatus.UNPROCESSABLE_ENTITY,
  RESELLER_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  SYSTEM_RESELLER_PROTECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  CONCURRENT_MODIFICATION: HttpStatus.CONFLICT,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  ACADEMIC_YEAR_OVERLAP: HttpStatus.BAD_REQUEST,
  INVALID_DATE_RANGE: HttpStatus.BAD_REQUEST,
  LAST_ACADEMIC_YEAR: HttpStatus.UNPROCESSABLE_ENTITY,
  YEAR_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  STANDARD_NAME_DUPLICATE: HttpStatus.CONFLICT,
  SECTION_NAME_DUPLICATE: HttpStatus.CONFLICT,
  HAS_ACTIVE_ENROLLMENTS: HttpStatus.UNPROCESSABLE_ENTITY,
  HAS_RECORDED_ASSESSMENTS: HttpStatus.UNPROCESSABLE_ENTITY,
  STREAM_REQUIRED: HttpStatus.BAD_REQUEST,
  SECTION_CAPACITY_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  SUBJECT_CODE_DUPLICATE: HttpStatus.CONFLICT,
};
