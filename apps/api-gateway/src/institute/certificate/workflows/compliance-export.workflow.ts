/**
 * ComplianceExportWorkflow — Temporal workflow (ROV-171, ROV-296).
 *
 * PENDING → RUNNING → build and store the XLSX → COMPLETED (file READY in the same
 * transaction). Any failure after retries marks the export FAILED with an error code.
 *
 * Task queue: compliance-export
 */
import { ActivityFailure, ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type {
  ComplianceExportActivities,
  ComplianceExportInput,
  ComplianceExportResult,
} from './compliance-export.types';

const status = proxyActivities<ComplianceExportActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5, initialInterval: '2 seconds', backoffCoefficient: 2 },
});

const generation = proxyActivities<ComplianceExportActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3, initialInterval: '5 seconds', backoffCoefficient: 2 },
});

function failureTypeOf(err: unknown): string | null {
  const cause = err instanceof ActivityFailure ? err.cause : err;
  return cause instanceof ApplicationFailure ? (cause.type ?? null) : null;
}

export async function ComplianceExportWorkflow(
  input: ComplianceExportInput,
): Promise<ComplianceExportResult> {
  try {
    await status.markExportRunning(input);
    const { rowCount } = await generation.generateExportFile(input);
    await status.markExportCompleted({ ...input, rowCount });
    return { exportReportId: input.exportReportId, fileId: input.fileId, rowCount };
  } catch (err) {
    await status.markExportFailed({ ...input, failureType: failureTypeOf(err) });
    throw err;
  }
}
