/**
 * Types for the InstituteSetupWorkflow (ROV-126).
 *
 * The workflow orchestrates 5 phases of institute provisioning
 * after creation/approval. All activities are idempotent.
 */

/** Task queue of InstituteSetupWorkflow; the admin service starts it here and the worker polls it. */
export const INSTITUTE_SETUP_TASK_QUEUE = 'institute-setup';

/** Input to the InstituteSetupWorkflow */
export interface InstituteSetupInput {
  /** The institute being provisioned */
  instituteId: string;
  /** Institute type: SCHOOL, COACHING, or LIBRARY */
  type: string;
  /** Education levels to provision (e.g., ['PRIMARY', 'SECONDARY']) */
  departments: string[];
  /** Board affiliation for subject seeding (e.g., 'CBSE', 'BSEH') */
  board?: string;
  /** Whether to seed demo data (sample students, etc.) */
  isDemo: boolean;
  /** Session info for audit trail */
  sessionInfo: {
    ipAddress?: string;
    userAgent?: string;
  };
  /** The user who initiated the institute creation */
  creatingUserId: string;
}

/** Progress update emitted via NATS for the instituteSetupProgress subscription */
export interface InstituteSetupProgress {
  instituteId: string;
  /** Current step name (e.g., 'identity', 'infrastructure', 'academic_structure') */
  step: string;
  /** Step status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Human-readable progress message */
  message?: string;
  /** Number of steps completed so far */
  completedSteps: number;
  /** Total number of steps in the workflow */
  totalSteps: number;
}

/** Result of the complete setup workflow */
export interface InstituteSetupResult {
  instituteId: string;
  /** Whether all phases completed successfully */
  success: boolean;
  /** Number of standards created */
  standardsCreated: number;
  /** Number of sections created */
  sectionsCreated: number;
  /** Number of subjects seeded */
  subjectsSeeded: number;
  /** Academic year ID created */
  academicYearId: string | null;
}

/** Activities interface for proxyActivities in the workflow */
export interface InstituteSetupActivities {
  // Phase 1: Identity
  createDefaultRoles(instituteId: string, creatingUserId: string): Promise<void>;
  /** Makes `institutes.first_admin_user_id` the institute admin; runs after createDefaultRoles. */
  createFirstAdmin(instituteId: string, creatingUserId: string): Promise<void>;

  // Phase 2: Infrastructure
  createWallets(instituteId: string): Promise<void>;

  // Phase 3: Academic Structure
  seedAcademicStructure(
    instituteId: string,
    academicYearId: string,
    departments: string[],
    board: string | undefined,
    type: string,
    creatingUserId: string,
  ): Promise<{ standardsCreated: number; sectionsCreated: number; subjectsSeeded: number }>;

  // Phase 4: Configuration
  createDefaultNotificationConfig(instituteId: string, creatingUserId: string): Promise<void>;
  createInstituteConfig(
    instituteId: string,
    board: string | undefined,
    creatingUserId: string,
  ): Promise<void>;
  createFirstAcademicYear(instituteId: string, creatingUserId: string): Promise<string>;

  // Phase 5: Demo Data
  seedDemoData(instituteId: string, creatingUserId: string): Promise<void>;

  // Completion
  updateSetupStatus(
    instituteId: string,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED',
    creatingUserId: string,
  ): Promise<void>;

  // Progress
  publishProgress(progress: InstituteSetupProgress): Promise<void>;
}
