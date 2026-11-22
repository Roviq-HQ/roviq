// Live views — `<table>_live` hides trashed rows. Always declare via
// `liveView()` so RLS runs as the calling role, not the view owner.

import { isNull } from 'drizzle-orm';
import { pgView } from 'drizzle-orm/pg-core';

import { admissionApplications } from './admission/admission-applications';
import { applicationDocumentFiles } from './admission/application-document-files';
import { applicationDocuments } from './admission/application-documents';
import { certificateTemplates } from './admission/certificate-templates';
import { enquiries } from './admission/enquiries';
import { issuedCertificates } from './admission/issued-certificates';
import { tcRegister } from './admission/tc-register';
import { authProviders } from './auth/auth-providers';
import { phoneNumbers } from './auth/phone-numbers';
import { platformMemberships } from './auth/platform-memberships';
import { refreshTokens } from './auth/refresh-tokens';
import { users } from './auth/users';
import { groupChildren } from './groups/group-children';
import { groupMembers } from './groups/group-members';
import { groupRules } from './groups/group-rules';
import { groups } from './groups/groups';
import { deviceTokens } from './notification/device-tokens';
import { instituteNotificationConfigs } from './notification/notification-configs';
import { notifications } from './notification/notifications';
import { resellerMemberships } from './reseller/reseller-memberships';
import { resellers } from './reseller/resellers';
import { files } from './storage/files';
import { academicYears } from './tenant/academic-years';
import { attendanceEntries } from './tenant/attendance/attendance-entries';
import { attendanceSessions } from './tenant/attendance/attendance-sessions';
import { coScholasticAreas } from './tenant/examination/co-scholastic-areas';
import { coScholasticAssessments } from './tenant/examination/co-scholastic-assessments';
import { examMarks } from './tenant/examination/exam-marks';
import { examSchedules } from './tenant/examination/exam-schedules';
import { examTerms } from './tenant/examination/exam-terms';
import { examTopicAssessments } from './tenant/examination/exam-topic-assessments';
import { exams } from './tenant/examination/exams';
import { gradeBands } from './tenant/examination/grade-bands';
import { gradingSchemes } from './tenant/examination/grading-schemes';
import { reportCardInstances } from './tenant/examination/report-card-instances';
import { reportCards } from './tenant/examination/report-cards';
import { subjectTopics } from './tenant/examination/subject-topics';
import { exportReports } from './tenant/export-reports';
import { groupMemberships } from './tenant/group-memberships';
import { holidays } from './tenant/holidays';
import { instituteAffiliations } from './tenant/institute-affiliations';
import { instituteBranding } from './tenant/institute-branding';
import { instituteConfigs } from './tenant/institute-configs';
import { instituteGroupBranding } from './tenant/institute-group-branding';
import { instituteGroups } from './tenant/institute-groups';
import { instituteIdentifiers } from './tenant/institute-identifiers';
import { institutes } from './tenant/institutes';
import { leaveFiles } from './tenant/leave-files';
import { leaves } from './tenant/leaves';
import { memberships } from './tenant/memberships';
import { roles } from './tenant/roles';
import { sectionSubjects } from './tenant/section-subjects';
import { sections } from './tenant/sections';
import { standardSubjects } from './tenant/standard-subjects';
import { standards } from './tenant/standards';
import { subjects } from './tenant/subjects';
import { timetableDayOverrides } from './tenant/timetable/timetable-day-overrides';
import { timetableEntries } from './tenant/timetable/timetable-entries';
import { timetablePeriods } from './tenant/timetable/timetable-periods';
import { timetableSections } from './tenant/timetable/timetable-sections';
import { timetables } from './tenant/timetable/timetables';
import { botProfiles } from './user-profiles/bot-profiles';
import { guardianProfiles } from './user-profiles/guardian-profiles';
import { privacyNotices } from './user-profiles/privacy-notices';
import { staffProfiles } from './user-profiles/staff-profiles';
import { staffQualifications } from './user-profiles/staff-qualifications';
import { studentAcademics } from './user-profiles/student-academics';
import { studentGuardianLinks } from './user-profiles/student-guardian-links';
import { studentProfiles } from './user-profiles/student-profiles';
import { tenantUserProfiles } from './user-profiles/tenant-user-profiles';
import { userAddresses } from './user-profiles/user-addresses';
import { userDocumentFiles } from './user-profiles/user-document-files';
import { userDocuments } from './user-profiles/user-documents';
import { userIdentifiers } from './user-profiles/user-identifiers';
import { userProfiles } from './user-profiles/user-profiles';

