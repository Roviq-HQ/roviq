/**
 * Hourly file cleanup (ROV-300). Task queue: file-maintenance. Started by the
 * `file-sweeper-hourly` schedule, never by a request.
 */
import { proxyActivities } from '@temporalio/workflow';
import type { SweepSummary } from '../file-sweeper';
import type { FileSweeperActivities } from './file-sweeper.activities';

const { sweepFiles } = proxyActivities<FileSweeperActivities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

export async function fileSweeper(): Promise<SweepSummary> {
  return sweepFiles();
}
