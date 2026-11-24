import { describe, expect, it, vi } from 'vitest';
import { type ConsumerLagInfo, eventLags } from '../notification-gauges';

const NOW = new Date('2026-11-24T10:00:00.000Z');

function consumer(name: string, pending: number, ackPending: number): ConsumerLagInfo {
  return {
    name,
    config: { filter_subject: `NOTIFICATION.${name}` },
    ack_floor: { consumer_seq: 8, stream_seq: 8, last_active: 0 },
    num_ack_pending: ackPending,
    num_pending: pending,
  };
}

async function* list(...items: ConsumerLagInfo[]): AsyncIterable<ConsumerLagInfo> {
  for (const item of items) yield item;
}

describe('eventLags', () => {
  it('should report 0 for a consumer with nothing waiting, without reading a message', async () => {
    const oldest = vi.fn().mockResolvedValue(null);

    await expect(
      eventLags(list(consumer('notification-auth', 0, 0)), oldest, NOW),
    ).resolves.toEqual([{ consumer: 'notification-auth', seconds: 0 }]);
    expect(oldest).not.toHaveBeenCalled();
  });

  it('should report the age of the oldest unhandled event in whole seconds', async () => {
    const oldest = vi.fn().mockResolvedValue(new Date('2026-11-24T09:54:59.600Z'));

    const lags = await eventLags(list(consumer('notification-fee', 2, 1)), oldest, NOW);

    expect(lags).toEqual([{ consumer: 'notification-fee', seconds: 300 }]);
  });

  it('should report 0 when the waiting message can no longer be read', async () => {
    const oldest = vi.fn().mockResolvedValue(null);

    const lags = await eventLags(list(consumer('notification-canary', 0, 1)), oldest, NOW);

    expect(lags).toEqual([{ consumer: 'notification-canary', seconds: 0 }]);
  });

  it('should never report a negative age for a clock ahead of the server', async () => {
    const oldest = vi.fn().mockResolvedValue(new Date('2026-11-24T10:00:05.000Z'));

    const lags = await eventLags(list(consumer('notification-user', 1, 0)), oldest, NOW);

    expect(lags).toEqual([{ consumer: 'notification-user', seconds: 0 }]);
  });
});
