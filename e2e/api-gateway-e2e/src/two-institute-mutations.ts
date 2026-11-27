/**
 * The tables for the mutation half of `two-institute.api-e2e.spec.ts`. The spec builds a call
 * for every field of `Mutation` that takes an id, and sends it ids that are not the caller's.
 *
 * Every argument of type `ID` must have a kind here or in `two-institute-queries.ts`: the spec
 * fails for one that has none and names it. An id typed as `String` is listed by hand.
 */
import type { ArgumentTables } from './helpers/schema-queries';
import { ARGUMENT_TABLES } from './two-institute-queries';

/** A table name, or a key of `SPECIAL_KINDS` in `helpers/institute-rows.ts`. */
type Kind = string;

/** What an id argument or input field names, wherever it appears in a mutation. */
const KIND_BY_NAME: Record<string, Kind> = {
  assignedTo: 'staff_memberships',
  botId: 'bot_profiles',
  certificateFileId: 'files',
  childGroupIds: 'groups',
  classTeacherId: 'staff_memberships',
  coScholasticAreaId: 'co_scholastic_areas',
  coverImageFileId: 'files',
  enquiryId: 'enquiries',
  faviconFileId: 'files',
  fileId: 'files',
  fileIds: 'files',
  fromSectionId: 'sections',
  gradingSchemeId: 'grading_schemes',
  invigilatorId: 'staff_memberships',
  lecturerId: 'staff_memberships',
  logoFileId: 'files',
  memberId: 'memberships',
  memberMembershipIds: 'memberships',
  membershipId: 'memberships',
  newPlanId: 'plans',
  newPrimaryGuardianId: 'guardian_profiles',
  newResellerId: 'resellers',
  newSectionId: 'sections',
  notificationId: 'notifications',
  originalTcId: 'tc_register',
  parentGroupId: 'groups',
  passkeyId: 'auth_providers',
  paymentId: 'payments',
  periodId: 'timetable_periods',
  planId: 'plans',
  roleId: 'roles',
  sectionIds: 'sections',
  senderId: 'messaging_senders',
  standardIds: 'standards',
  studentAcademicId: 'student_academics',
  studentAcademicIds: 'student_academics',
  subjectTopicId: 'subject_topics',
  subjectUserId: 'users',
  subscriptionId: 'subscriptions',
  targetTenantId: 'institutes',
  toSectionId: 'sections',
};

