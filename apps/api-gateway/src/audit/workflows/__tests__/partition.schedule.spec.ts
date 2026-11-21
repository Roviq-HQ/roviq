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
  AUDIT_MAINTENANCE_TASK_QUEUE,
  AUDIT_PARTITION_SCHEDULE_ID,
  ensureAuditPartitionSchedule,
} from '../partition.schedule';

const CURRENT_SPEC = {
  spec: { calendars: [{ hour: 2, minute: 0, dayOfMonth: 25 }] },
  action: {
    type: 'startWorkflow',
    workflowType: 'auditPartitionManagement',
    taskQueue: AUDIT_MAINTENANCE_TASK_QUEUE,
  },
  policies: { overlap: 'SKIP', catchupWindow: '24 hours' },
};

const notFound = () => new ScheduleNotFoundError('not found', AUDIT_PARTITION_SCHEDULE_ID);

function schedulesWith(
  update: ScheduleHandle['update'],
  create = vi.fn<ScheduleClient['create']>(),
) {
  const updateFn = vi.fn(update);
  const getHandle = vi.fn(() => createMock<ScheduleHandle>({ update: updateFn }));
  return {
    schedules: createMock<ScheduleClient>({ getHandle, create }),
    getHandle,
    update: updateFn,
    create,
  };
}

describe('ensureAuditPartitionSchedule', () => {
  const logger = { log: vi.fn() };

  it('should bring an existing schedule to the current spec and keep its pause', async () => {
    const previous = createMock<ScheduleDescription>({
      state: { paused: true, note: 'paused for maintenance', remainingActions: undefined },
    });
    let sent: unknown;
    const { schedules, getHandle, create } = schedulesWith(async (updateFn) => {
      sent = updateFn(previous);
    });

    await expect(ensureAuditPartitionSchedule(schedules, logger)).resolves.toBe('updated');

    expect(getHandle).toHaveBeenCalledWith(AUDIT_PARTITION_SCHEDULE_ID);
    expect(sent).toEqual({
      ...CURRENT_SPEC,
      state: { paused: true, note: 'paused for maintenance', remainingActions: undefined },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('should create the monthly schedule when Temporal does not know it', async () => {
    const { schedules, create } = schedulesWith(() => Promise.reject(notFound()));

    await expect(ensureAuditPartitionSchedule(schedules, logger)).resolves.toBe('created');

    expect(create).toHaveBeenCalledWith({
      scheduleId: AUDIT_PARTITION_SCHEDULE_ID,
      ...CURRENT_SPEC,
    });
  });

  it('should accept a schedule another gateway created in the meantime', async () => {
    const create = vi
      .fn<ScheduleClient['create']>()
      .mockRejectedValue(new ScheduleAlreadyRunning('exists', AUDIT_PARTITION_SCHEDULE_ID));
    const { schedules } = schedulesWith(() => Promise.reject(notFound()), create);

    await expect(ensureAuditPartitionSchedule(schedules, logger)).resolves.toBe('exists');
  });

  it('should not create anything when the update fails for another reason', async () => {
    const failure = new ServiceError('unavailable');
    const { schedules, create } = schedulesWith(() => Promise.reject(failure));

    await expect(ensureAuditPartitionSchedule(schedules, logger)).rejects.toBe(failure);

    expect(create).not.toHaveBeenCalled();
  });

  it('should throw when the create fails for another reason', async () => {
    const failure = new ServiceError('permission denied');
    const create = vi.fn<ScheduleClient['create']>().mockRejectedValue(failure);
    const { schedules } = schedulesWith(() => Promise.reject(notFound()), create);

    await expect(ensureAuditPartitionSchedule(schedules, logger)).rejects.toBe(failure);
  });
});
