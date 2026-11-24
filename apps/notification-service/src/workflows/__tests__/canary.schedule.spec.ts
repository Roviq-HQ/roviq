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
import { CANARY_SCHEDULE_ID, syncCanarySchedule } from '../canary.schedule';

const WANTED = {
  spec: { intervals: [{ every: '15 minutes' }] },
  action: {
    type: 'startWorkflow',
    workflowType: 'DeliveryCanaryWorkflow',
    taskQueue: 'notifications',
    args: [{ channels: ['EMAIL', 'SMS'] }],
  },
  policies: { overlap: 'SKIP', catchupWindow: '1 minute' },
};

const notFound = () => new ScheduleNotFoundError('not found', CANARY_SCHEDULE_ID);

function schedulesWith(handle: {
  update?: ScheduleHandle['update'];
  delete?: ScheduleHandle['delete'];
  create?: ScheduleClient['create'];
}) {
  const update = vi.fn(handle.update ?? (() => Promise.resolve()));
  const remove = vi.fn(handle.delete ?? (() => Promise.resolve()));
  const create = vi.fn(handle.create ?? (() => Promise.reject(new Error('unused'))));
  const getHandle = vi.fn(() => createMock<ScheduleHandle>({ update, delete: remove }));
  return {
    schedules: createMock<ScheduleClient>({ getHandle, create }),
    getHandle,
    update,
    remove,
    create,
  };
}

describe('syncCanarySchedule', () => {
  const logger = { log: vi.fn() };

  it('should bring an existing schedule to the configured channels and keep its pause', async () => {
    const previous = createMock<ScheduleDescription>({
      state: { paused: true, note: 'provider outage', remainingActions: undefined },
    });
    let sent: unknown;
    const { schedules, getHandle, create, remove } = schedulesWith({
      update: async (fn) => {
        sent = fn(previous);
      },
    });

    await expect(syncCanarySchedule(schedules, ['EMAIL', 'SMS'], logger)).resolves.toBe('updated');

    expect(getHandle).toHaveBeenCalledWith(CANARY_SCHEDULE_ID);
    expect(sent).toEqual({
      ...WANTED,
      state: { paused: true, note: 'provider outage', remainingActions: undefined },
    });
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('should create the schedule when Temporal does not know it', async () => {
    const { schedules, create } = schedulesWith({
      update: () => Promise.reject(notFound()),
      create: () => Promise.resolve(createMock<ScheduleHandle>()),
    });

    await expect(syncCanarySchedule(schedules, ['EMAIL', 'SMS'], logger)).resolves.toBe('created');

    expect(create).toHaveBeenCalledWith({ scheduleId: CANARY_SCHEDULE_ID, ...WANTED });
  });

  it('should accept a schedule another instance created in the meantime', async () => {
    const { schedules } = schedulesWith({
      update: () => Promise.reject(notFound()),
      create: () => Promise.reject(new ScheduleAlreadyRunning('exists', CANARY_SCHEDULE_ID)),
    });

    await expect(syncCanarySchedule(schedules, ['EMAIL'], logger)).resolves.toBe('exists');
  });

  it('should not create anything when the update fails for another reason', async () => {
    const failure = new ServiceError('unavailable');
    const { schedules, create } = schedulesWith({ update: () => Promise.reject(failure) });

    await expect(syncCanarySchedule(schedules, ['EMAIL'], logger)).rejects.toBe(failure);
    expect(create).not.toHaveBeenCalled();
  });

  it('should remove the schedule when the canary is off', async () => {
    const { schedules, remove, update } = schedulesWith({});

    await expect(syncCanarySchedule(schedules, null, logger)).resolves.toBe('removed');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('should accept that there is no schedule to remove', async () => {
    const { schedules } = schedulesWith({ delete: () => Promise.reject(notFound()) });

    await expect(syncCanarySchedule(schedules, null, logger)).resolves.toBe('absent');
  });

  it('should throw when removing fails for another reason', async () => {
    const failure = new ServiceError('permission denied');
    const { schedules } = schedulesWith({ delete: () => Promise.reject(failure) });

    await expect(syncCanarySchedule(schedules, null, logger)).rejects.toBe(failure);
  });
});
