import type { LoggerService } from '@nestjs/common';
import {
  ScheduleAlreadyRunning,
  type ScheduleClient,
  ScheduleNotFoundError,
  type ScheduleOptions,
} from '@temporalio/client';

export const FILE_MAINTENANCE_TASK_QUEUE = 'file-maintenance';
export const FILE_SWEEPER_SCHEDULE_ID = 'file-sweeper-hourly';

const FILE_SWEEPER_SCHEDULE = {
  spec: { intervals: [{ every: '1 hour' }] },
  action: {
    type: 'startWorkflow',
    workflowType: 'fileSweeper',
    taskQueue: FILE_MAINTENANCE_TASK_QUEUE,
  },
  policies: { overlap: 'SKIP', catchupWindow: '1 hour' },
} satisfies Omit<ScheduleOptions, 'scheduleId'>;

/**
 * Brings the hourly sweeper schedule to the spec above, creating it when it does not exist.
 * Every gateway that runs the worker calls this at start; only a not-found answer leads to a
 * create, any other error is thrown.
 */
export async function ensureFileSweeperSchedule(
  schedules: ScheduleClient,
  logger: Pick<LoggerService, 'log'>,
): Promise<'created' | 'updated' | 'exists'> {
  try {
    await schedules.getHandle(FILE_SWEEPER_SCHEDULE_ID).update((previous) => ({
      ...FILE_SWEEPER_SCHEDULE,
      // An operator's pause and its note survive a deploy.
      state: previous.state,
    }));
    logger.log(`Updated Temporal schedule ${FILE_SWEEPER_SCHEDULE_ID}`);
    return 'updated';
  } catch (err) {
    if (!(err instanceof ScheduleNotFoundError)) throw err;
  }

  try {
    await schedules.create({ scheduleId: FILE_SWEEPER_SCHEDULE_ID, ...FILE_SWEEPER_SCHEDULE });
  } catch (err) {
    // Another gateway created it between our update and create, from the same spec.
    if (err instanceof ScheduleAlreadyRunning) return 'exists';
    throw err;
  }
  logger.log(`Created Temporal schedule ${FILE_SWEEPER_SCHEDULE_ID}`);
  return 'created';
}
