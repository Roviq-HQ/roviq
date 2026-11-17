import { HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes surfaced to clients as GraphQL `extensions.code`.
 * Each code maps to one HTTP status; the frontend translates codes to copy.
 */
export const ErrorCode = {
  // ── Generic (status-derived fallbacks) ─────────────────
  /** Request is malformed or violates a precondition with no more specific code */
  BAD_REQUEST: 'BAD_REQUEST',
  /** Input failed DTO validation (class-validator / ValidationPipe) */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Access token missing, malformed or expired — clients refresh and retry */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Requested resource does not exist and has no more specific *_NOT_FOUND code */
  NOT_FOUND: 'NOT_FOUND',
  /** Request conflicts with current state and has no more specific code */
  CONFLICT: 'CONFLICT',
  /** Business rule rejected the request and has no more specific code */
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  /** Rate limit hit (ThrottlerGuard) */
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  /** Unexpected server failure — details are logged, never sent to the client */
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // ── Auth ───────────────────────────────────────────────
  /** Wrong Roviq ID or password (also unknown / inactive user, to avoid enumeration) */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Too many failed logins — the Roviq ID is locked for a cooldown window */
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  /** Credentials are valid but the user has no usable membership in this portal */
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  /** User behind an otherwise valid token is deleted or no longer ACTIVE */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  /** Refresh or institute-selection token is invalid, expired, revoked or reused */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** Refresh token predates a password change — a full re-login is required */
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  /** Access token carries mustChangePassword — only the password change is allowed */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  /** Current password supplied to changePassword does not match */
  CURRENT_PASSWORD_INCORRECT: 'CURRENT_PASSWORD_INCORRECT',
  /** New password is identical to the current password */
  PASSWORD_UNCHANGED: 'PASSWORD_UNCHANGED',
  /** Target membership is missing or not ACTIVE for this user */
  NO_ACTIVE_MEMBERSHIP: 'NO_ACTIVE_MEMBERSHIP',
  /** Session to revoke does not exist or belongs to another user */
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  /** Impersonation session ended, expired or was revoked */
  IMPERSONATION_ENDED: 'IMPERSONATION_ENDED',

  // ── Passkey ────────────────────────────────────────────
  /** WebAuthn challenge expired or was already consumed */
  PASSKEY_CHALLENGE_EXPIRED: 'PASSKEY_CHALLENGE_EXPIRED',
  /** Passkey registration response could not be verified */
  PASSKEY_VERIFICATION_FAILED: 'PASSKEY_VERIFICATION_FAILED',
  /** Passkey sign-in failed (unknown credential, bad signature or inactive user) */
  PASSKEY_AUTHENTICATION_FAILED: 'PASSKEY_AUTHENTICATION_FAILED',
  /** Passkey does not exist or belongs to another user */
  PASSKEY_NOT_FOUND: 'PASSKEY_NOT_FOUND',
  /** Removing this passkey would leave the user with no way to sign in */
  PASSKEY_LAST_AUTH_METHOD: 'PASSKEY_LAST_AUTH_METHOD',

  // ── Institute ──────────────────────────────────────────
  /** Institute not found or soft-deleted */
  INSTITUTE_NOT_FOUND: 'INSTITUTE_NOT_FOUND',
  /** Another non-deleted institute already uses this code */
  INSTITUTE_CODE_DUPLICATE: 'INSTITUTE_CODE_DUPLICATE',
  /** Another non-deleted institute already uses this primary email */
  INSTITUTE_EMAIL_DUPLICATE: 'INSTITUTE_EMAIL_DUPLICATE',
  /** Cannot activate institute before setup_status = completed */
  SETUP_NOT_COMPLETE: 'SETUP_NOT_COMPLETE',
  /** Status transition not permitted by the domain state machine */
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  /** Invalid institute language configuration */
  INVALID_LOCALE_SETTINGS: 'INVALID_LOCALE_SETTINGS',
  /** Reseller row does not exist (404 — wrong id or already hard-deleted) */
  RESELLER_NOT_FOUND: 'RESELLER_NOT_FOUND',
  /** Referenced reseller exists but is in an invalid state (inactive, deleted, suspended) */
  RESELLER_INVALID: 'RESELLER_INVALID',
  /** The system reseller "Roviq Direct" cannot be modified or deleted */
  SYSTEM_RESELLER_PROTECTED: 'SYSTEM_RESELLER_PROTECTED',
  /** Another non-deleted reseller already uses this slug (unique on reseller.slug) */
  SLUG_DUPLICATE: 'SLUG_DUPLICATE',
  /** Cannot delete reseller — institutes are still assigned. Reassign them first or wait for suspension cascade */
  RESELLER_HAS_ACTIVE_INSTITUTES: 'RESELLER_HAS_ACTIVE_INSTITUTES',
  /** Provided reseller tier value is not one of the supported RESELLER_TIER_VALUES */
  INVALID_TIER: 'INVALID_TIER',
  /** Tier change attempted on a non-active reseller (must be unsuspended first) */
  TIER_CHANGE_REQUIRES_ACTIVE: 'TIER_CHANGE_REQUIRES_ACTIVE',
  /** Reseller slug is empty or cannot be derived from the provided name */
  INVALID_SLUG: 'INVALID_SLUG',
  /** Suspend attempted on a reseller that is already suspended */
  RESELLER_ALREADY_SUSPENDED: 'RESELLER_ALREADY_SUSPENDED',
  /** Unsuspend or delete attempted on a reseller that is not in SUSPENDED state */
  RESELLER_NOT_SUSPENDED: 'RESELLER_NOT_SUSPENDED',
  /** Delete attempted before the mandatory 30-day suspension grace period has elapsed */
  GRACE_PERIOD_NOT_ELAPSED: 'GRACE_PERIOD_NOT_ELAPSED',
  /** Version mismatch — another user updated the record simultaneously */
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  /** CASL permission denied — the current role lacks the required ability */
  FORBIDDEN: 'FORBIDDEN',

  // ── Academic Year ──────────────────────────────────────
  /** Date ranges overlap with another academic year */
  ACADEMIC_YEAR_OVERLAP: 'ACADEMIC_YEAR_OVERLAP',
  /** Start date must be before end date */
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  /** Cannot delete the last remaining academic year */
  LAST_ACADEMIC_YEAR: 'LAST_ACADEMIC_YEAR',
  /** Another academic year is already active for this institute */
  YEAR_ALREADY_ACTIVE: 'YEAR_ALREADY_ACTIVE',
  /** No academic year is currently active — callers that omit the year need one */
  NO_ACTIVE_ACADEMIC_YEAR: 'NO_ACTIVE_ACADEMIC_YEAR',
  /** Academic year label (YYYY-YY) does not match the start/end date range */
  LABEL_DATE_MISMATCH: 'LABEL_DATE_MISMATCH',

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

  // ── Student ────────────────────────────────────────────
  /** Cannot mark a student TRANSFERRED_OUT before issuing a Transfer Certificate */
  TC_REQUIRED_FOR_TRANSFER: 'TC_REQUIRED_FOR_TRANSFER',

  // ── Guardian ───────────────────────────────────────────
  /** Cannot unlink a student's only guardian — link another guardian first */
  LAST_GUARDIAN_CANNOT_BE_DELETED: 'LAST_GUARDIAN_CANNOT_BE_DELETED',

  // ── Timetable ──────────────────────────────────────────
  /** Timetable not found or soft-deleted */
  TIMETABLE_NOT_FOUND: 'TIMETABLE_NOT_FOUND',
  /** A timetable with this name already exists in the same academic year */
  TIMETABLE_NAME_DUPLICATE: 'TIMETABLE_NAME_DUPLICATE',
  /** Generation/period config is invalid (bad period count, lunch position, duration) */
  TIMETABLE_INVALID_CONFIG: 'TIMETABLE_INVALID_CONFIG',
  /** Another timetable is already ACTIVE for this institute + academic year */
  TIMETABLE_ALREADY_ACTIVE: 'TIMETABLE_ALREADY_ACTIVE',
  /** The teacher is already assigned to another section in the same period + weekday */
  TIMETABLE_TEACHER_CONFLICT: 'TIMETABLE_TEACHER_CONFLICT',
  /** The room is already in use by another section in the same period + weekday */
  TIMETABLE_ROOM_CONFLICT: 'TIMETABLE_ROOM_CONFLICT',
  /** Cannot assign a subject/teacher to a BREAK period */
  TIMETABLE_PERIOD_NOT_ASSIGNABLE: 'TIMETABLE_PERIOD_NOT_ASSIGNABLE',
  /** The section is not covered by this timetable */
  TIMETABLE_SECTION_NOT_COVERED: 'TIMETABLE_SECTION_NOT_COVERED',

  // ── Examination & report cards ─────────────────────────
  /** Exam not found or soft-deleted */
  EXAM_NOT_FOUND: 'EXAM_NOT_FOUND',
  /** An exam with this name already exists in the academic year */
  EXAM_NAME_DUPLICATE: 'EXAM_NAME_DUPLICATE',
  /** Exam scope/schedule/config is invalid */
  EXAM_INVALID_CONFIG: 'EXAM_INVALID_CONFIG',
  /** Obtained marks exceed the component max (or are negative) */
  EXAM_MARKS_OUT_OF_RANGE: 'EXAM_MARKS_OUT_OF_RANGE',
  /** Marks can only be entered while the exam is in MARKS_ENTRY */
  EXAM_NOT_IN_MARKS_ENTRY: 'EXAM_NOT_IN_MARKS_ENTRY',
  /** Two exam schedule rows clash on room + date + time */
  EXAM_SCHEDULE_CONFLICT: 'EXAM_SCHEDULE_CONFLICT',
  /** Grading scheme not found or soft-deleted */
  GRADING_SCHEME_NOT_FOUND: 'GRADING_SCHEME_NOT_FOUND',
  /** Grade bands overlap or leave a gap in 0–100 */
  GRADING_SCHEME_INVALID_BANDS: 'GRADING_SCHEME_INVALID_BANDS',
  /** Grading scheme is referenced by an exam/report card and cannot be deleted */
  GRADING_SCHEME_IN_USE: 'GRADING_SCHEME_IN_USE',
  /** Report card not found or soft-deleted */
  REPORT_CARD_NOT_FOUND: 'REPORT_CARD_NOT_FOUND',
  /** Report card has not been published to students/parents yet */
  REPORT_CARD_NOT_PUBLISHED: 'REPORT_CARD_NOT_PUBLISHED',
  /** Report card generation failed (missing marks / no covered exams) */
  REPORT_CARD_GENERATION_FAILED: 'REPORT_CARD_GENERATION_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Maps each error code to its HTTP status.
 * Status categories per PRD §14:
 *   401 = not authenticated / credentials rejected
 *   403 = CASL permission denied
 *   404 = not found
 *   400 = validation failure
 *   409 = conflict (concurrent/duplicate)
 *   422 = business rule violation
 */
export const ERROR_STATUS: Record<ErrorCode, HttpStatus> = {
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  UNPROCESSABLE_ENTITY: HttpStatus.UNPROCESSABLE_ENTITY,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  ACCOUNT_LOCKED: HttpStatus.UNAUTHORIZED,
  ACCOUNT_NOT_FOUND: HttpStatus.UNAUTHORIZED,
  ACCOUNT_INACTIVE: HttpStatus.UNAUTHORIZED,
  SESSION_EXPIRED: HttpStatus.UNAUTHORIZED,
  PASSWORD_CHANGED: HttpStatus.UNAUTHORIZED,
  PASSWORD_CHANGE_REQUIRED: HttpStatus.FORBIDDEN,
  CURRENT_PASSWORD_INCORRECT: HttpStatus.UNAUTHORIZED,
  PASSWORD_UNCHANGED: HttpStatus.BAD_REQUEST,
  NO_ACTIVE_MEMBERSHIP: HttpStatus.FORBIDDEN,
  SESSION_NOT_FOUND: HttpStatus.FORBIDDEN,
  IMPERSONATION_ENDED: HttpStatus.UNAUTHORIZED,
  PASSKEY_CHALLENGE_EXPIRED: HttpStatus.BAD_REQUEST,
  PASSKEY_VERIFICATION_FAILED: HttpStatus.BAD_REQUEST,
  PASSKEY_AUTHENTICATION_FAILED: HttpStatus.UNAUTHORIZED,
  PASSKEY_NOT_FOUND: HttpStatus.NOT_FOUND,
  PASSKEY_LAST_AUTH_METHOD: HttpStatus.BAD_REQUEST,
  INSTITUTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSTITUTE_CODE_DUPLICATE: HttpStatus.CONFLICT,
  INSTITUTE_EMAIL_DUPLICATE: HttpStatus.CONFLICT,
  SETUP_NOT_COMPLETE: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_STATE_TRANSITION: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_LOCALE_SETTINGS: HttpStatus.UNPROCESSABLE_ENTITY,
  RESELLER_NOT_FOUND: HttpStatus.NOT_FOUND,
  RESELLER_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  SYSTEM_RESELLER_PROTECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  SLUG_DUPLICATE: HttpStatus.CONFLICT,
  RESELLER_HAS_ACTIVE_INSTITUTES: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_TIER: HttpStatus.BAD_REQUEST,
  TIER_CHANGE_REQUIRES_ACTIVE: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_SLUG: HttpStatus.BAD_REQUEST,
  RESELLER_ALREADY_SUSPENDED: HttpStatus.UNPROCESSABLE_ENTITY,
  RESELLER_NOT_SUSPENDED: HttpStatus.UNPROCESSABLE_ENTITY,
  GRACE_PERIOD_NOT_ELAPSED: HttpStatus.UNPROCESSABLE_ENTITY,
  CONCURRENT_MODIFICATION: HttpStatus.CONFLICT,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  ACADEMIC_YEAR_OVERLAP: HttpStatus.BAD_REQUEST,
  INVALID_DATE_RANGE: HttpStatus.BAD_REQUEST,
  LAST_ACADEMIC_YEAR: HttpStatus.UNPROCESSABLE_ENTITY,
  YEAR_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  NO_ACTIVE_ACADEMIC_YEAR: HttpStatus.UNPROCESSABLE_ENTITY,
  LABEL_DATE_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  STANDARD_NAME_DUPLICATE: HttpStatus.CONFLICT,
  SECTION_NAME_DUPLICATE: HttpStatus.CONFLICT,
  HAS_ACTIVE_ENROLLMENTS: HttpStatus.UNPROCESSABLE_ENTITY,
  HAS_RECORDED_ASSESSMENTS: HttpStatus.UNPROCESSABLE_ENTITY,
  TC_REQUIRED_FOR_TRANSFER: HttpStatus.UNPROCESSABLE_ENTITY,
  LAST_GUARDIAN_CANNOT_BE_DELETED: HttpStatus.UNPROCESSABLE_ENTITY,
  STREAM_REQUIRED: HttpStatus.BAD_REQUEST,
  SECTION_CAPACITY_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  SUBJECT_CODE_DUPLICATE: HttpStatus.CONFLICT,
  TIMETABLE_NOT_FOUND: HttpStatus.NOT_FOUND,
  TIMETABLE_NAME_DUPLICATE: HttpStatus.CONFLICT,
  TIMETABLE_INVALID_CONFIG: HttpStatus.BAD_REQUEST,
  TIMETABLE_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  TIMETABLE_TEACHER_CONFLICT: HttpStatus.CONFLICT,
  TIMETABLE_ROOM_CONFLICT: HttpStatus.CONFLICT,
  TIMETABLE_PERIOD_NOT_ASSIGNABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  TIMETABLE_SECTION_NOT_COVERED: HttpStatus.UNPROCESSABLE_ENTITY,
  EXAM_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXAM_NAME_DUPLICATE: HttpStatus.CONFLICT,
  EXAM_INVALID_CONFIG: HttpStatus.BAD_REQUEST,
  EXAM_MARKS_OUT_OF_RANGE: HttpStatus.BAD_REQUEST,
  EXAM_NOT_IN_MARKS_ENTRY: HttpStatus.UNPROCESSABLE_ENTITY,
  EXAM_SCHEDULE_CONFLICT: HttpStatus.CONFLICT,
  GRADING_SCHEME_NOT_FOUND: HttpStatus.NOT_FOUND,
  GRADING_SCHEME_INVALID_BANDS: HttpStatus.BAD_REQUEST,
  GRADING_SCHEME_IN_USE: HttpStatus.CONFLICT,
  REPORT_CARD_NOT_FOUND: HttpStatus.NOT_FOUND,
  REPORT_CARD_NOT_PUBLISHED: HttpStatus.UNPROCESSABLE_ENTITY,
  REPORT_CARD_GENERATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
};
