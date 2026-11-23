import type { NotificationChannel } from '@roviq/common-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDeliveryWorkflow } from '../notification.workflows';
import {
  type DeliveryWorkflowInput,
  MAX_CHANNEL_DEFERRALS,
  type NotificationActivities,
} from '../notification-workflow.types';

const temporal = vi.hoisted(() => ({
  sendChannel: vi.fn<NotificationActivities['sendChannel']>(),
  sleep: vi.fn<(ms: number) => Promise<void>>(),
}));

// The workflow sandbox is not available in a unit test; the workflow's own logic is.
vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({ sendChannel: temporal.sendChannel }),
  sleep: temporal.sleep,
  defineSignal: (name: string) => name,
  setHandler: vi.fn(),
}));

const NOW = new Date('2026-11-23T17:00:00.000Z');

function input(channels: NotificationChannel[]): DeliveryWorkflowInput {
  return {
    audience: {
      scope: 'institute',
      tenantId: '019a0000-0000-7000-8000-000000000001',
      resellerId: null,
    },
    recipientUserId: 'user-guardian-1',
    message: {
      type: 'LEAVE_DECIDED',
      params: {
        leaveId: 'leave-1',
        status: 'APPROVED',
        audience: 'applicant',
        applicantName: 'Priya Verma',
        startDate: '2026-04-20',
        endDate: '2026-04-21',
      },
    },
    notificationId: 'notification-1',
    channels: channels.map((channel) => ({ channel, enabled: true })),
    data: { leaveId: 'leave-1' },
  };
}

const calledChannels = () => temporal.sendChannel.mock.calls.map(([i]) => i.channel);

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('NotificationDeliveryWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // Created in vi.hoisted, so restoreMocks does not reset them between tests.
    temporal.sendChannel.mockReset().mockResolvedValue('SENT');
    temporal.sleep.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should send push and email first, then WhatsApp, then SMS', async () => {
    await NotificationDeliveryWorkflow(input(['SMS', 'WHATSAPP', 'EMAIL', 'PUSH']));

    expect(calledChannels()).toEqual(['EMAIL', 'PUSH', 'WHATSAPP', 'SMS']);
  });

  it('should start WhatsApp only once push and email have settled', async () => {
    let finishPush: (value: 'SENT') => void = () => undefined;
    temporal.sendChannel.mockImplementation((i) =>
      i.channel === 'PUSH'
        ? new Promise((resolve) => {
            finishPush = resolve;
          })
        : Promise.resolve('SENT'),
    );

    const run = NotificationDeliveryWorkflow(input(['WHATSAPP', 'PUSH', 'EMAIL']));
    await flush();

    expect(calledChannels()).toEqual(['PUSH', 'EMAIL']);
    finishPush('SENT');
    await run;
    expect(calledChannels()).toEqual(['PUSH', 'EMAIL', 'WHATSAPP']);
  });

  it('should still send the later channels when an earlier one fails', async () => {
    temporal.sendChannel.mockImplementation((i) =>
      i.channel === 'EMAIL' || i.channel === 'WHATSAPP'
        ? Promise.reject(new Error('activity failed after its retries'))
        : Promise.resolve('SENT'),
    );

    await expect(
      NotificationDeliveryWorkflow(input(['EMAIL', 'WHATSAPP', 'SMS'])),
    ).resolves.toBeUndefined();

    expect(calledChannels()).toEqual(['EMAIL', 'WHATSAPP', 'SMS']);
  });

  it('should pass the single message and its plan to each channel', async () => {
    await NotificationDeliveryWorkflow({
      ...input([]),
      channels: [{ channel: 'WHATSAPP', enabled: false }],
    });

    const workflowInput = input([]);
    expect(temporal.sendChannel.mock.calls).toEqual([
      [
        {
          audience: workflowInput.audience,
          recipientUserId: 'user-guardian-1',
          channel: 'WHATSAPP',
          enabled: false,
          deferrable: true,
          content: {
            kind: 'single',
            message: workflowInput.message,
            notificationId: 'notification-1',
          },
          data: { leaveId: 'leave-1' },
        },
      ],
    ]);
  });

  it('should sleep until a deferral ends and try the channel again', async () => {
    temporal.sendChannel
      .mockResolvedValueOnce({ deferUntil: '2026-11-24T01:30:00.000Z' })
      .mockResolvedValueOnce('SENT');

    await NotificationDeliveryWorkflow(input(['WHATSAPP']));

    expect(temporal.sleep.mock.calls).toEqual([[8.5 * 60 * 60 * 1000]]);
    expect(temporal.sendChannel.mock.calls.map(([i]) => [i.channel, i.deferrable])).toEqual([
      ['WHATSAPP', true],
      ['WHATSAPP', true],
    ]);
  });

  it('should try again at once for a deferral that already ended', async () => {
    temporal.sendChannel
      .mockResolvedValueOnce({ deferUntil: '2026-11-23T16:00:00.000Z' })
      .mockResolvedValueOnce('SKIPPED');

    await NotificationDeliveryWorkflow(input(['WHATSAPP']));

    expect(temporal.sleep).not.toHaveBeenCalled();
    expect(calledChannels()).toEqual(['WHATSAPP', 'WHATSAPP']);
  });

  it('should make the call after the last deferral final, then move on', async () => {
    temporal.sendChannel.mockImplementation((i) =>
      Promise.resolve(
        i.channel === 'WHATSAPP' && i.deferrable
          ? { deferUntil: '2026-11-23T18:00:00.000Z' }
          : i.channel === 'WHATSAPP'
            ? 'SKIPPED'
            : 'SENT',
      ),
    );

    await expect(NotificationDeliveryWorkflow(input(['WHATSAPP', 'SMS']))).resolves.toBeUndefined();

    // The last deferrable call is answered with a deferral, and exactly one final call follows.
    expect(temporal.sendChannel.mock.calls.map(([i]) => [i.channel, i.deferrable])).toEqual([
      ...Array.from({ length: MAX_CHANNEL_DEFERRALS }, () => ['WHATSAPP', true]),
      ['WHATSAPP', false],
      ['SMS', true],
    ]);
    expect(temporal.sleep).toHaveBeenCalledTimes(MAX_CHANNEL_DEFERRALS);
    expect(temporal.sleep.mock.calls.every(([ms]) => ms === 60 * 60 * 1000)).toBe(true);
  });

  it('should stop at the first final answer without sleeping after it', async () => {
    temporal.sendChannel
      .mockResolvedValueOnce({ deferUntil: '2026-11-23T18:00:00.000Z' })
      .mockResolvedValueOnce({ deferUntil: '2026-11-23T18:00:00.000Z' })
      .mockResolvedValueOnce('SKIPPED');

    await NotificationDeliveryWorkflow(input(['WHATSAPP']));

    expect(calledChannels()).toEqual(['WHATSAPP', 'WHATSAPP', 'WHATSAPP']);
    expect(temporal.sleep).toHaveBeenCalledTimes(2);
  });
});