export const liveView = <T extends string>(name: T) => pgView(name).with({ securityInvoker: true });

// Tenant root + group-branding entity.
export const institutesLive = liveView('institutes_live').as((qb) =>
  qb.select().from(institutes).where(isNull(institutes.deletedAt)),
);
export const instituteGroupsLive = liveView('institute_groups_live').as((qb) =>
  qb.select().from(instituteGroups).where(isNull(instituteGroups.deletedAt)),
);
export const instituteGroupBrandingLive = liveView('institute_group_branding_live').as((qb) =>
  qb.select().from(instituteGroupBranding).where(isNull(instituteGroupBranding.deletedAt)),
);

// Reseller (platform-level entity with soft delete).
export const resellersLive = liveView('resellers_live').as((qb) =>
  qb.select().from(resellers).where(isNull(resellers.deletedAt)),
);

// Notification.
export const instituteNotificationConfigsLive = liveView('institute_notification_configs_live').as(
  (qb) =>
    qb
      .select()
      .from(instituteNotificationConfigs)
      .where(isNull(instituteNotificationConfigs.deletedAt)),
);
export const notificationsLive = liveView('notifications_live').as((qb) =>
  qb.select().from(notifications).where(isNull(notifications.deletedAt)),
);
export const deviceTokensLive = liveView('device_tokens_live').as((qb) =>
  qb.select().from(deviceTokens).where(isNull(deviceTokens.deletedAt)),
);

// Tenant business tables.
export const academicYearsLive = liveView('academic_years_live').as((qb) =>
  qb.select().from(academicYears).where(isNull(academicYears.deletedAt)),
);
export const attendanceEntriesLive = liveView('attendance_entries_live').as((qb) =>
  qb.select().from(attendanceEntries).where(isNull(attendanceEntries.deletedAt)),
);
export const attendanceSessionsLive = liveView('attendance_sessions_live').as((qb) =>
  qb.select().from(attendanceSessions).where(isNull(attendanceSessions.deletedAt)),
);
export const holidaysLive = liveView('holidays_live').as((qb) =>
  qb.select().from(holidays).where(isNull(holidays.deletedAt)),
);
export const instituteAffiliationsLive = liveView('institute_affiliations_live').as((qb) =>
  qb.select().from(instituteAffiliations).where(isNull(instituteAffiliations.deletedAt)),
);
export const instituteBrandingLive = liveView('institute_branding_live').as((qb) =>
  qb.select().from(instituteBranding).where(isNull(instituteBranding.deletedAt)),
);
export const instituteConfigsLive = liveView('institute_configs_live').as((qb) =>
  qb.select().from(instituteConfigs).where(isNull(instituteConfigs.deletedAt)),
);
export const instituteIdentifiersLive = liveView('institute_identifiers_live').as((qb) =>
  qb.select().from(instituteIdentifiers).where(isNull(instituteIdentifiers.deletedAt)),
);
export const filesLive = liveView('files_live').as((qb) =>
  qb.select().from(files).where(isNull(files.deletedAt)),
);
export const exportReportsLive = liveView('export_reports_live').as((qb) =>
  qb.select().from(exportReports).where(isNull(exportReports.deletedAt)),
);
export const leaveFilesLive = liveView('leave_files_live').as((qb) =>
  qb.select().from(leaveFiles).where(isNull(leaveFiles.deletedAt)),
);
export const leavesLive = liveView('leaves_live').as((qb) =>
  qb.select().from(leaves).where(isNull(leaves.deletedAt)),
);
export const membershipsLive = liveView('memberships_live').as((qb) =>
  qb.select().from(memberships).where(isNull(memberships.deletedAt)),
);
export const rolesLive = liveView('roles_live').as((qb) =>
  qb.select().from(roles).where(isNull(roles.deletedAt)),
);
export const sectionsLive = liveView('sections_live').as((qb) =>
  qb.select().from(sections).where(isNull(sections.deletedAt)),
);
export const sectionSubjectsLive = liveView('section_subjects_live').as((qb) =>
  qb.select().from(sectionSubjects).where(isNull(sectionSubjects.deletedAt)),
);
export const standardsLive = liveView('standards_live').as((qb) =>
  qb.select().from(standards).where(isNull(standards.deletedAt)),
);
export const standardSubjectsLive = liveView('standard_subjects_live').as((qb) =>
  qb.select().from(standardSubjects).where(isNull(standardSubjects.deletedAt)),
);
export const subjectsLive = liveView('subjects_live').as((qb) =>
  qb.select().from(subjects).where(isNull(subjects.deletedAt)),
);

