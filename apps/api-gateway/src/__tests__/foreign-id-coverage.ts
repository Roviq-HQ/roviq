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
  academicYear: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  academicYearRolloverPreview: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  activateAcademicYear: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  archiveAcademicYear: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  deleteAcademicYear: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  setRolloverSectionMap: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/rollover-section-map.integration.spec.ts',
  },
  updateAcademicYear: {
    spec: 'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/admission
  addApplicationDocument: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  approveApplication: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  convertEnquiryToApplication: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  createApplication: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  createEnquiry: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  getApplication: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  listApplicationDocuments: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  listApplications: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  listEnquiries: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  rejectApplication: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  removeApplicationDocument: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  updateApplication: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  updateEnquiry: {
    spec: 'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/attendance
  attendanceAbsenteesReport: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceCounts: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceCountsForDate: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceEntries: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceSectionDailyBreakdown: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceSections: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceSession: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceSessionsForSection: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  attendanceStudentHistory: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  bulkMarkAttendance: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  deleteAttendanceSession: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  markAttendance: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  openAttendanceSession: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  overrideAttendanceSession: {
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/audit
  auditLogs: {
    spec: 'apps/api-gateway/src/audit/__tests__/audit-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/bot
  deleteBot: {
    spec: 'apps/api-gateway/src/institute/bot/__tests__/bot-api-key.integration.spec.ts',
  },
  rotateBotApiKey: {
    spec: 'apps/api-gateway/src/institute/bot/__tests__/bot-api-key.integration.spec.ts',
  },
  updateBot: {
    spec: 'apps/api-gateway/src/institute/bot/__tests__/bot-api-key.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/certificate
  approveTC: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  exportComplianceReport: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/compliance-export.integration.spec.ts',
  },
  generateCertificatePdf: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  generateTCPdf: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  getCertificate: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  getCertificateTemplateFields: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  getTCDetails: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  issueCertificate: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  issueTC: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  listCertificates: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  listTCs: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  previewCertificate: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  rejectTC: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  requestCertificate: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  requestDuplicateTC: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  requestTC: {
    spec: 'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/consent
  consentStatusForStudent: {
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
  grantConsent: {
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
  withdrawConsent: {
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
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
  createGroup: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  },
  deleteGroup: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  },
  getGroup: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  },
  listGroupMembers: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-crud.integration.spec.ts',
  },
  resolveGroupMembers: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  },
  setGroupMemberExcluded: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  },
  updateGroup: {
    spec: 'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/guardian
  createGuardian: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-create-foreign-id.integration.spec.ts',
  },
  deleteGuardian: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  getGuardian: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  linkGuardianToStudent: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  listLinkedStudents: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  listStudentGuardians: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  resendGuardianSignInDetails: {
    spec: 'apps/api-gateway/src/institute/sign-in-details/__tests__/sign-in-details.integration.spec.ts',
  },
  restoreGuardian: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  revokeGuardianAccess: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  unlinkGuardianFromStudent: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  updateGuardian: {
    spec: 'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/holiday
  deleteHoliday: {
    spec: 'apps/api-gateway/src/institute/holiday/__tests__/holiday-foreign-id.integration.spec.ts',
  },
  holiday: {
    spec: 'apps/api-gateway/src/institute/holiday/__tests__/holiday-foreign-id.integration.spec.ts',
  },
  updateHoliday: {
    spec: 'apps/api-gateway/src/institute/holiday/__tests__/holiday-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/leave
  applyLeave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  approveLeave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  cancelLeave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  deleteLeave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  leave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  leaves: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  rejectLeave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  updateLeave: {
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/management
  updateInstituteBranding: {
    spec: 'apps/api-gateway/src/institute/management/__tests__/institute-branding-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/notification-delivery
  notificationDeliveryLog: {
    spec: 'apps/api-gateway/src/institute/notification-delivery/__tests__/notification-delivery-log.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/profile-photo
  setGuardianPhoto: {
    spec: 'apps/api-gateway/src/institute/profile-photo/__tests__/profile-photo-foreign-id.integration.spec.ts',
  },
  setMyProfilePhoto: {
    spec: 'apps/api-gateway/src/institute/profile-photo/__tests__/profile-photo-foreign-id.integration.spec.ts',
  },
  setStaffPhoto: {
    spec: 'apps/api-gateway/src/institute/profile-photo/__tests__/profile-photo-foreign-id.integration.spec.ts',
  },
  setStudentPhoto: {
    spec: 'apps/api-gateway/src/institute/profile-photo/__tests__/profile-photo-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/role
  updateRolePrimaryNav: {
    spec: 'apps/api-gateway/src/institute/role/__tests__/role.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/section
  assignClassTeacher: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  createSection: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  deleteSection: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  section: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  sections: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  sectionsByAcademicYear: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  updateSection: {
    spec: 'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/staff
  createStaffQualification: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  deleteStaffMember: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  deleteStaffQualification: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  getStaffMember: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  listStaffQualifications: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  resendStaffSignInDetails: {
    spec: 'apps/api-gateway/src/institute/sign-in-details/__tests__/sign-in-details.integration.spec.ts',
  },
  restoreStaffMember: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  updateStaffMember: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  updateStaffQualification: {
    spec: 'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/standard
  createStandard: {
    spec: 'apps/api-gateway/src/institute/standard/__tests__/standard-foreign-id.integration.spec.ts',
  },
  deleteStandard: {
    spec: 'apps/api-gateway/src/institute/standard/__tests__/standard-foreign-id.integration.spec.ts',
  },
  standard: {
    spec: 'apps/api-gateway/src/institute/standard/__tests__/standard-foreign-id.integration.spec.ts',
  },
  standards: {
    spec: 'apps/api-gateway/src/institute/standard/__tests__/standard-foreign-id.integration.spec.ts',
  },
  updateStandard: {
    spec: 'apps/api-gateway/src/institute/standard/__tests__/standard-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/student
  bulkCreateStudents: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  changeStudentClass: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  createStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-create-foreign-id.integration.spec.ts',
  },
  deleteStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  deleteStudentDocument: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-document-removal.integration.spec.ts',
  },
  enrollStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  getStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  listStudentAcademics: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  listStudentDocuments: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  listStudents: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  removeStudentFromYear: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  restoreStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  setPromotionDecisions: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  transitionStudentStatus: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  updateStudent: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  updateStudentSection: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  },
  uploadStudentDocument: {
    spec: 'apps/api-gateway/src/institute/student/__tests__/student-document-upload.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/subject
  assignSubjectToSection: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  assignSubjectToStandard: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  createSubject: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  deleteSubject: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  removeSubjectFromSection: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  removeSubjectFromStandard: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  subject: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  subjectsByAcademicYear: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  subjectsByStandard: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  updateSubject: {
    spec: 'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/timetable
  activateTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  addTimetablePeriod: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  addTimetableSection: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  archiveTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  assignTimetableEntry: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  clearTimetableDayOverride: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  clearTimetableEntry: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  createTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  createTimetableDayOverride: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  deactivateTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  deleteTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  removeTimetablePeriod: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  removeTimetableSection: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  restoreTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  sectionTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  sectionTimetablePdf: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  staffDaySchedule: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  staffTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  staffTimetablePdf: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  timetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  timetableDayOverrides: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  timetableDaySchedule: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  timetables: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  timetableStatistics: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  updateTimetable: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
  updateTimetablePeriod: {
    spec: 'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  },
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
