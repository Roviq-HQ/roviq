/**
 * TCIssuanceWorkflow — the first three steps of TC issuance (ROV-161, PRD §5.1).
 *
 * Step 1: Request validation → status='clearance_pending'
 * Step 2: Department clearances (parallel) → accounts, library, lab, transport
 * Step 3: Data population → snapshot 20 CBSE TC fields into tc_data JSONB
 * Steps 4 (approval) and 5 (issue, PDF) are the approveTC and issueTC mutations.
 *
 * Task queue: tc-issuance
 * Workflow timeout: 7 days
 */
import { proxyActivities } from '@temporalio/workflow';
import type { TCIssuanceActivities, TCIssuanceInput, TCIssuanceResult } from './tc-issuance.types';

const DEPARTMENTS = ['accounts', 'library', 'lab', 'transport'];

const activities = proxyActivities<TCIssuanceActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    backoffCoefficient: 2,
  },
});

export async function TCIssuanceWorkflow(input: TCIssuanceInput): Promise<TCIssuanceResult> {
  const { tenantId, tcRegisterId, studentProfileId, skipClearance } = input;

  // ── Step 1: Request validation ─────────────────────────
  const stopped: TCIssuanceResult = {
    status: 'CANCELLED',
    tcRegisterId,
    tcSerialNumber: null,
  };
  if (!(await activities.validateRequest(tenantId, tcRegisterId, studentProfileId))) {
    return stopped;
  }

  // ── Step 2: Department clearances (parallel) ───────────
  if (!skipClearance) {
    const clearanceResults = await Promise.all(
      DEPARTMENTS.map((dept) => activities.checkDepartmentClearance(tenantId, tcRegisterId, dept)),
    );

    const deniedDepts = clearanceResults.filter((r) => !r.cleared);
    if (deniedDepts.length > 0) {
      return {
        status: 'FAILED',
        tcRegisterId,
        tcSerialNumber: null,
      };
    }
  }

  // ── Step 3: Data population (20 CBSE fields) ──────────
  const populated = await activities.populateTcData(tenantId, tcRegisterId, studentProfileId);
  if (!populated) return stopped;

  // Steps 4 (approval) and 5 (issuance) are resolver-driven:
  // - Principal calls approveTC mutation → status='approved'
  // - Admin calls issueTC mutation → generates PDF, marks student transferred_out
  // The workflow completes after data population. This ensures only the principal
  // can approve (PRD §5.1 Step 4: "ONLY principal — CBSE bye-law").

  return {
    status: 'GENERATED',
    tcRegisterId,
    tcSerialNumber: null,
  };
}
