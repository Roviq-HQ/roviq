// Registry for `row-scope-coverage.spec.ts` (ROV-376): every operation declared
// `@CheckAbility({ ..., rows: 'scoped' })`, how it applies the caller's row conditions, and the
// spec in which a role with a conditional rule is allowed a row inside its condition and refused
// one outside it. The guard refuses a conditional rule on an operation without the declaration
// (`docs/auth.md`), so the declaration is a promise: this registry names its proof.

export type RowScopeHow =
  /** A SQL predicate from `caslToSqlWhere` in the query. */
  | 'predicate'
  /** `ability.can(action, subject(type, row))` on the row before it is used. */
  | 'row-check'
  /** A subscription: each event is passed only when the caller may read its row. */
  | 'event-filter'
  /** The rows are found from the caller's own token (the membership), never from an argument alone. */
  | 'token';

export interface RowScopeCoverage {
  how: RowScopeHow;
  /** Repo-relative path of the spec. It must name the operation. */
  spec: string;
}

export const ROW_SCOPE_COVERAGE: Readonly<Record<string, RowScopeCoverage>> = {
  // apps/api-gateway/src/institute/admission
  admissionStatistics: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  applicationStatusChanged: {
    how: 'event-filter',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  enquiryCreated: {
    how: 'event-filter',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  getApplication: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listApplicationDocuments: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listApplications: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listEnquiries: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/attendance
  attendanceAbsenteesReport: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceCounts: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceCountsForDate: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceEntries: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceSectionDailyBreakdown: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceSections: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceSession: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceSessionsForSection: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  attendanceStudentHistory: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  bulkMarkAttendance: {
    how: 'row-check',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  deleteAttendanceSession: {
    how: 'row-check',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  markAttendance: {
    how: 'row-check',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  openAttendanceSession: {
    how: 'row-check',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  overrideAttendanceSession: {
    how: 'row-check',
    spec: 'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/consent
  consentStatusForStudent: {
    how: 'row-check',
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
  grantConsent: {
    how: 'token',
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
  myConsentStatus: {
    how: 'token',
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
  withdrawConsent: {
    how: 'token',
    spec: 'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/examination
  myReportCards: {
    how: 'token',
    spec: 'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  },
  reportCard: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  },
  reportCardInstance: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  },
  reportCardInstances: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  },
  reportCardPdf: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  },
  reportCards: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/guardian
  getGuardian: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listGuardians: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listLinkedStudents: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listStudentGuardians: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/leave
  applyLeave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  approveLeave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  cancelLeave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  deleteLeave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  leave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  leaves: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  rejectLeave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  updateLeave: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  },
  // apps/api-gateway/src/institute/student
  getStudent: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listStudentAcademics: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listStudentDocuments: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  listStudents: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  studentStatistics: {
    how: 'predicate',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  studentUpdated: {
    how: 'event-filter',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
  studentsInTenantUpdated: {
    how: 'event-filter',
    spec: 'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  },
};

/**
 * Institute-scope operations on a pair that a default role holds only with a row condition,
 * and that deliberately declare no row scoping, each with the reason. The guard refuses such a
 * role there; an entry says that the refusal is intended.
 */
export const ROW_SCOPE_UNDECLARED: Readonly<Record<string, string>> = {};