/** The same for one mutation, where the name alone does not say it. */
const KIND_BY_PATH: Record<string, Kind> = {
  'activateAcademicYear.id': 'academic_years',
  'activateTimetable.id': 'timetables',
  'adminActivateInstitute.id': 'institutes',
  'adminActivateInstituteGroup.id': 'institute_groups',
  'adminActivateMessagingSender.id': 'messaging_senders',
  'adminAddInstituteGroupMember.groupId': 'institute_groups',
  'adminAddInstituteToGroup.groupId': 'institute_groups',
  'adminApproveInstitute.id': 'institutes',
  'adminAssignInstituteGroup.groupId': 'institute_groups',
  'adminAssignInstituteGroup.id': 'institutes',
  'adminBlockMessagingSender.id': 'messaging_senders',
  'adminChangeResellerTier.id': 'resellers',
  'adminCreateInstitute.input.groupId': 'institute_groups',
  'adminDeactivateInstitute.id': 'institutes',
  'adminDeactivateInstituteGroup.id': 'institute_groups',
  'adminDeleteInstitute.id': 'institutes',
  'adminDeleteInstituteGroup.id': 'institute_groups',
  'adminDeleteMessagingSender.id': 'messaging_senders',
  'adminDiscardDlqMessage.id': 'dlq_messages',
  'adminEndImpersonation.sessionId': 'impersonation_sessions',
  'adminPauseMessagingSender.id': 'messaging_senders',
  'adminReassignInstituteReseller.id': 'institutes',
  'adminRejectInstitute.id': 'institutes',
  'adminRemoveInstituteGroup.id': 'institutes',
  'adminRemoveInstituteGroupMember.groupId': 'institute_groups',
  'adminReplayDlqMessage.id': 'dlq_messages',
  'adminRestoreInstitute.id': 'institutes',
  'adminRetryInstituteSetup.id': 'institutes',
  'adminRotateMessagingSenderToken.id': 'messaging_senders',
  'adminSuspendInstitute.id': 'institutes',
  'adminSuspendInstituteGroup.id': 'institute_groups',
  'adminUpdateInstituteGroup.id': 'institute_groups',
  'adminUpdateMessagingSender.id': 'messaging_senders',
  'adminUpdateReseller.id': 'resellers',
  'adminVerifyImpersonationOtp.sessionId': 'impersonation_sessions',
  'applyLeave.input.userId': 'memberships',
  'approveApplication.id': 'admission_applications',
  'approveLeave.id': 'leaves',
  'approveTC.id': 'tc_register',
  'archiveAcademicYear.id': 'academic_years',
  'archiveExam.id': 'exams',
  'archiveNotification.id': 'notifications',
  'archivePlan.id': 'plans',
  'archiveTimetable.id': 'timetables',
  'bulkMarkAttendance.input.sessionId': 'attendance_sessions',
  'cancelLeave.id': 'leaves',
  'clearTimetableDayOverride.id': 'timetable_day_overrides',
  'deactivateTimetable.id': 'timetables',
  'deleteAcademicYear.id': 'academic_years',
  'deleteAttendanceSession.id': 'attendance_sessions',
  'deleteBot.id': 'bot_profiles',
  'deleteCoScholasticArea.id': 'co_scholastic_areas',
  'deleteExam.id': 'exams',
  'deleteExamTerm.id': 'exam_terms',
  'deleteGatewayConfig.id': 'payment_gateway_configs',
  'deleteGradingScheme.id': 'grading_schemes',
  'deleteGroup.id': 'groups',
  'deleteGuardian.id': 'guardian_profiles',
  'deleteHoliday.id': 'holidays',
  'deleteLeave.id': 'leaves',
  'deletePlan.id': 'plans',
  'deleteReportCard.id': 'report_cards',
  'deleteSection.id': 'sections',
  'deleteStaffMember.id': 'staff_profiles',
  'deleteStaffQualification.id': 'staff_qualifications',
  'deleteStandard.id': 'standards',
  'deleteStudent.id': 'student_profiles',
  'deleteStudentDocument.id': 'user_documents',
  'deleteSubject.id': 'subjects',
  'deleteSubjectTopic.id': 'subject_topics',
  'deleteTimetable.ids': 'timetables',
  'endImpersonation.sessionId': 'impersonation_sessions',
  'generateCertificatePdf.id': 'issued_certificates',
  'generateTCPdf.id': 'tc_register',
  'issueCertificate.id': 'issued_certificates',
  'issueTC.id': 'tc_register',
  'lockExam.id': 'exams',
  'markAttendance.input.sessionId': 'attendance_sessions',
  'markNotificationRead.id': 'notifications',
  'openExamMarksEntry.id': 'exams',
  'overrideAttendanceSession.sessionId': 'attendance_sessions',
  'publishExamResults.id': 'exams',
  'rejectApplication.id': 'admission_applications',
  'rejectLeave.id': 'leaves',
  'rejectTC.id': 'tc_register',
  'removeApplicationDocument.id': 'application_documents',
  'removeExamSchedule.id': 'exam_schedules',
  'resellerAddInstituteToGroup.groupId': 'institute_groups',
  'resellerChangeTeamMemberRole.membershipId': 'reseller_memberships',
  'resellerCreateInstituteRequest.input.groupId': 'institute_groups',
  'resellerDeactivateTeamMember.membershipId': 'reseller_memberships',
  'resellerEndImpersonation.sessionId': 'impersonation_sessions',
  'resellerReactivateInstitute.id': 'institutes',
  'resellerReactivateTeamMember.membershipId': 'reseller_memberships',
  'resellerSuspendInstitute.id': 'institutes',
  'resellerVerifyImpersonationOtp.sessionId': 'impersonation_sessions',
  'restoreExam.id': 'exams',
  'restoreGuardian.id': 'guardian_profiles',
  'restorePlan.id': 'plans',
  'restoreStaffMember.id': 'staff_profiles',
  'restoreStudent.id': 'student_profiles',
  'restoreTimetable.ids': 'timetables',
  'revokeSession.sessionId': 'refresh_tokens',
  'scheduleExam.id': 'exams',
  'transitionStudentStatus.id': 'student_profiles',
  'unarchiveExam.id': 'exams',
  'updateAcademicYear.id': 'academic_years',
  'updateApplication.id': 'admission_applications',
  'updateBot.id': 'bot_profiles',
  'updateEnquiry.id': 'enquiries',
  'updateExam.id': 'exams',
  'updateExamSchedule.id': 'exam_schedules',
  'updateExamTerm.id': 'exam_terms',
  'updateGatewayConfig.id': 'payment_gateway_configs',
  'updateGradingScheme.id': 'grading_schemes',
  'updateGroup.id': 'groups',
  'updateGuardian.id': 'guardian_profiles',
  'updateHoliday.id': 'holidays',
  'updateLeave.id': 'leaves',
  'updateReportCard.id': 'report_cards',
  'updateSection.id': 'sections',
  'updateStaffMember.id': 'staff_profiles',
  'updateStaffQualification.id': 'staff_qualifications',
  'updateStandard.id': 'standards',
  'updateStudent.id': 'student_profiles',
  'updateSubject.id': 'subjects',
  'updateSubscriptionPlan.id': 'plans',
  'updateTimetable.id': 'timetables',
};