// Timetable domain.
export const timetablesLive = liveView('timetables_live').as((qb) =>
  qb.select().from(timetables).where(isNull(timetables.deletedAt)),
);
export const timetableSectionsLive = liveView('timetable_sections_live').as((qb) =>
  qb.select().from(timetableSections).where(isNull(timetableSections.deletedAt)),
);
export const timetablePeriodsLive = liveView('timetable_periods_live').as((qb) =>
  qb.select().from(timetablePeriods).where(isNull(timetablePeriods.deletedAt)),
);
export const timetableEntriesLive = liveView('timetable_entries_live').as((qb) =>
  qb.select().from(timetableEntries).where(isNull(timetableEntries.deletedAt)),
);
export const timetableDayOverridesLive = liveView('timetable_day_overrides_live').as((qb) =>
  qb.select().from(timetableDayOverrides).where(isNull(timetableDayOverrides.deletedAt)),
);

// Examination & report cards.
export const gradingSchemesLive = liveView('grading_schemes_live').as((qb) =>
  qb.select().from(gradingSchemes).where(isNull(gradingSchemes.deletedAt)),
);
export const gradeBandsLive = liveView('grade_bands_live').as((qb) =>
  qb.select().from(gradeBands).where(isNull(gradeBands.deletedAt)),
);
export const examTermsLive = liveView('exam_terms_live').as((qb) =>
  qb.select().from(examTerms).where(isNull(examTerms.deletedAt)),
);
export const examsLive = liveView('exams_live').as((qb) =>
  qb.select().from(exams).where(isNull(exams.deletedAt)),
);
export const examSchedulesLive = liveView('exam_schedules_live').as((qb) =>
  qb.select().from(examSchedules).where(isNull(examSchedules.deletedAt)),
);
export const examMarksLive = liveView('exam_marks_live').as((qb) =>
  qb.select().from(examMarks).where(isNull(examMarks.deletedAt)),
);
export const subjectTopicsLive = liveView('subject_topics_live').as((qb) =>
  qb.select().from(subjectTopics).where(isNull(subjectTopics.deletedAt)),
);
export const examTopicAssessmentsLive = liveView('exam_topic_assessments_live').as((qb) =>
  qb.select().from(examTopicAssessments).where(isNull(examTopicAssessments.deletedAt)),
);
export const coScholasticAreasLive = liveView('co_scholastic_areas_live').as((qb) =>
  qb.select().from(coScholasticAreas).where(isNull(coScholasticAreas.deletedAt)),
);
export const coScholasticAssessmentsLive = liveView('co_scholastic_assessments_live').as((qb) =>
  qb.select().from(coScholasticAssessments).where(isNull(coScholasticAssessments.deletedAt)),
);
export const reportCardsLive = liveView('report_cards_live').as((qb) =>
  qb.select().from(reportCards).where(isNull(reportCards.deletedAt)),
);
export const reportCardInstancesLive = liveView('report_card_instances_live').as((qb) =>
  qb.select().from(reportCardInstances).where(isNull(reportCardInstances.deletedAt)),
);

// Admission domain.
export const admissionApplicationsLive = liveView('admission_applications_live').as((qb) =>
  qb.select().from(admissionApplications).where(isNull(admissionApplications.deletedAt)),
);
export const enquiriesLive = liveView('enquiries_live').as((qb) =>
  qb.select().from(enquiries).where(isNull(enquiries.deletedAt)),
);
export const issuedCertificatesLive = liveView('issued_certificates_live').as((qb) =>
  qb.select().from(issuedCertificates).where(isNull(issuedCertificates.deletedAt)),
);
export const tcRegisterLive = liveView('tc_register_live').as((qb) =>
  qb.select().from(tcRegister).where(isNull(tcRegister.deletedAt)),
);

// Dynamic groups.
export const groupsLive = liveView('groups_live').as((qb) =>
  qb.select().from(groups).where(isNull(groups.deletedAt)),
);

