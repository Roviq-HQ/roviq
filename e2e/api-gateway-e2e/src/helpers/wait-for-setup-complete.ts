import assert from 'node:assert/strict';
import { SetupStatus } from '@roviq/common-types';
import { gql } from './gql-client';

/**
 * Poll `adminGetInstitute` until `setupStatus === SetupStatus.COMPLETED`.
 *
 * `institute.service.create()` fires `setupService.runSetup()` as
 * fire-and-forget. Any test that queries an institute's derived state
 * (academic tree, standards, sections, etc.) immediately after creation
 * MUST wait for setup to finish to avoid race-condition flakes.
 *
 * Default 15 s timeout — Phase 1 (`createFirstAcademicYear`) typically
 * completes within ~200 ms, Phase 2 (full SCHOOL seed) under ~2 s.
 *
 * Robustness:
 * - Short-circuits with a clear error on `SetupStatus.FAILED` rather than
 *   running out the clock on a setup that will never reach COMPLETED.
 * - Tolerates transient network errors (api-gateway restart mid-test,
 *   socket hiccups) — a single failed poll does not abort the wait.
 * - On timeout, the assertion message includes the last-observed status
 *   AND the last network error — without these, "did not complete in 15s"
 *   masks the actual failure mode (stuck-in-IN_PROGRESS vs api-gateway
 *   never reachable).
 *
 * Tracked by ROV-262 — surfaced after the institute-admin academic-tree
 * test flaked in CI for PR #208 while passing locally.
 */
export async function waitForSetupComplete(
  instituteId: string,
  adminToken: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: SetupStatus | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    let status: SetupStatus | undefined;
    try {
      const res = await gql<{ adminGetInstitute: { setupStatus: SetupStatus } }>(
        `query WaitForSetupComplete_InstituteStatus($id: ID!) {
          adminGetInstitute(id: $id) { setupStatus }
        }`,
        { id: instituteId },
        adminToken,
      );
      status = res.data?.adminGetInstitute.setupStatus;
      lastError = undefined;
    } catch (err) {
      // Transient — keep polling until the deadline. Stash for diagnostics.
      lastError = err;
    }
    if (status !== undefined) lastStatus = status;
    if (status === SetupStatus.COMPLETED) return;
    if (status === SetupStatus.FAILED) {
      assert.fail(
        `Setup FAILED for institute ${instituteId} — runSetup() crashed or hit an unrecoverable error`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const tail = [
    `lastStatus=${lastStatus ?? '<never observed>'}`,
    lastError
      ? `lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  assert.fail(
    `Setup did not complete within ${timeoutMs}ms for institute ${instituteId} (${tail})`,
  );
}
