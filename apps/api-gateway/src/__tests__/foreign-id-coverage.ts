// Registry for `foreign-id-coverage.spec.ts` (ROV-293): every institute-scope and reseller-scope
// GraphQL operation that takes an id, and the spec that sends it another institute's or
// reseller's real id and asserts the refusal. A scope guard is not tenant isolation
// (`docs/auth.md`): the proof for an operation is that test.

export type ForeignIdCoverage =
  /** Repo-relative path of the spec holding the foreign-id test. It must name the operation. */
  | { spec: string }
  /** No id of the operation can name a row of another institute or reseller; say why. */
  | { exempt: string }
  /** Not covered yet. The count may only go down: `PENDING_COUNT` in the spec. */
  | { pending: true };

const PENDING: ForeignIdCoverage = { pending: true };

export const FOREIGN_ID_COVERAGE: Readonly<Record<string, ForeignIdCoverage>> = {
  // apps/api-gateway/src/institute/academic-year
  academicYear: PENDING,
  academicYearRolloverPreview: PENDING,
  activateAcademicYear: PENDING,
  archiveAcademicYear: PENDING,
  deleteAcademicYear: PENDING,
  updateAcademicYear: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/admission
  addApplicationDocument: PENDING,
  approveApplication: PENDING,
  convertEnquiryToApplication: PENDING,
  createApplication: PENDING,
  createEnquiry: PENDING,
  getApplication: PENDING,
  listApplicationDocuments: PENDING,
  listApplications: PENDING,
  listEnquiries: PENDING,
  rejectApplication: PENDING,
  removeApplicationDocument: PENDING,
  updateApplication: PENDING,
  updateEnquiry: PENDING,
  // apps/api-gateway/src/institute/attendance
  attendanceAbsenteesReport: PENDING,
  attendanceCounts: PENDING,
  attendanceCountsForDate: PENDING,
  attendanceEntries: PENDING,
  attendanceSectionDailyBreakdown: PENDING,
  attendanceSections: PENDING,
  attendanceSession: PENDING,
  attendanceSessionsForSection: PENDING,
  attendanceStudentHistory: PENDING,
  bulkMarkAttendance: PENDING,
  deleteAttendanceSession: PENDING,
  markAttendance: PENDING,
  openAttendanceSession: PENDING,
  overrideAttendanceSession: PENDING,
  // apps/api-gateway/src/institute/audit
  auditLogs: {
    spec: 'apps/api-gateway/src/audit/__tests__/audit-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/bot
  deleteBot: {
    spec: 'apps/api-gateway/src/institute/bot/__tests__/bot-api-key.integration.spec.ts',
  },
  rotateBotApiKey: PENDING,
  updateBot: PENDING,
  // apps/api-gateway/src/institute/certificate
  approveTC: PENDING,
  exportComplianceReport: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/compliance-export.integration.spec.ts',
  },
  generateCertificatePdf: PENDING,
  generateTCPdf: PENDING,
  getCertificate: PENDING,
  getCertificateTemplateFields: PENDING,
  getTCDetails: PENDING,
  issueCertificate: PENDING,
  issueTC: PENDING,
  listCertificates: PENDING,
  listTCs: PENDING,
  previewCertificate: PENDING,
  rejectTC: PENDING,
  requestCertificate: PENDING,
  requestDuplicateTC: PENDING,
  requestTC: PENDING,
  // apps/api-gateway/src/institute/consent
  consentStatusForStudent: PENDING,
  grantConsent: PENDING,
  withdrawConsent: PENDING,
  // apps/api-gateway/src/institute/examination
  addExamSchedule: PENDING,
  archiveExam: PENDING,
  createCoScholasticArea: PENDING,
  createExam: PENDING,
  createExamTerm: PENDING,
  createReportCard: PENDING,
  createSubjectTopic: PENDING,
  deleteCoScholasticArea: PENDING,
  deleteExam: PENDING,
  deleteExamTerm: PENDING,
  deleteGradingScheme: PENDING,
  deleteReportCard: PENDING,
  deleteSubjectTopic: PENDING,
  enterCoScholasticAssessments: PENDING,
  enterExamMarks: PENDING,
  enterTopicAssessments: PENDING,
  exam: PENDING,
  examDatesheet: PENDING,
  examDatesheetPdf: PENDING,
  examMarksSheet: PENDING,
  examResults: PENDING,
  examsList: PENDING,
  examTerms: PENDING,
  generateReportCards: PENDING,
  gradingScheme: PENDING,
  lockExam: PENDING,
  openExamMarksEntry: PENDING,
  publishExamResults: PENDING,
  publishReportCards: PENDING,
  removeExamSchedule: PENDING,
  replaceGradeBands: PENDING,
  reportCard: PENDING,
  reportCardInstance: PENDING,
  reportCardInstances: PENDING,
  reportCardPdf: PENDING,
  reportCards: PENDING,
  restoreExam: PENDING,
  scheduleExam: PENDING,
  subjectTopics: PENDING,
  unarchiveExam: PENDING,
  updateExam: PENDING,
  updateExamSchedule: PENDING,
  updateExamTerm: PENDING,
  updateGradingScheme: PENDING,
  updateReportCard: PENDING,
  // apps/api-gateway/src/institute/file
  fileDownloadUrl: {
    spec: 'apps/api-gateway/src/files/__tests__/files-foreign-id.integration.spec.ts',
  },
  requestFileUpload: {
    spec: 'apps/api-gateway/src/files/__tests__/files-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/group
  createGroup: PENDING,
  deleteGroup: PENDING,
  getGroup: PENDING,
  listGroupMembers: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-crud.integration.spec.ts',
  },
  resolveGroupMembers: PENDING,
  setGroupMemberExcluded: PENDING,
  updateGroup: PENDING,
  // apps/api-gateway/src/institute/guardian
  createGuardian: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-create-foreign-id.integration.spec.ts',
  },
  deleteGuardian: PENDING,
  getGuardian: PENDING,
  linkGuardianToStudent: PENDING,
  listLinkedStudents: PENDING,
  listStudentGuardians: PENDING,
  resendGuardianSignInDetails: {
    spec: 'apps/api-gateway/src/institute/sign-in-details/__tests__/sign-in-details.integration.spec.ts',
  },
  restoreGuardian: PENDING,
  revokeGuardianAccess: PENDING,
  unlinkGuardianFromStudent: PENDING,
  updateGuardian: PENDING,
  // apps/api-gateway/src/institute/holiday
  deleteHoliday: PENDING,
  holiday: PENDING,
  updateHoliday: PENDING,
  // apps/api-gateway/src/institute/leave
  applyLeave: PENDING,
  approveLeave: PENDING,
  cancelLeave: PENDING,
  deleteLeave: PENDING,
  leave: PENDING,
  leaves: PENDING,
  rejectLeave: PENDING,
  updateLeave: PENDING,
  // apps/api-gateway/src/institute/management
  updateInstituteBranding: {
    spec: 'apps/api-gateway/src/institute/management/__tests__/institute-branding-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/profile-photo
  setGuardianPhoto: PENDING,
  setMyProfilePhoto: {
    spec: 'apps/api-gateway/src/institute/profile-photo/__tests__/profile-photo-foreign-id.integration.spec.ts',
  },
  setStaffPhoto: PENDING,
  setStudentPhoto: PENDING,
  // apps/api-gateway/src/institute/role
  updateRolePrimaryNav: PENDING,
  // apps/api-gateway/src/institute/section
  assignClassTeacher: PENDING,
  createSection: PENDING,
  deleteSection: PENDING,
  section: PENDING,
  sections: PENDING,
  sectionsByAcademicYear: PENDING,
  updateSection: PENDING,
  // apps/api-gateway/src/institute/staff
  createStaffQualification: PENDING,
  deleteStaffMember: PENDING,
  deleteStaffQualification: PENDING,
  getStaffMember: PENDING,
  listStaffQualifications: PENDING,
  resendStaffSignInDetails: {
    spec: 'apps/api-gateway/src/institute/sign-in-details/__tests__/sign-in-details.integration.spec.ts',
  },
  restoreStaffMember: PENDING,
  updateStaffMember: PENDING,
  updateStaffQualification: PENDING,
  // apps/api-gateway/src/institute/standard
  createStandard: PENDING,
  deleteStandard: PENDING,
  standard: PENDING,
  standards: PENDING,
  updateStandard: PENDING,
  // apps/api-gateway/src/institute/student
  bulkCreateStudents: PENDING,
  changeStudentClass: PENDING,
  createStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-create-foreign-id.integration.spec.ts',
  },
  deleteStudent: PENDING,
  deleteStudentDocument: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-document-removal.integration.spec.ts',
  },
  enrollStudent: PENDING,
  getStudent: PENDING,
  listStudentAcademics: PENDING,
  listStudentDocuments: PENDING,
  listStudents: PENDING,
  removeStudentFromYear: PENDING,
  restoreStudent: PENDING,
  setPromotionDecisions: PENDING,
  transitionStudentStatus: PENDING,
  updateStudent: PENDING,
  updateStudentSection: PENDING,
  uploadStudentDocument: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-document-upload.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/subject
  assignSubjectToSection: PENDING,
  assignSubjectToStandard: PENDING,
  createSubject: PENDING,
  deleteSubject: PENDING,
  removeSubjectFromSection: PENDING,
  removeSubjectFromStandard: PENDING,
  subject: PENDING,
  subjectsByAcademicYear: PENDING,
  subjectsByStandard: PENDING,
  updateSubject: PENDING,
  // apps/api-gateway/src/institute/timetable
  activateTimetable: PENDING,
  addTimetablePeriod: PENDING,
  addTimetableSection: PENDING,
  archiveTimetable: PENDING,
  assignTimetableEntry: PENDING,
  clearTimetableDayOverride: PENDING,
  clearTimetableEntry: PENDING,
  createTimetable: PENDING,
  createTimetableDayOverride: PENDING,
  deactivateTimetable: PENDING,
  deleteTimetable: PENDING,
  removeTimetablePeriod: PENDING,
  removeTimetableSection: PENDING,
  restoreTimetable: PENDING,
  sectionTimetable: PENDING,
  sectionTimetablePdf: PENDING,
  staffDaySchedule: PENDING,
  staffTimetable: PENDING,
  staffTimetablePdf: PENDING,
  timetable: PENDING,
  timetableDayOverrides: PENDING,
  timetableDaySchedule: PENDING,
  timetables: PENDING,
  timetableStatistics: PENDING,
  updateTimetable: PENDING,
  updateTimetablePeriod: PENDING,
  // apps/api-gateway/src/notification-inbox
  acknowledgeNotificationDelivery: {
    spec: 'apps/api-gateway/src/notification-inbox/__tests__/notification-inbox.integration.spec.ts',
  },
  archiveNotification: {
    spec: 'apps/api-gateway/src/notification-inbox/__tests__/notification-inbox.integration.spec.ts',
  },
  markNotificationRead: {
    spec: 'apps/api-gateway/src/notification-inbox/__tests__/notification-inbox.integration.spec.ts',
  },
  // apps/api-gateway/src/reseller/audit
  resellerAuditLogs: {
    spec: 'apps/api-gateway/src/audit/__tests__/audit-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/reseller/file
  resellerRequestFileUpload: {
    spec: 'apps/api-gateway/src/files/__tests__/files-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/reseller/institute
  resellerGetInstitute: PENDING,
  resellerReactivateInstitute: {
    spec: 'apps/api-gateway/src/reseller/institute/__tests__/reseller-institute-foreign-id.integration.spec.ts',
  },
  resellerSuspendInstitute: {
    spec: 'apps/api-gateway/src/reseller/institute/__tests__/reseller-institute-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/reseller/institute-group
  resellerAddInstituteToGroup: PENDING,
  resellerRemoveInstituteFromGroup: PENDING,
  // apps/api-gateway/src/reseller/settings
  resellerUpdateBranding: PENDING,
  // apps/api-gateway/src/reseller/team
  resellerChangeTeamMemberRole: {
    spec: 'apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts',
  },
  resellerDeactivateTeamMember: {
    spec: 'apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts',
  },
  resellerGetTeamMember: {
    spec: 'apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts',
  },
  resellerInviteTeamMember: {
    spec: 'apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts',
  },
  resellerReactivateTeamMember: {
    spec: 'apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts',
  },
  // ee/apps/api-gateway/src/billing/institute
  generateInvoicePdf: PENDING,
  initiatePayment: { spec: 'apps/api-gateway/src/__tests__/billing.integration.spec.ts' },
  myInvoice: PENDING,
  submitUpiProof: PENDING,
  // ee/apps/api-gateway/src/billing/reseller
  archivePlan: PENDING,
  cancelSubscription: PENDING,
  changePlan: PENDING,
  deleteGatewayConfig: PENDING,
  deletePlan: PENDING,
  generateInvoice: PENDING,
  invoicePayments: PENDING,
  invoices: PENDING,
  issueRefund: PENDING,
  pauseSubscription: PENDING,
  recordManualPayment: PENDING,
  rejectUpiPayment: PENDING,
  restorePlan: PENDING,
  resumeSubscription: PENDING,
  subscriptionPlan: PENDING,
  updateGatewayConfig: PENDING,
  updateSubscriptionPlan: PENDING,
  verifyUpiPayment: PENDING,
};