/**
 * Kinds that no institute owns a row of, so a random id is always sent: the row belongs to a
 * person or to the platform. Listed so a mistyped kind is told apart from these.
 */
export const KINDS_WITHOUT_INSTITUTE: readonly Kind[] = [
  'auth_providers',
  'impersonation_sessions',
  'user_documents',
];

/** Fixed values for required arguments that are not ids. */
/**
 * Fixed values for arguments that are not ids. Each one is here because the generated value
 * was refused as invalid before the mutation looked at an id.
 */
const VALUE_BY_PATH: Record<string, unknown> = {
  'addTimetablePeriod.input.kind': 'PERIOD',
  'assignTimetableEntry.input.days': ['MONDAY'],
  'clearTimetableEntry.input.dayOfWeek': 'MONDAY',
  'createEnquiry.input.parentPhone': '9876543210',
  // The student id is read only when a relationship comes with it.
  'createGuardian.input.relationship': 'FATHER',
  'createGroup.input.membershipType': 'STATIC',
  'createTimetable.input.dayStartTime': '08:00',
  'createTimetable.input.effectiveFrom': '2030-04-01',
  'createTimetable.input.effectiveTo': '2031-03-31',
  'createTimetable.input.extraClass': [],
  'createTimetable.input.lunch': [],
  'createTimetable.input.workingDays': ['MONDAY'],
  'createTimetableDayOverride.input.overrideType': 'CANCELLATION',
  'resellerCreateInstituteRequest.input.firstAdmin.email': 'two-institute-scan@roviq.test',
  'resellerCreateInstituteRequest.input.slug': 'two-institute-scan',
  'resellerInviteTeamMember.input.email': 'two-institute-scan@roviq.test',
  'updateRolePrimaryNav.input.slugs': ['dashboard'],
};

/** A value for any other required argument, by scalar type. */
const VALUE_BY_TYPE: Record<string, unknown> = {
  BigInt: '100',
  I18nText: { en: 'Two institute' },
  JSON: {},
  String: 'Two institute',
};

export const MUTATION_ARGUMENT_TABLES: ArgumentTables<Kind> = {
  kindByName: { ...ARGUMENT_TABLES.kindByName, ...KIND_BY_NAME },
  kindByPath: KIND_BY_PATH,
  valueByPath: VALUE_BY_PATH,
  valueByType: VALUE_BY_TYPE,
  everyIdNeedsKind: true,
  sendEveryOptionalId: true,
};

/**
 * Mutations with an id argument that the spec does not call, each with the reason. A mutation
 * that takes an id and is neither callable from the schema nor listed here fails the spec.
 */
export const MUTATIONS_NOT_CALLED: Readonly<Record<string, string>> = {};

/**
 * Mutations that every caller here is refused as invalid input, so no id was looked at, each
 * with the reason. A mutation that is refused this way and is not listed fails the spec: give
 * it a value in `VALUE_BY_PATH` that passes validation.
 */
export const MUTATIONS_REFUSED_AS_INVALID: Readonly<Record<string, string>> = {};

/**
 * Mutations whose check does not pass yet. Each is run and must still fail: when one starts
 * passing, the spec fails until its name is removed from this list.
 */
export const MUTATIONS_EXPECTED_TO_FAIL: readonly string[] = [];

/**
 * Tables left out of the before-and-after row comparison, each with the reason. Every other
 * table that belongs to an institute, a reseller or a person is compared.
 */
export const TABLES_NOT_COMPARED: Readonly<Record<string, string>> = {
  audit_logs: 'a refused call is recorded there, some time after the call',
};