// User profiles.
export const botProfilesLive = liveView('bot_profiles_live').as((qb) =>
  qb.select().from(botProfiles).where(isNull(botProfiles.deletedAt)),
);
export const guardianProfilesLive = liveView('guardian_profiles_live').as((qb) =>
  qb.select().from(guardianProfiles).where(isNull(guardianProfiles.deletedAt)),
);
export const staffProfilesLive = liveView('staff_profiles_live').as((qb) =>
  qb.select().from(staffProfiles).where(isNull(staffProfiles.deletedAt)),
);
export const studentAcademicsLive = liveView('student_academics_live').as((qb) =>
  qb.select().from(studentAcademics).where(isNull(studentAcademics.deletedAt)),
);
export const studentProfilesLive = liveView('student_profiles_live').as((qb) =>
  qb.select().from(studentProfiles).where(isNull(studentProfiles.deletedAt)),
);

// Identity, memberships, personal data and group internals.
export const usersLive = liveView('users_live').as((qb) =>
  qb.select().from(users).where(isNull(users.deletedAt)),
);
export const refreshTokensLive = liveView('refresh_tokens_live').as((qb) =>
  qb.select().from(refreshTokens).where(isNull(refreshTokens.deletedAt)),
);
export const phoneNumbersLive = liveView('phone_numbers_live').as((qb) =>
  qb.select().from(phoneNumbers).where(isNull(phoneNumbers.deletedAt)),
);
export const authProvidersLive = liveView('auth_providers_live').as((qb) =>
  qb.select().from(authProviders).where(isNull(authProviders.deletedAt)),
);
export const platformMembershipsLive = liveView('platform_memberships_live').as((qb) =>
  qb.select().from(platformMemberships).where(isNull(platformMemberships.deletedAt)),
);
export const resellerMembershipsLive = liveView('reseller_memberships_live').as((qb) =>
  qb.select().from(resellerMemberships).where(isNull(resellerMemberships.deletedAt)),
);
export const groupMembershipsLive = liveView('group_memberships_live').as((qb) =>
  qb.select().from(groupMemberships).where(isNull(groupMemberships.deletedAt)),
);
export const userProfilesLive = liveView('user_profiles_live').as((qb) =>
  qb.select().from(userProfiles).where(isNull(userProfiles.deletedAt)),
);
export const tenantUserProfilesLive = liveView('tenant_user_profiles_live').as((qb) =>
  qb.select().from(tenantUserProfiles).where(isNull(tenantUserProfiles.deletedAt)),
);
export const userAddressesLive = liveView('user_addresses_live').as((qb) =>
  qb.select().from(userAddresses).where(isNull(userAddresses.deletedAt)),
);
export const userDocumentFilesLive = liveView('user_document_files_live').as((qb) =>
  qb.select().from(userDocumentFiles).where(isNull(userDocumentFiles.deletedAt)),
);

export const userDocumentsLive = liveView('user_documents_live').as((qb) =>
  qb.select().from(userDocuments).where(isNull(userDocuments.deletedAt)),
);
export const userIdentifiersLive = liveView('user_identifiers_live').as((qb) =>
  qb.select().from(userIdentifiers).where(isNull(userIdentifiers.deletedAt)),
);
export const studentGuardianLinksLive = liveView('student_guardian_links_live').as((qb) =>
  qb.select().from(studentGuardianLinks).where(isNull(studentGuardianLinks.deletedAt)),
);
export const staffQualificationsLive = liveView('staff_qualifications_live').as((qb) =>
  qb.select().from(staffQualifications).where(isNull(staffQualifications.deletedAt)),
);
export const privacyNoticesLive = liveView('privacy_notices_live').as((qb) =>
  qb.select().from(privacyNotices).where(isNull(privacyNotices.deletedAt)),
);
export const certificateTemplatesLive = liveView('certificate_templates_live').as((qb) =>
  qb.select().from(certificateTemplates).where(isNull(certificateTemplates.deletedAt)),
);
export const applicationDocumentsLive = liveView('application_documents_live').as((qb) =>
  qb.select().from(applicationDocuments).where(isNull(applicationDocuments.deletedAt)),
);
export const applicationDocumentFilesLive = liveView('application_document_files_live').as((qb) =>
  qb.select().from(applicationDocumentFiles).where(isNull(applicationDocumentFiles.deletedAt)),
);
export const groupRulesLive = liveView('group_rules_live').as((qb) =>
  qb.select().from(groupRules).where(isNull(groupRules.deletedAt)),
);
export const groupMembersLive = liveView('group_members_live').as((qb) =>
  qb.select().from(groupMembers).where(isNull(groupMembers.deletedAt)),
);
export const groupChildrenLive = liveView('group_children_live').as((qb) =>
  qb.select().from(groupChildren).where(isNull(groupChildren.deletedAt)),
);
