import { createMock } from '@roviq/testing';
import {
  ScheduleAlreadyRunning,
  type ScheduleClient,
  type ScheduleDescription,
  type ScheduleHandle,
  ScheduleNotFoundError,
  ServiceError,
} from '@temporalio/client';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureFileSweeperSchedule,
  FILE_MAINTENANCE_TASK_QUEUE,
  FILE_SWEEPER_SCHEDULE_ID,
} from '../file-sweeper.schedule';

function schedulesWith(
  describeResult: Promise<ScheduleDescription>,
  create = vi.fn<ScheduleClient['create']>(),
) {
  const describeFn = vi.fn<ScheduleHandle['describe']>(() => describeResult);
  const getHandle = vi.fn(() => createMock<ScheduleHandle>({ describe: describeFn }));
  return { schedules: createMock<ScheduleClient>({ getHandle, create }), getHandle, create };
}

describe('ensureFileSweeperSchedule', () => {
  const logger = { log: vi.fn() };

  it('should create the hourly schedule when Temporal does not know it', async () => {
    const { schedules, getHandle, create } = schedulesWith(
      Promise.reject(new ScheduleNotFoundError('not found', FILE_SWEEPER_SCHEDULE_ID)),
    );

    await expect(ensureFileSweeperSchedule(schedules, logger)).resolves.toBe('created');

    expect(getHandle).toHaveBeenCalledWith(FILE_SWEEPER_SCHEDULE_ID);
    expect(create).toHaveBeenCalledWith({
      scheduleId: FILE_SWEEPER_SCHEDULE_ID,
      spec: { intervals: [{ every: '1 hour' }] },
      action: {
        type: 'startWorkflow',
        workflowType: 'fileSweeper',
        taskQueue: FILE_MAINTENANCE_TASK_QUEUE,
      },
      policies: { overlap: 'SKIP', catchupWindow: '1 hour' },
    });
  });

  it('should do nothing when the schedule already exists', async () => {
    const { schedules, create } = schedulesWith(Promise.resolve(createMock<ScheduleDescription>()));

    await expect(ensureFileSweeperSchedule(schedules, logger)).resolves.toBe('exists');

    expect(create).not.toHaveBeenCalled();
  });

  it('should not create anything when Temporal fails for another reason', async () => {
    const failure = new ServiceError('unavailable');
    const { schedules, create } = schedulesWith(Promise.reject(failure));

    await expect(ensureFileSweeperSchedule(schedules, logger)).rejects.toBe(failure);

    expect(create).not.toHaveBeenCalled();
  });

  it('should accept a schedule another gateway created in the meantime', async () => {
    const create = vi
      .fn<ScheduleClient['create']>()
      .mockRejectedValue(new ScheduleAlreadyRunning('exists', FILE_SWEEPER_SCHEDULE_ID));
    const { schedules } = schedulesWith(
      Promise.reject(new ScheduleNotFoundError('not found', FILE_SWEEPER_SCHEDULE_ID)),
      create,
    );

    await expect(ensureFileSweeperSchedule(schedules, logger)).resolves.toBe('exists');
  });

  it('should throw when the create fails for another reason', async () => {
    const failure = new ServiceError('permission denied');
    const create = vi.fn<ScheduleClient['create']>().mockRejectedValue(failure);
    const { schedules } = schedulesWith(
      Promise.reject(new ScheduleNotFoundError('not found', FILE_SWEEPER_SCHEDULE_ID)),
      create,
    );

    await expect(ensureFileSweeperSchedule(schedules, logger)).rejects.toBe(failure);
  });
});
