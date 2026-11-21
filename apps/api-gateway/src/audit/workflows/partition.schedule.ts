import type { LoggerService } from '@nestjs/common';
import {
  ScheduleAlreadyRunning,
  type ScheduleClient,
  ScheduleNotFoundError,
  type ScheduleOptions,
} from '@temporalio/client';

export const AUDIT_MAINTENANCE_TASK_QUEUE = 'audit-maintenance';
export const AUDIT_PARTITION_SCHEDULE_ID = 'audit-partition-cron';

/**
 * 2 AM UTC on the 25th of each month: next month's partition five days early, then retention
 * (detach partitions past one year) and a health check. AuditPartitionMaintainer creates
 * partitions at boot and daily too; only this workflow enforces retention.
 */
const AUDIT_PARTITION_SCHEDULE = {
  spec: { calendars: [{ hour: 2, minute: 0, dayOfMonth: 25 }] },
  action: {
    type: 'startWorkflow',
    workflowType: 'auditPartitionManagement',
    taskQueue: AUDIT_MAINTENANCE_TASK_QUEUE,
  },
  policies: { overlap: 'SKIP', catchupWindow: '24 hours' },
} satisfies Omit<ScheduleOptions, 'scheduleId'>;

/**
 * Brings the partition schedule to the spec above, creating it when it does not exist. Only a
 * not-found answer leads to a create; any other error is thrown.
 */
export async function ensureAuditPartitionSchedule(
  schedules: ScheduleClient,
  logger: Pick<LoggerService, 'log'>,
): Promise<'created' | 'updated' | 'exists'> {
  try {
    await schedules.getHandle(AUDIT_PARTITION_SCHEDULE_ID).update((previous) => ({
      ...AUDIT_PARTITION_SCHEDULE,
      // An operator's pause and its note survive a deploy.
      state: previous.state,
    }));
    logger.log(`Updated Temporal schedule ${AUDIT_PARTITION_SCHEDULE_ID}`);
    return 'updated';
  } catch (err) {
    if (!(err instanceof ScheduleNotFoundError)) throw err;
  }

  try {
    await schedules.create({
      scheduleId: AUDIT_PARTITION_SCHEDULE_ID,
      ...AUDIT_PARTITION_SCHEDULE,
    });
  } catch (err) {
    // Another gateway created it between our update and create, from the same spec.
    if (err instanceof ScheduleAlreadyRunning) return 'exists';
    throw err;
  }
  logger.log(`Created Temporal schedule ${AUDIT_PARTITION_SCHEDULE_ID}`);
  return 'created';
}
