import type { LoggerService } from '@nestjs/common';
import type { NotificationChannel } from '@roviq/common-types';
import {
  ScheduleAlreadyRunning,
  type ScheduleClient,
  ScheduleNotFoundError,
  type ScheduleOptions,
} from '@temporalio/client';
import {
  CANARY_WORKFLOW_TYPE,
  type CanaryWorkflowInput,
  NOTIFICATION_TASK_QUEUE,
} from './notification-workflow.types';

export const CANARY_SCHEDULE_ID = 'notification-delivery-canary';

/** Every 15 minutes; a run still going when the next is due is skipped, never stacked. */
export function canarySchedule(
  channels: readonly NotificationChannel[],
): Omit<ScheduleOptions, 'scheduleId'> {
  const input: CanaryWorkflowInput = { channels: [...channels] };
  return {
    spec: { intervals: [{ every: '15 minutes' }] },
    action: {
      type: 'startWorkflow',
      workflowType: CANARY_WORKFLOW_TYPE,
      taskQueue: NOTIFICATION_TASK_QUEUE,
      args: [input],
    },
    policies: { overlap: 'SKIP', catchupWindow: '1 minute' },
  };
}

export type CanaryScheduleResult = 'created' | 'updated' | 'exists' | 'removed' | 'absent';

/**
 * Brings Temporal to the configured canary: the schedule with these channels when there are
 * any, no schedule when the canary is off. Only a not-found answer leads to a create; any other
 * error is thrown.
 */
export async function syncCanarySchedule(
  schedules: ScheduleClient,
  channels: readonly NotificationChannel[] | null,
  logger: Pick<LoggerService, 'log'>,
): Promise<CanaryScheduleResult> {
  const handle = schedules.getHandle(CANARY_SCHEDULE_ID);
  if (channels === null || channels.length === 0) {
    try {
      await handle.delete();
    } catch (err) {
      if (err instanceof ScheduleNotFoundError) return 'absent';
      throw err;
    }
    logger.log(`Removed Temporal schedule ${CANARY_SCHEDULE_ID}: the canary is off`);
    return 'removed';
  }

  const wanted = canarySchedule(channels);
  try {
    await handle.update((previous) => ({ ...wanted, state: previous.state }));
    logger.log(`Updated Temporal schedule ${CANARY_SCHEDULE_ID} (${channels.join(', ')})`);
    return 'updated';
  } catch (err) {
    if (!(err instanceof ScheduleNotFoundError)) throw err;
  }

  try {
    await schedules.create({ scheduleId: CANARY_SCHEDULE_ID, ...wanted });
  } catch (err) {
    // Another instance created it between our update and create, from the same settings.
    if (err instanceof ScheduleAlreadyRunning) return 'exists';
    throw err;
  }
  logger.log(`Created Temporal schedule ${CANARY_SCHEDULE_ID} (${channels.join(', ')})`);
  return 'created';
}
