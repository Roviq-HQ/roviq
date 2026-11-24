/**
 * Types for StudentAdmissionWorkflow (ROV-159).
 *
 * Temporal workflow that converts an approved admission application
 * into a fully enrolled student — creating user, membership, profiles,
 * academics, and linking guardians.
 */

/** Task queue of StudentAdmissionWorkflow; AdmissionService starts it here and the worker polls it. */
export const STUDENT_ADMISSION_TASK_QUEUE = 'student-admission';

export interface StudentAdmissionInput {
  applicationId: string;
  tenantId: string;
  /** User who approved the application — recorded as created_by/updated_by on every row the workflow writes. */
  actorId: string;
}

export interface StudentAdmissionResult {
  studentProfileId: string;
  admissionNumber: string;
  membershipId: string;
}

/**
 * JSON-safe projection of the `admission_applications` row that crosses
 * the Temporal activity boundary. Only includes the fields the workflow
 * actually reads. Explicit types (instead of `Record<string, unknown>`)
 * let the compiler verify that `loadApplicationData` returns the exact
 * shape `StudentAdmissionWorkflow` destructures — no casts needed.
 *
 * All fields use JSON-primitives (`string`, `boolean`, `null`) so Temporal's
 * JSON serialiser round-trips them faithfully without custom codecs.
 */
export interface ApplicationPayload {
  id: string;
  enquiryId: string | null;
  academicYearId: string;
  standardId: string;
  sectionId: string | null;
  formData: Record<string, unknown>;
  status: string;
  isRteApplication: boolean;
  studentProfileId: string | null;
}

/**
 * JSON-safe projection of the `enquiries` row. Returned alongside the
 * application for callers that need enquiry context; the workflow itself
 * does not currently read it, but the type is explicit to avoid future
 * widening-via-cast.
 */
export interface EnquiryPayload {
  id: string;
  parentPhone: string | null;
  parentName: string | null;
  source: string | null;
}

export interface StudentAdmissionActivities {
  loadApplicationData(
    applicationId: string,
    tenantId: string,
  ): Promise<{
    application: ApplicationPayload;
    enquiry: EnquiryPayload | null;
  }>;

  validateSectionCapacity(tenantId: string, sectionId: string): Promise<void>;

  /**
   * The student account (found again by the application's placeholder email on a retry), then
   * membership, the institute's profile copy, student profile with admission number and, with a
   * section, the enrolment, all in one transaction. A failure leaves no institute row and no
   * account; a retry after a committed attempt returns that attempt's student.
   */
  admitStudent(input: {
    tenantId: string;
    actorId: string;
    /** The application id: seeds the placeholder email and username. */
    seed: string;
    academicYearId: string;
    standardId: string;
    sectionId: string | null;
    formData: Record<string, unknown>;
    isRte: boolean;
  }): Promise<{
    userId: string;
    membershipId: string;
    studentProfileId: string;
    admissionNumber: string;
  }>;

  linkGuardians(
    tenantId: string,
    studentProfileId: string,
    formData: Record<string, unknown>,
    createdBy: string,
    /** Stable per-application seed used for deterministic placeholder
     *  guardian email/username when the parent has no phone match. */
    seed: string,
  ): Promise<void>;

  updateApplicationEnrolled(
    applicationId: string,
    tenantId: string,
    studentProfileId: string,
    updatedBy: string,
  ): Promise<void>;

  emitStudentAdmittedEvent(
    tenantId: string,
    studentProfileId: string,
    membershipId: string,
    standardId: string,
    sectionId: string,
  ): Promise<void>;

  applyPreviousSchoolData(
    tenantId: string,
    studentProfileId: string,
    formData: Record<string, unknown>,
    updatedBy: string,
  ): Promise<void>;
}
