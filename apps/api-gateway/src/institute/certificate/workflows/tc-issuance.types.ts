/**
 * Types for TCIssuanceWorkflow (ROV-161, PRD §5.1).
 *
 * 5-step Temporal workflow:
 *   1. Request validation
 *   2. Department clearances (parallel)
 *   3. TC data population (20 CBSE fields snapshot)
 *   4. Review + approval
 *   5. Issuance (PDF generation, S3 upload, student status update)
 */

/**
 * Default task queue of TCIssuanceWorkflow. `TEMPORAL_TC_TASK_QUEUE` overrides it (CE-002);
 * the service that starts the workflow and the worker read the same variable.
 */
export const DEFAULT_TC_TASK_QUEUE = 'tc-issuance';

// ── Workflow input ────────────────────────────────────────

export interface TCIssuanceInput {
  tenantId: string;
  tcRegisterId: string;
  studentProfileId: string;
  academicYearId: string;
  reason: string;
  requestedBy: string;
  /** Skip clearance step for duplicate TCs */
  skipClearance?: boolean;
}

// ── CBSE TC Data — 20 prescribed fields ──────────────────

import type { CbseTcData } from '@roviq/common-types';

export type { CbseTcData };

// ── Activity results ──────────────────────────────────────

export interface ClearanceResult {
  department: string;
  cleared: boolean;
  notes?: string;
}

export interface TCPopulateResult {
  tcData: CbseTcData;
}

// ── Workflow result ───────────────────────────────────────

export type TCWorkflowStatus =
  | 'CLEARANCE_PENDING'
  | 'CLEARANCE_COMPLETE'
  | 'GENERATED'
  | 'APPROVED'
  | 'ISSUED'
  // The TC was cancelled while the workflow ran
  | 'CANCELLED'
  | 'FAILED';

export interface TCIssuanceResult {
  status: TCWorkflowStatus;
  tcRegisterId: string;
  tcSerialNumber: string | null;
}

// ── Activities interface ──────────────────────────────────

export interface TCIssuanceActivities {
  /**
   * Step 1: Validate student status and move tc_register to clearance_pending.
   * False when the TC left REQUESTED meanwhile (cancelled): the workflow must stop.
   */
  validateRequest(
    tenantId: string,
    tcRegisterId: string,
    studentProfileId: string,
  ): Promise<boolean>;

  /** Step 2: Check clearance for a single department */
  checkDepartmentClearance(
    tenantId: string,
    tcRegisterId: string,
    department: string,
  ): Promise<ClearanceResult>;

  /** Step 3: Populate tc_data with all 20 CBSE fields. Null when the TC was cancelled meanwhile. */
  populateTcData(
    tenantId: string,
    tcRegisterId: string,
    studentProfileId: string,
  ): Promise<TCPopulateResult | null>;
}
