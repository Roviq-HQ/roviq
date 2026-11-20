import type { LoggerService } from '@nestjs/common';
import {
  ScheduleAlreadyRunning,
  type ScheduleClient,
  ScheduleNotFoundError,
} from '@temporalio/client';

export const FILE_MAINTENANCE_TASK_QUEUE = 'file-maintenance';
export const FILE_SWEEPER_SCHEDULE_ID = 'file-sweeper-hourly';

/**
 * Creates the hourly sweeper schedule unless it exists. Every gateway that runs the worker
 * calls this at start; only a not-found answer leads to a create, any other error is thrown.
 */
export async function ensureFileSweeperSchedule(
  schedules: ScheduleClient,
  logger: Pick<LoggerService, 'log'>,
): Promise<'created' | 'exists'> {
  try {
    await schedules.getHandle(FILE_SWEEPER_SCHEDULE_ID).describe();
    return 'exists';
  } catch (err) {
    if (!(err instanceof ScheduleNotFoundError)) throw err;
  }

  try {
    await schedules.create({
      scheduleId: FILE_SWEEPER_SCHEDULE_ID,
      spec: { intervals: [{ every: '1 hour' }] },
      action: {
        type: 'startWorkflow',
        workflowType: 'fileSweeper',
        taskQueue: FILE_MAINTENANCE_TASK_QUEUE,
      },
      policies: { overlap: 'SKIP', catchupWindow: '1 hour' },
    });
  } catch (err) {
    // Another gateway created it between our describe and create.
    if (err instanceof ScheduleAlreadyRunning) return 'exists';
    throw err;
  }
  logger.log(`Created Temporal schedule ${FILE_SWEEPER_SCHEDULE_ID}`);
  return 'created';
}
