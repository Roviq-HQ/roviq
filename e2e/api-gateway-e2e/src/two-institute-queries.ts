/**
 * The tables behind `two-institute.api-e2e.spec.ts`. The spec builds a call for every field
 * of `Query` from the schema; these tables say what an id argument names and which queries
 * cannot be called from the schema alone.
 *
 * A new query needs nothing here when its id arguments use the names in `KIND_BY_NAME`.
 * Otherwise the spec fails and names the argument: add a line to one of the tables.
 */
import type { ArgumentTables } from './helpers/schema-queries';

/** A table name, or a key of `SPECIAL_KINDS` in `helpers/institute-rows.ts`. */
type Kind = string;

/** What an id argument or input field names, wherever it appears. */
const KIND_BY_NAME: Record<string, Kind> = {
  academicYearId: 'academic_years',
  applicationId: 'admission_applications',
  examId: 'exams',
  examScheduleId: 'exam_schedules',
  examTermId: 'exam_terms',
  groupId: 'groups',
  guardianProfileId: 'guardian_profiles',
  instanceId: 'report_card_instances',
  instituteId: 'institutes',
  invoiceId: 'invoices',
  reportCardId: 'report_cards',
  resellerId: 'resellers',
  sectionId: 'sections',
  staffId: 'staff_profiles',
  staffProfileId: 'staff_profiles',
  standardId: 'standards',
  studentId: 'student_memberships',
  studentProfileId: 'student_profiles',
  subjectId: 'subjects',
  targetUserId: 'users',
  teacherId: 'staff_memberships',
  templateId: 'certificate_templates',
  tenantId: 'institutes',
  timetableId: 'timetables',
  userId: 'users',
};

/** The same for one operation, where the name alone does not say it (`id`, `sessionId`). */
const KIND_BY_PATH: Record<string, Kind> = {
  'academicYear.id': 'academic_years',
  'adminGetInstitute.id': 'institutes',
  'adminGetReseller.id': 'resellers',
  'adminMessagingTemplates.senderId': 'messaging_senders',
  'attendanceCounts.sessionId': 'attendance_sessions',
  'attendanceEntries.sessionId': 'attendance_sessions',
  'attendanceSession.id': 'attendance_sessions',
  'entityAuditTimeline.entityId': 'student_profiles',
  'exam.id': 'exams',
  'getApplication.id': 'admission_applications',
  'getCertificate.id': 'issued_certificates',
  'getGroup.id': 'groups',
  'getGuardian.id': 'guardian_profiles',
  'getStaffMember.id': 'staff_profiles',
  'getStudent.id': 'student_profiles',
  'getTCDetails.id': 'tc_register',
  'gradingScheme.id': 'grading_schemes',
  'holiday.id': 'holidays',
  'leave.id': 'leaves',
  'myInvoice.id': 'invoices',
  'reportCard.id': 'report_cards',
  'resellerGetInstitute.id': 'institutes',
  'resellerGetTeamMember.membershipId': 'reseller_memberships',
  'section.id': 'sections',
  'standard.id': 'standards',
  'subject.id': 'subjects',
  'subscriptionPlan.id': 'plans',
  'timetable.id': 'timetables',
};

/** Fixed values for required arguments that are not ids. */
const VALUE_BY_PATH: Record<string, unknown> = {
  'adminSearchUsers.query': 'a',
  'bulkImportProgress.workflowId': 'two-institute-no-such-workflow',
  'entityAuditTimeline.entityType': 'Student',
  'mySessions.currentRefreshToken': 'two-institute-no-such-token',
  'previewGroupRule.rule': { '==': [{ var: 'academic_status' }, 'ENROLLED'] },
  'verifyTC.token': 'two-institute-no-such-token',
};

export const ARGUMENT_TABLES: ArgumentTables<Kind> = {
  kindByName: KIND_BY_NAME,
  kindByPath: KIND_BY_PATH,
  valueByPath: VALUE_BY_PATH,
};

/**
 * Queries the spec does not call, each with the reason. A query that is neither callable
 * from the schema nor listed here fails the spec.
 */
export const NOT_CALLED: Readonly<Record<string, string>> = {};

/**
 * Queries that are called but answer no caller with data, each with the reason. Platform
 * queries (`admin…`) are not listed: no caller here may call them. A query in this list that
 * starts returning data fails the spec until it is removed.
 */
export const WITHOUT_DATA: Readonly<Record<string, string>> = {
  bulkImportProgress: 'needs the id of an import workflow that is running',
  generateInvoicePdf: 'the seed has no invoice',
  getApplication: 'the seed has no admission application',
  getCertificate: 'the seed has no issued certificate',
  getCertificateTemplateFields: 'the seed has no certificate template',
  getGroup: 'the seed has no group',
  getTCDetails: 'the seed has no transfer certificate',
  invoicePayments: 'the seed has no invoice',
  listApplicationDocuments: 'the seed has no admission application',
  listGroupMembers: 'the seed has no group',
  myInvoice: 'the seed has no invoice',
  mySessions: "needs the caller's own refresh token",
  previewCertificate: 'the seed has no certificate template',
  reportCardInstance: 'the seeded report cards are drafts with no instance',
  reportCardPdf: 'the seeded report cards are drafts with no instance',
};

/**
 * Queries whose check does not pass yet. Each is run and must still fail: when one starts
 * passing, the spec fails until its name is removed from this list.
 */
export const EXPECTED_TO_FAIL: readonly string[] = ['timetableDaySchedule'];
