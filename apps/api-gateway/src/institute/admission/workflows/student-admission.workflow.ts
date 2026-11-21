/**
 * StudentAdmissionWorkflow (ROV-159).
 *
 * Temporal workflow: approved application → fully enrolled student.
 * 10 idempotent activity steps. Timeout: 5 minutes.
 */
import { proxyActivities } from '@temporalio/workflow';
import type {
  StudentAdmissionActivities,
  StudentAdmissionInput,
  StudentAdmissionResult,
} from './student-admission.types';

const activities = proxyActivities<StudentAdmissionActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3 },
});

export async function StudentAdmissionWorkflow(
  input: StudentAdmissionInput,
): Promise<StudentAdmissionResult> {
  const { applicationId, tenantId, actorId } = input;

  // 1. Load application + enquiry data
  const { application } = await activities.loadApplicationData(applicationId, tenantId);

  // `application` is typed as ApplicationPayload — all fields are plain
  // JSON primitives so Temporal's serialiser round-trips them correctly.
  const { formData, standardId, sectionId, academicYearId, isRteApplication: isRte } = application;

  // 2. Validate section capacity
  if (sectionId) {
    await activities.validateSectionCapacity(tenantId, sectionId);
  }

  // 3. Create the student user + membership (student role). `applicationId` seeds the
  // placeholder `admission-<id>@roviq.placeholder` so retries reuse the same user.
  const { userId, membershipId } = await activities.createUserAndMembership(
    tenantId,
    actorId,
    applicationId,
  );

  // 4. Create user_profile from form_data
  await activities.createUserProfile(userId, formData, actorId);

  // 5. Create student_profile with admission_number
  const { studentProfileId, admissionNumber } = await activities.createStudentProfile(
    tenantId,
    userId,
    membershipId,
    standardId,
    formData,
    isRte,
    actorId,
  );

  // 6. Create student_academics (section placement)
  if (sectionId) {
    await activities.createStudentAcademics(
      tenantId,
      studentProfileId,
      academicYearId,
      standardId,
      sectionId,
      actorId,
    );
  }

  // 7. Link guardians from parent info — applicationId seed keeps placeholder
  // guardian creation idempotent across retries.
  await activities.linkGuardians(tenantId, studentProfileId, formData, actorId, applicationId);

  // 8. Update application: status='enrolled', student_profile_id
  await activities.updateApplicationEnrolled(applicationId, tenantId, studentProfileId, actorId);

  // 9. Emit student.admitted
  if (sectionId) {
    await activities.emitStudentAdmittedEvent(
      tenantId,
      studentProfileId,
      membershipId,
      standardId,
      sectionId,
    );
  }

  // 10. Apply previous school TC data if present
  await activities.applyPreviousSchoolData(tenantId, studentProfileId, formData, actorId);

  return { studentProfileId, admissionNumber, membershipId };
}
