/**
 * InstituteSetupWorkflow — 5-phase Temporal workflow (ROV-126, PRD §10.4).
 *
 * Orchestrates institute provisioning after creation/approval:
 *   Phase 1: Identity (sequential) — admin role, membership, system role
 *   Phase 2: Infrastructure (parallel) — storage, wallets, default roles
 *   Phase 3: Academic Structure (parallel per department) — standards, sections, subjects
 *   Phase 4: Configuration (parallel) — notifications, strength norms, first academic year
 *   Phase 5: Demo Data (conditional) — only if isDemo=true
 *
 * Timeout: 10 minutes. All activities are idempotent (check "exists?" before creating).
 * Task queue: institute-setup
 */
import { proxyActivities } from '@temporalio/workflow';
import type {
  InstituteSetupActivities,
  InstituteSetupInput,
  InstituteSetupResult,
} from './institute-setup.types';

const activities = proxyActivities<InstituteSetupActivities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    backoffCoefficient: 2,
  },
});

const TOTAL_STEPS = 5;

export async function InstituteSetupWorkflow(
  input: InstituteSetupInput,
): Promise<InstituteSetupResult> {
  const { instituteId, type, departments, board, isDemo, creatingUserId } = input;

  let academicYearId: string | null = null;
  let standardsCreated = 0;
  let sectionsCreated = 0;
  let subjectsSeeded = 0;

  await activities.updateSetupStatus(instituteId, 'IN_PROGRESS', creatingUserId);

  // ── Phase 1: Identity (Sequential) ─────────────────────
  // CRITICAL: Never write directly to memberships/users/roles tables.
  // Always via NATS to Identity Service. Actor context propagated via headers.
  await activities.publishProgress({
    instituteId,
    step: 'identity',
    status: 'in_progress',
    message: 'Setting up admin access...',
    completedSteps: 0,
    totalSteps: TOTAL_STEPS,
  });

  const adminRoleId = await activities.createAdminRole(instituteId, creatingUserId);
  await activities.createAdminMembership(instituteId, creatingUserId, adminRoleId);
  await activities.createSystemRole(instituteId, creatingUserId);
  await activities.setInstituteRepresentative(instituteId, creatingUserId);

  await activities.publishProgress({
    instituteId,
    step: 'identity',
    status: 'completed',
    message: 'Admin access configured',
    completedSteps: 1,
    totalSteps: TOTAL_STEPS,
  });

  // ── Phase 2: Infrastructure (Parallel) ─────────────────
  await activities.publishProgress({
    instituteId,
    step: 'infrastructure',
    status: 'in_progress',
    message: 'Provisioning infrastructure...',
    completedSteps: 1,
    totalSteps: TOTAL_STEPS,
  });

  await Promise.all([
    activities.createStorageBucket(instituteId),
    activities.createWallets(instituteId),
    activities.createDefaultRoles(instituteId, creatingUserId),
  ]);

  await activities.publishProgress({
    instituteId,
    step: 'infrastructure',
    status: 'completed',
    message: 'Infrastructure ready',
    completedSteps: 2,
    totalSteps: TOTAL_STEPS,
  });

  // ── Phase 3: Academic Structure ─────────────────────────
  // Phase 4 runs first to create the academic year needed by Phase 3
  await activities.publishProgress({
    instituteId,
    step: 'configuration',
    status: 'in_progress',
    message: 'Setting up configuration...',
    completedSteps: 2,
    totalSteps: TOTAL_STEPS,
  });

  await Promise.all([
    activities.createDefaultNotificationConfig(instituteId, creatingUserId),
    activities.createInstituteConfig(instituteId, board, creatingUserId),
  ]);

  academicYearId = await activities.createFirstAcademicYear(instituteId, creatingUserId);

  await activities.publishProgress({
    instituteId,
    step: 'configuration',
    status: 'completed',
    message: 'Configuration complete',
    completedSteps: 3,
    totalSteps: TOTAL_STEPS,
  });

  // Now seed academic structure using the academic year
  await activities.publishProgress({
    instituteId,
    step: 'academic_structure',
    status: 'in_progress',
    message: 'Seeding academic structure...',
    completedSteps: 3,
    totalSteps: TOTAL_STEPS,
  });

  if (academicYearId && departments.length > 0) {
    const result = await activities.seedAcademicStructure(
      instituteId,
      academicYearId,
      departments,
      board,
      type,
      creatingUserId,
    );
    standardsCreated = result.standardsCreated;
    sectionsCreated = result.sectionsCreated;
    subjectsSeeded = result.subjectsSeeded;
  }

  await activities.publishProgress({
    instituteId,
    step: 'academic_structure',
    status: 'completed',
    message: `Created ${standardsCreated} standards, ${sectionsCreated} sections, ${subjectsSeeded} subjects`,
    completedSteps: 4,
    totalSteps: TOTAL_STEPS,
  });

  // ── Phase 5: Demo Data (Conditional) ───────────────────
  if (isDemo) {
    await activities.publishProgress({
      instituteId,
      step: 'demo_data',
      status: 'in_progress',
      message: 'Generating demo data...',
      completedSteps: 4,
      totalSteps: TOTAL_STEPS,
    });

    await activities.seedDemoData(instituteId, creatingUserId);

    await activities.publishProgress({
      instituteId,
      step: 'demo_data',
      status: 'completed',
      message: 'Demo data ready',
      completedSteps: 5,
      totalSteps: TOTAL_STEPS,
    });
  }

  // ── Completion ─────────────────────────────────────────
  await activities.updateSetupStatus(instituteId, 'COMPLETED', creatingUserId);

  await activities.publishProgress({
    instituteId,
    step: 'complete',
    status: 'completed',
    message: 'Institute setup complete',
    completedSteps: TOTAL_STEPS,
    totalSteps: TOTAL_STEPS,
  });

  return {
    instituteId,
    success: true,
    standardsCreated,
    sectionsCreated,
    subjectsSeeded,
    academicYearId,
  };
}
