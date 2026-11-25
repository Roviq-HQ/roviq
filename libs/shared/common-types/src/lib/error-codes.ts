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
  /** A view-only impersonation session attempted to change something */
  IMPERSONATION_READ_ONLY: 'IMPERSONATION_READ_ONLY',

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
  /** Login refused: every institute the user belongs to is not ACTIVE (pending, inactive, suspended, rejected) */
  INSTITUTE_NOT_ACTIVE: 'INSTITUTE_NOT_ACTIVE',
  /** Another non-deleted institute already uses this code */
  INSTITUTE_CODE_DUPLICATE: 'INSTITUTE_CODE_DUPLICATE',
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
  /** Initial reseller admin email is held by a deleted user, by several users, or is another user's Roviq ID */
  RESELLER_ADMIN_EMAIL_UNAVAILABLE: 'RESELLER_ADMIN_EMAIL_UNAVAILABLE',
  /** The first institute admin's email or mobile cannot be used; the reason is never disclosed */
  INSTITUTE_ADMIN_UNAVAILABLE: 'INSTITUTE_ADMIN_UNAVAILABLE',
  /** The email verification code is wrong, expired, or was tried too many times */
  EMAIL_VERIFICATION_CODE_INVALID: 'EMAIL_VERIFICATION_CODE_INVALID',
  /** A verification code was sent moments ago; wait before asking for another */
  EMAIL_VERIFICATION_TOO_SOON: 'EMAIL_VERIFICATION_TOO_SOON',
  /** The daily number of verification codes for this account is used up */
  EMAIL_VERIFICATION_LIMIT_REACHED: 'EMAIL_VERIFICATION_LIMIT_REACHED',
  /** The person already signed in and set a password; new sign-in details cannot be sent */
  SIGN_IN_ALREADY_COMPLETED: 'SIGN_IN_ALREADY_COMPLETED',
  /** The person has no real email and no phone, so sign-in details have nowhere to go */
  SIGN_IN_CONTACT_MISSING: 'SIGN_IN_CONTACT_MISSING',
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
  /** Another academic year of the institute, a deleted one included, already has this label */
  ACADEMIC_YEAR_LABEL_DUPLICATE: 'ACADEMIC_YEAR_LABEL_DUPLICATE',

  // ── Standard / Section / Subject ───────────────────────
  /** A standard with this name already exists in the same academic year */
  STANDARD_NAME_DUPLICATE: 'STANDARD_NAME_DUPLICATE',
  /** A standard with this class level (numeric order) already exists in the same academic year */
  STANDARD_ORDER_DUPLICATE: 'STANDARD_ORDER_DUPLICATE',
  /** A section with this name already exists in the same standard */
  SECTION_NAME_DUPLICATE: 'SECTION_NAME_DUPLICATE',
  /** Cannot delete — students are actively enrolled */
  HAS_ACTIVE_ENROLLMENTS: 'HAS_ACTIVE_ENROLLMENTS',
  /** Cannot restore student — the admission number was reissued to a live student */
  ADMISSION_NUMBER_TAKEN: 'ADMISSION_NUMBER_TAKEN',
  /** Cannot delete subject — assessments have been recorded against it */
  HAS_RECORDED_ASSESSMENTS: 'HAS_RECORDED_ASSESSMENTS',
  /** Section under a stream-applicable standard must specify a stream */
  STREAM_REQUIRED: 'STREAM_REQUIRED',
  /** Section capacity exceeded — provide an override reason or increase capacity */
  SECTION_CAPACITY_EXCEEDED: 'SECTION_CAPACITY_EXCEEDED',
  /** Section still has students in it — move them to another section before deleting */
  SECTION_HAS_STUDENTS: 'SECTION_HAS_STUDENTS',
  /** Student already has a record in that academic year */
  STUDENT_ALREADY_ENROLLED: 'STUDENT_ALREADY_ENROLLED',
  /** Student has attendance, marks, assessments or report cards in that year — cannot remove */
  STUDENT_YEAR_HAS_RECORDS: 'STUDENT_YEAR_HAS_RECORDS',

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
  /** The section is already covered by this timetable */
  TIMETABLE_SECTION_DUPLICATE: 'TIMETABLE_SECTION_DUPLICATE',
  /** Another period of this timetable already has this label */
  TIMETABLE_PERIOD_LABEL_DUPLICATE: 'TIMETABLE_PERIOD_LABEL_DUPLICATE',
  /** That section, period and group already has a change for that date */
  TIMETABLE_DAY_OVERRIDE_DUPLICATE: 'TIMETABLE_DAY_OVERRIDE_DUPLICATE',

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
  /** The exam already has a paper for this section, subject and component */
  EXAM_SCHEDULE_DUPLICATE: 'EXAM_SCHEDULE_DUPLICATE',
  /** An exam term with this name already exists in the academic year */
  EXAM_TERM_NAME_DUPLICATE: 'EXAM_TERM_NAME_DUPLICATE',
  /** A grading scheme with this name already exists in the institute */
  GRADING_SCHEME_NAME_DUPLICATE: 'GRADING_SCHEME_NAME_DUPLICATE',
  /** A co-scholastic area with this name already exists in the institute */
  CO_SCHOLASTIC_AREA_NAME_DUPLICATE: 'CO_SCHOLASTIC_AREA_NAME_DUPLICATE',
  /** Another topic of this subject and standard already has this code */
  SUBJECT_TOPIC_CODE_DUPLICATE: 'SUBJECT_TOPIC_CODE_DUPLICATE',
  /** A report card with this name already exists in the academic year */
  REPORT_CARD_NAME_DUPLICATE: 'REPORT_CARD_NAME_DUPLICATE',
  /** Grading scheme not found or soft-deleted */
  GRADING_SCHEME_NOT_FOUND: 'GRADING_SCHEME_NOT_FOUND',
  /** Grade bands overlap, leave a gap in 0–100, or repeat a grade */
  GRADING_SCHEME_INVALID_BANDS: 'GRADING_SCHEME_INVALID_BANDS',
  /** Grading scheme is referenced by an exam/report card and cannot be deleted */
  GRADING_SCHEME_IN_USE: 'GRADING_SCHEME_IN_USE',
  /** Report card not found or soft-deleted */
  REPORT_CARD_NOT_FOUND: 'REPORT_CARD_NOT_FOUND',
  /** Report card has not been published to students/parents yet */
  REPORT_CARD_NOT_PUBLISHED: 'REPORT_CARD_NOT_PUBLISHED',
  /** Report card generation failed (missing marks / no covered exams) */
  REPORT_CARD_GENERATION_FAILED: 'REPORT_CARD_GENERATION_FAILED',
  // ── Not found ──────────────────────────────────────────
  /** Academic year not found in this institute */
  ACADEMIC_YEAR_NOT_FOUND: 'ACADEMIC_YEAR_NOT_FOUND',
  /** Admission application not found */
  APPLICATION_NOT_FOUND: 'APPLICATION_NOT_FOUND',
  /** Attendance session not found */
  ATTENDANCE_SESSION_NOT_FOUND: 'ATTENDANCE_SESSION_NOT_FOUND',
  /** Bot profile not found */
  BOT_NOT_FOUND: 'BOT_NOT_FOUND',
  /** Issued certificate not found */
  CERTIFICATE_NOT_FOUND: 'CERTIFICATE_NOT_FOUND',
  /** Certificate template not found */
  CERTIFICATE_TEMPLATE_NOT_FOUND: 'CERTIFICATE_TEMPLATE_NOT_FOUND',
  /** Dead-letter message not found */
  DLQ_MESSAGE_NOT_FOUND: 'DLQ_MESSAGE_NOT_FOUND',
  /** Messaging sender not found, or deleted */
  MESSAGING_SENDER_NOT_FOUND: 'MESSAGING_SENDER_NOT_FOUND',
  /** A live sender already exists for this institute (or the platform), or this provider number is registered */
  MESSAGING_SENDER_EXISTS: 'MESSAGING_SENDER_EXISTS',
  /** The provider refused the token for the sender's account: not its account, or no template-management permission */
  MESSAGING_TOKEN_CANNOT_MANAGE_TEMPLATES: 'MESSAGING_TOKEN_CANNOT_MANAGE_TEMPLATES',
  /** The WhatsApp provider could not be reached to check the token; nothing was stored */
  MESSAGING_PROVIDER_UNREACHABLE: 'MESSAGING_PROVIDER_UNREACHABLE',
  /** The sender has no provider account id, so its templates cannot be synced */
  MESSAGING_SENDER_ACCOUNT_MISSING: 'MESSAGING_SENDER_ACCOUNT_MISSING',
  /** Admission enquiry not found */
  ENQUIRY_NOT_FOUND: 'ENQUIRY_NOT_FOUND',
  /** Exam schedule row not found */
  EXAM_SCHEDULE_NOT_FOUND: 'EXAM_SCHEDULE_NOT_FOUND',
  /** Exam term not found */
  EXAM_TERM_NOT_FOUND: 'EXAM_TERM_NOT_FOUND',
  /** Member is not part of the group */
  GROUP_MEMBER_NOT_FOUND: 'GROUP_MEMBER_NOT_FOUND',
  /** User group not found */
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  /** Another live group of the institute already has this name */
  GROUP_NAME_DUPLICATE: 'GROUP_NAME_DUPLICATE',
  /** Guardian is not linked to the student */
  GUARDIAN_LINK_NOT_FOUND: 'GUARDIAN_LINK_NOT_FOUND',
  /** Guardian profile not found */
  GUARDIAN_NOT_FOUND: 'GUARDIAN_NOT_FOUND',
  /** Holiday not found */
  HOLIDAY_NOT_FOUND: 'HOLIDAY_NOT_FOUND',
  /** Institute group not found */
  INSTITUTE_GROUP_NOT_FOUND: 'INSTITUTE_GROUP_NOT_FOUND',
  /** Another live institute group already has this code */
  INSTITUTE_GROUP_CODE_DUPLICATE: 'INSTITUTE_GROUP_CODE_DUPLICATE',
  /** The user is already a member of this institute group */
  INSTITUTE_GROUP_MEMBER_DUPLICATE: 'INSTITUTE_GROUP_MEMBER_DUPLICATE',
  /** Leave request not found */
  LEAVE_NOT_FOUND: 'LEAVE_NOT_FOUND',
  /** Stored file not found, not owned by the caller, or not usable for this purpose */
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  /** Membership row not found */
  MEMBERSHIP_NOT_FOUND: 'MEMBERSHIP_NOT_FOUND',
  /** Notification does not exist or is not the caller's; both answer the same */
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  /** No active payment gateway is configured for the reseller or institute */
  PAYMENT_GATEWAY_NOT_CONFIGURED: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
  /** Role not found (including a missing default role for the institute) */
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  /** Section not found */
  SECTION_NOT_FOUND: 'SECTION_NOT_FOUND',
  /** Staff profile not found */
  STAFF_NOT_FOUND: 'STAFF_NOT_FOUND',
  /** Another current staff member of the institute already has this employee ID */
  EMPLOYEE_ID_DUPLICATE: 'EMPLOYEE_ID_DUPLICATE',
  /** The email is already the email of a Roviq account, a deleted one included */
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  /** Staff qualification not found */
  STAFF_QUALIFICATION_NOT_FOUND: 'STAFF_QUALIFICATION_NOT_FOUND',
  /** Standard not found */
  STANDARD_NOT_FOUND: 'STANDARD_NOT_FOUND',
  /** Student has no academic record for the year */
  STUDENT_ACADEMIC_NOT_FOUND: 'STUDENT_ACADEMIC_NOT_FOUND',
  /** Student profile not found */
  STUDENT_NOT_FOUND: 'STUDENT_NOT_FOUND',
  /** Subject not found */
  SUBJECT_NOT_FOUND: 'SUBJECT_NOT_FOUND',
  /** Subscription not found */
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  /** Subscription plan not found */
  SUBSCRIPTION_PLAN_NOT_FOUND: 'SUBSCRIPTION_PLAN_NOT_FOUND',
  /** Transfer Certificate not found or not in the state the action needs */
  TC_NOT_FOUND: 'TC_NOT_FOUND',
  /** The student already has a Transfer Certificate request in progress */
  TC_ALREADY_REQUESTED: 'TC_ALREADY_REQUESTED',
  /** A PDF could not be rendered because its text uses a script no bundled font covers */
  PDF_UNSUPPORTED_SCRIPT: 'PDF_UNSUPPORTED_SCRIPT',
  /** The PDF of this record has not been rendered yet; issue it or generate it first */
  PDF_NOT_READY: 'PDF_NOT_READY',
  /** Reseller team member not found */
  TEAM_MEMBER_NOT_FOUND: 'TEAM_MEMBER_NOT_FOUND',
  /** The invited person already has a membership (active or inactive) in this reseller */
  TEAM_MEMBER_ALREADY_EXISTS: 'TEAM_MEMBER_ALREADY_EXISTS',
  /** Invite email cannot be used: its account is deleted, ambiguous, or it is another account's Roviq ID */
  TEAM_MEMBER_EMAIL_UNAVAILABLE: 'TEAM_MEMBER_EMAIL_UNAVAILABLE',
  /** A team member tried to change their own role or deactivate themselves */
  TEAM_MEMBER_SELF_CHANGE: 'TEAM_MEMBER_SELF_CHANGE',
  /** The member, or the role being assigned, ranks above what the caller or the reseller's tier allows */
  TEAM_ROLE_NOT_ASSIGNABLE: 'TEAM_ROLE_NOT_ASSIGNABLE',
  /** Deactivate attempted on an inactive member, or reactivate on an active one */
  TEAM_MEMBER_STATUS_UNCHANGED: 'TEAM_MEMBER_STATUS_UNCHANGED',
  /** Timetable override not found */
  TIMETABLE_OVERRIDE_NOT_FOUND: 'TIMETABLE_OVERRIDE_NOT_FOUND',
  /** Period does not exist in the timetable */
  TIMETABLE_PERIOD_NOT_FOUND: 'TIMETABLE_PERIOD_NOT_FOUND',
  /** User profile not found */
  USER_PROFILE_NOT_FOUND: 'USER_PROFILE_NOT_FOUND',

  // ── Admission / academics ──────────────────────────────
  /** Archived academic years are read-only */
  ACADEMIC_YEAR_ARCHIVED: 'ACADEMIC_YEAR_ARCHIVED',
  /** Applications are only accepted for the active academic year */
  ACADEMIC_YEAR_NOT_ACTIVE: 'ACADEMIC_YEAR_NOT_ACTIVE',
  /** Enquiry was already converted to an application */
  ENQUIRY_ALREADY_CONVERTED: 'ENQUIRY_ALREADY_CONVERTED',
  /** A section must be chosen before the applicant can be enrolled */
  SECTION_REQUIRED: 'SECTION_REQUIRED',
  /** Chosen section belongs to a different standard than the application */
  SECTION_STANDARD_MISMATCH: 'SECTION_STANDARD_MISMATCH',
  /** Action needs an ENROLLED student (e.g. requesting a TC) */
  STUDENT_NOT_ENROLLED: 'STUDENT_NOT_ENROLLED',
  /** Student document type is not one of the supported types */
  INVALID_DOCUMENT_TYPE: 'INVALID_DOCUMENT_TYPE',
  /** A student document needs at least one file URL */
  /** Guardian is already linked to this student */
  GUARDIAN_ALREADY_LINKED: 'GUARDIAN_ALREADY_LINKED',
  /** Unlinking the primary contact needs a replacement primary guardian */
  PRIMARY_GUARDIAN_REQUIRED: 'PRIMARY_GUARDIAN_REQUIRED',
  /** The replacement primary guardian is not another guardian linked to the same student */
  REPLACEMENT_PRIMARY_GUARDIAN_INVALID: 'REPLACEMENT_PRIMARY_GUARDIAN_INVALID',

  // ── Attendance / leave ─────────────────────────────────
  /** Past-day attendance edits need the AttendanceOverride permission */
  ATTENDANCE_OVERRIDE_FORBIDDEN: 'ATTENDANCE_OVERRIDE_FORBIDDEN',
  /** Past-day attendance edit attempted without an explicit admin override */
  ATTENDANCE_EDIT_WINDOW_CLOSED: 'ATTENDANCE_EDIT_WINDOW_CLOSED',
  /** Another lecturer already took attendance for this slot */
  ATTENDANCE_SLOT_TAKEN: 'ATTENDANCE_SLOT_TAKEN',
  /** Attendance cannot be taken on a holiday */
  ATTENDANCE_ON_HOLIDAY: 'ATTENDANCE_ON_HOLIDAY',
  /** Leaves of 3+ calendar days need a supporting document */
  LEAVE_DOCUMENT_REQUIRED: 'LEAVE_DOCUMENT_REQUIRED',
  /** Only PENDING leaves can be edited */
  LEAVE_NOT_EDITABLE: 'LEAVE_NOT_EDITABLE',
  /** The application reached an end state; its documents can no longer change */
  APPLICATION_CLOSED: 'APPLICATION_CLOSED',
  /** The file type is not accepted for this upload purpose */
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  /** The file is larger than this upload purpose allows */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /** The uploaded bytes are missing, or do not match the declared size or type */
  FILE_CONTENT_MISMATCH: 'FILE_CONTENT_MISMATCH',
  /** The image could not be read, or has more pixels than is accepted */
  FILE_IMAGE_INVALID: 'FILE_IMAGE_INVALID',
  /** The malware scanner found a threat in the uploaded file; the file was removed */
  FILE_INFECTED: 'FILE_INFECTED',
  /** The malware scanner could not be reached; the upload is kept and the request can be retried */
  FILE_SCAN_UNAVAILABLE: 'FILE_SCAN_UNAVAILABLE',
  /** The institute has used the storage its plan allows; delete files or upgrade the plan */
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  /** Too many uploads started and not yet attached to anything */
  FILE_UPLOAD_LIMIT_REACHED: 'FILE_UPLOAD_LIMIT_REACHED',

  // ── Compliance exports ─────────────────────────────────
  /** No compliance export (or no finished one) with this id or file for the caller */
  EXPORT_REPORT_NOT_FOUND: 'EXPORT_REPORT_NOT_FOUND',
  /** The export workflow could not be started; the export is marked FAILED */
  EXPORT_START_FAILED: 'EXPORT_START_FAILED',
  /** Building or storing the export file failed after every retry */
  EXPORT_GENERATION_FAILED: 'EXPORT_GENERATION_FAILED',
  /** The institute does not qualify for this report type (board affiliation or state) */
  EXPORT_TYPE_NOT_AVAILABLE: 'EXPORT_TYPE_NOT_AVAILABLE',
  /** The export was still queued or running long after its workflow must have ended */
  EXPORT_TIMED_OUT: 'EXPORT_TIMED_OUT',

  // ── Impersonation ──────────────────────────────────────
  /** Target user cannot be impersonated (self, inactive, or no membership in the institute) */
  IMPERSONATION_TARGET_INVALID: 'IMPERSONATION_TARGET_INVALID',
  /** Impersonation session is missing, already ended, or has no target tenant */
  IMPERSONATION_SESSION_INVALID: 'IMPERSONATION_SESSION_INVALID',
  /** Consent OTP cannot be sent (no active institute admin or no contact phone) */
  IMPERSONATION_CONSENT_UNAVAILABLE: 'IMPERSONATION_CONSENT_UNAVAILABLE',
  /** Consent OTP is wrong or not valid for this session */
  IMPERSONATION_OTP_INVALID: 'IMPERSONATION_OTP_INVALID',
  /** Consent OTP expired or was never issued */
  IMPERSONATION_OTP_EXPIRED: 'IMPERSONATION_OTP_EXPIRED',
  /** Too many wrong consent OTP attempts — the OTP is discarded */
  IMPERSONATION_OTP_ATTEMPTS_EXCEEDED: 'IMPERSONATION_OTP_ATTEMPTS_EXCEEDED',
  /** One-time impersonation exchange code expired or was already used */
  IMPERSONATION_CODE_EXPIRED: 'IMPERSONATION_CODE_EXPIRED',

  // ── Billing ────────────────────────────────────────────
  /** Plan cannot be archived while subscriptions still use it */
  PLAN_HAS_ACTIVE_SUBSCRIPTIONS: 'PLAN_HAS_ACTIVE_SUBSCRIPTIONS',
  /** Only inactive plans can be restored */
  PLAN_NOT_INACTIVE: 'PLAN_NOT_INACTIVE',
  /** Only active plans can be assigned */
  PLAN_NOT_ACTIVE: 'PLAN_NOT_ACTIVE',
  /** Institute already has an active subscription */
  SUBSCRIPTION_ALREADY_ACTIVE: 'SUBSCRIPTION_ALREADY_ACTIVE',
  /** Subscription plan not found or deleted */
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  /** Invoice not found */
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  /** Payment not found, or not the caller's to act on */
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  /** Payment gateway configuration not found or deleted */
  GATEWAY_CONFIG_NOT_FOUND: 'GATEWAY_CONFIG_NOT_FOUND',
  /** Plan or gateway configuration is still used by active subscriptions */
  PLAN_IN_USE: 'PLAN_IN_USE',
  /** Plan code already exists for this reseller */
  PLAN_CODE_DUPLICATE: 'PLAN_CODE_DUPLICATE',
  /** Subscription is cancelled or expired and cannot change any more */
  SUBSCRIPTION_TERMINAL: 'SUBSCRIPTION_TERMINAL',
  /** Invoice is already fully paid */
  INVOICE_ALREADY_PAID: 'INVOICE_ALREADY_PAID',
  /** Invoice status does not allow payment (draft, cancelled, refunded) */
  INVOICE_NOT_PAYABLE: 'INVOICE_NOT_PAYABLE',
  /** Payment gateway signature or status check failed */
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  /** Payment gateway returned an error */
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  /** Refund amount is more than was paid */
  REFUND_EXCEEDS_PAID: 'REFUND_EXCEEDS_PAID',
  /** UPI transaction reference (UTR) has the wrong format */
  UTR_INVALID: 'UTR_INVALID',
  /** A payment with this UTR was already submitted */
  UTR_ALREADY_SUBMITTED: 'UTR_ALREADY_SUBMITTED',
  /** The institute has no phone number or email, which the payment gateway needs on the order */
  PAYER_CONTACT_MISSING: 'PAYER_CONTACT_MISSING',
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
  IMPERSONATION_READ_ONLY: HttpStatus.FORBIDDEN,
  PASSKEY_CHALLENGE_EXPIRED: HttpStatus.BAD_REQUEST,
  PASSKEY_VERIFICATION_FAILED: HttpStatus.BAD_REQUEST,
  PASSKEY_AUTHENTICATION_FAILED: HttpStatus.UNAUTHORIZED,
  PASSKEY_NOT_FOUND: HttpStatus.NOT_FOUND,
  PASSKEY_LAST_AUTH_METHOD: HttpStatus.BAD_REQUEST,
  INSTITUTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSTITUTE_NOT_ACTIVE: HttpStatus.FORBIDDEN,
  INSTITUTE_CODE_DUPLICATE: HttpStatus.CONFLICT,
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
  RESELLER_ADMIN_EMAIL_UNAVAILABLE: HttpStatus.CONFLICT,
  INSTITUTE_ADMIN_UNAVAILABLE: HttpStatus.CONFLICT,
  EMAIL_VERIFICATION_CODE_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  EMAIL_VERIFICATION_TOO_SOON: HttpStatus.TOO_MANY_REQUESTS,
  EMAIL_VERIFICATION_LIMIT_REACHED: HttpStatus.TOO_MANY_REQUESTS,
  SIGN_IN_ALREADY_COMPLETED: HttpStatus.CONFLICT,
  SIGN_IN_CONTACT_MISSING: HttpStatus.UNPROCESSABLE_ENTITY,
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
  ACADEMIC_YEAR_LABEL_DUPLICATE: HttpStatus.CONFLICT,
  STANDARD_NAME_DUPLICATE: HttpStatus.CONFLICT,
  STANDARD_ORDER_DUPLICATE: HttpStatus.CONFLICT,
  SECTION_NAME_DUPLICATE: HttpStatus.CONFLICT,
  HAS_ACTIVE_ENROLLMENTS: HttpStatus.UNPROCESSABLE_ENTITY,
  ADMISSION_NUMBER_TAKEN: HttpStatus.UNPROCESSABLE_ENTITY,
  HAS_RECORDED_ASSESSMENTS: HttpStatus.UNPROCESSABLE_ENTITY,
  TC_REQUIRED_FOR_TRANSFER: HttpStatus.UNPROCESSABLE_ENTITY,
  LAST_GUARDIAN_CANNOT_BE_DELETED: HttpStatus.UNPROCESSABLE_ENTITY,
  STREAM_REQUIRED: HttpStatus.BAD_REQUEST,
  SECTION_CAPACITY_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  SECTION_HAS_STUDENTS: HttpStatus.CONFLICT,
  STUDENT_ALREADY_ENROLLED: HttpStatus.CONFLICT,
  STUDENT_YEAR_HAS_RECORDS: HttpStatus.CONFLICT,
  TIMETABLE_NOT_FOUND: HttpStatus.NOT_FOUND,
  TIMETABLE_NAME_DUPLICATE: HttpStatus.CONFLICT,
  TIMETABLE_INVALID_CONFIG: HttpStatus.BAD_REQUEST,
  TIMETABLE_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  TIMETABLE_TEACHER_CONFLICT: HttpStatus.CONFLICT,
  TIMETABLE_ROOM_CONFLICT: HttpStatus.CONFLICT,
  TIMETABLE_PERIOD_NOT_ASSIGNABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  TIMETABLE_SECTION_NOT_COVERED: HttpStatus.UNPROCESSABLE_ENTITY,
  TIMETABLE_SECTION_DUPLICATE: HttpStatus.CONFLICT,
  TIMETABLE_PERIOD_LABEL_DUPLICATE: HttpStatus.CONFLICT,
  TIMETABLE_DAY_OVERRIDE_DUPLICATE: HttpStatus.CONFLICT,
  EXAM_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXAM_NAME_DUPLICATE: HttpStatus.CONFLICT,
  EXAM_INVALID_CONFIG: HttpStatus.BAD_REQUEST,
  EXAM_MARKS_OUT_OF_RANGE: HttpStatus.BAD_REQUEST,
  EXAM_NOT_IN_MARKS_ENTRY: HttpStatus.UNPROCESSABLE_ENTITY,
  EXAM_SCHEDULE_CONFLICT: HttpStatus.CONFLICT,
  EXAM_SCHEDULE_DUPLICATE: HttpStatus.CONFLICT,
  EXAM_TERM_NAME_DUPLICATE: HttpStatus.CONFLICT,
  GRADING_SCHEME_NAME_DUPLICATE: HttpStatus.CONFLICT,
  CO_SCHOLASTIC_AREA_NAME_DUPLICATE: HttpStatus.CONFLICT,
  SUBJECT_TOPIC_CODE_DUPLICATE: HttpStatus.CONFLICT,
  REPORT_CARD_NAME_DUPLICATE: HttpStatus.CONFLICT,
  GRADING_SCHEME_NOT_FOUND: HttpStatus.NOT_FOUND,
  GRADING_SCHEME_INVALID_BANDS: HttpStatus.BAD_REQUEST,
  GRADING_SCHEME_IN_USE: HttpStatus.CONFLICT,
  REPORT_CARD_NOT_FOUND: HttpStatus.NOT_FOUND,
  REPORT_CARD_NOT_PUBLISHED: HttpStatus.UNPROCESSABLE_ENTITY,
  REPORT_CARD_GENERATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  ACADEMIC_YEAR_NOT_FOUND: HttpStatus.NOT_FOUND,
  APPLICATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  ATTENDANCE_SESSION_NOT_FOUND: HttpStatus.NOT_FOUND,
  BOT_NOT_FOUND: HttpStatus.NOT_FOUND,
  CERTIFICATE_NOT_FOUND: HttpStatus.NOT_FOUND,
  CERTIFICATE_TEMPLATE_NOT_FOUND: HttpStatus.NOT_FOUND,
  DLQ_MESSAGE_NOT_FOUND: HttpStatus.NOT_FOUND,
  MESSAGING_SENDER_NOT_FOUND: HttpStatus.NOT_FOUND,
  MESSAGING_SENDER_EXISTS: HttpStatus.CONFLICT,
  MESSAGING_TOKEN_CANNOT_MANAGE_TEMPLATES: HttpStatus.UNPROCESSABLE_ENTITY,
  MESSAGING_PROVIDER_UNREACHABLE: HttpStatus.SERVICE_UNAVAILABLE,
  MESSAGING_SENDER_ACCOUNT_MISSING: HttpStatus.UNPROCESSABLE_ENTITY,
  ENQUIRY_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXAM_SCHEDULE_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXAM_TERM_NOT_FOUND: HttpStatus.NOT_FOUND,
  GROUP_MEMBER_NOT_FOUND: HttpStatus.NOT_FOUND,
  GROUP_NOT_FOUND: HttpStatus.NOT_FOUND,
  GROUP_NAME_DUPLICATE: HttpStatus.CONFLICT,
  GUARDIAN_LINK_NOT_FOUND: HttpStatus.NOT_FOUND,
  GUARDIAN_NOT_FOUND: HttpStatus.NOT_FOUND,
  HOLIDAY_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSTITUTE_GROUP_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSTITUTE_GROUP_CODE_DUPLICATE: HttpStatus.CONFLICT,
  INSTITUTE_GROUP_MEMBER_DUPLICATE: HttpStatus.CONFLICT,
  LEAVE_NOT_FOUND: HttpStatus.NOT_FOUND,
  FILE_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEMBERSHIP_NOT_FOUND: HttpStatus.NOT_FOUND,
  NOTIFICATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYMENT_GATEWAY_NOT_CONFIGURED: HttpStatus.NOT_FOUND,
  ROLE_NOT_FOUND: HttpStatus.NOT_FOUND,
  SECTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAFF_NOT_FOUND: HttpStatus.NOT_FOUND,
  EMPLOYEE_ID_DUPLICATE: HttpStatus.CONFLICT,
  EMAIL_TAKEN: HttpStatus.CONFLICT,
  STAFF_QUALIFICATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  STANDARD_NOT_FOUND: HttpStatus.NOT_FOUND,
  STUDENT_ACADEMIC_NOT_FOUND: HttpStatus.NOT_FOUND,
  STUDENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  SUBJECT_NOT_FOUND: HttpStatus.NOT_FOUND,
  SUBSCRIPTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  SUBSCRIPTION_PLAN_NOT_FOUND: HttpStatus.NOT_FOUND,
  TC_NOT_FOUND: HttpStatus.NOT_FOUND,
  TC_ALREADY_REQUESTED: HttpStatus.CONFLICT,
  PDF_UNSUPPORTED_SCRIPT: HttpStatus.UNPROCESSABLE_ENTITY,
  PDF_NOT_READY: HttpStatus.CONFLICT,
  TEAM_MEMBER_NOT_FOUND: HttpStatus.NOT_FOUND,
  TEAM_MEMBER_ALREADY_EXISTS: HttpStatus.CONFLICT,
  TEAM_MEMBER_EMAIL_UNAVAILABLE: HttpStatus.CONFLICT,
  TEAM_MEMBER_SELF_CHANGE: HttpStatus.FORBIDDEN,
  TEAM_ROLE_NOT_ASSIGNABLE: HttpStatus.FORBIDDEN,
  TEAM_MEMBER_STATUS_UNCHANGED: HttpStatus.UNPROCESSABLE_ENTITY,
  TIMETABLE_OVERRIDE_NOT_FOUND: HttpStatus.NOT_FOUND,
  TIMETABLE_PERIOD_NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_PROFILE_NOT_FOUND: HttpStatus.NOT_FOUND,
  ACADEMIC_YEAR_ARCHIVED: HttpStatus.BAD_REQUEST,
  ACADEMIC_YEAR_NOT_ACTIVE: HttpStatus.CONFLICT,
  ENQUIRY_ALREADY_CONVERTED: HttpStatus.CONFLICT,
  SECTION_REQUIRED: HttpStatus.BAD_REQUEST,
  SECTION_STANDARD_MISMATCH: HttpStatus.BAD_REQUEST,
  STUDENT_NOT_ENROLLED: HttpStatus.BAD_REQUEST,
  INVALID_DOCUMENT_TYPE: HttpStatus.UNPROCESSABLE_ENTITY,
  GUARDIAN_ALREADY_LINKED: HttpStatus.CONFLICT,
  PRIMARY_GUARDIAN_REQUIRED: HttpStatus.BAD_REQUEST,
  REPLACEMENT_PRIMARY_GUARDIAN_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  ATTENDANCE_OVERRIDE_FORBIDDEN: HttpStatus.FORBIDDEN,
  ATTENDANCE_EDIT_WINDOW_CLOSED: HttpStatus.FORBIDDEN,
  ATTENDANCE_SLOT_TAKEN: HttpStatus.CONFLICT,
  ATTENDANCE_ON_HOLIDAY: HttpStatus.CONFLICT,
  LEAVE_DOCUMENT_REQUIRED: HttpStatus.BAD_REQUEST,
  LEAVE_NOT_EDITABLE: HttpStatus.BAD_REQUEST,
  APPLICATION_CLOSED: HttpStatus.UNPROCESSABLE_ENTITY,
  FILE_TYPE_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  FILE_TOO_LARGE: HttpStatus.BAD_REQUEST,
  FILE_CONTENT_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  FILE_IMAGE_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  FILE_INFECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  FILE_SCAN_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  STORAGE_QUOTA_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  FILE_UPLOAD_LIMIT_REACHED: HttpStatus.TOO_MANY_REQUESTS,
  EXPORT_REPORT_NOT_FOUND: HttpStatus.NOT_FOUND,
  EXPORT_START_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  EXPORT_GENERATION_FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
  EXPORT_TYPE_NOT_AVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  EXPORT_TIMED_OUT: HttpStatus.GATEWAY_TIMEOUT,
  IMPERSONATION_TARGET_INVALID: HttpStatus.BAD_REQUEST,
  IMPERSONATION_SESSION_INVALID: HttpStatus.BAD_REQUEST,
  IMPERSONATION_CONSENT_UNAVAILABLE: HttpStatus.BAD_REQUEST,
  IMPERSONATION_OTP_INVALID: HttpStatus.UNAUTHORIZED,
  IMPERSONATION_OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  IMPERSONATION_OTP_ATTEMPTS_EXCEEDED: HttpStatus.UNAUTHORIZED,
  IMPERSONATION_CODE_EXPIRED: HttpStatus.UNAUTHORIZED,
  PLAN_HAS_ACTIVE_SUBSCRIPTIONS: HttpStatus.BAD_REQUEST,
  PLAN_NOT_INACTIVE: HttpStatus.BAD_REQUEST,
  PLAN_NOT_ACTIVE: HttpStatus.BAD_REQUEST,
  SUBSCRIPTION_ALREADY_ACTIVE: HttpStatus.BAD_REQUEST,
  PLAN_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVOICE_NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  GATEWAY_CONFIG_NOT_FOUND: HttpStatus.NOT_FOUND,
  PLAN_IN_USE: HttpStatus.CONFLICT,
  PLAN_CODE_DUPLICATE: HttpStatus.CONFLICT,
  SUBSCRIPTION_TERMINAL: HttpStatus.UNPROCESSABLE_ENTITY,
  INVOICE_ALREADY_PAID: HttpStatus.CONFLICT,
  INVOICE_NOT_PAYABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  PAYMENT_VERIFICATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  GATEWAY_ERROR: HttpStatus.BAD_GATEWAY,
  REFUND_EXCEEDS_PAID: HttpStatus.UNPROCESSABLE_ENTITY,
  UTR_INVALID: HttpStatus.BAD_REQUEST,
  UTR_ALREADY_SUBMITTED: HttpStatus.CONFLICT,
  PAYER_CONTACT_MISSING: HttpStatus.UNPROCESSABLE_ENTITY,
};
