import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardianAlertFlow } from '../../types/flow';
import {
  NotificationDigestWorkflow,
  NotificationFlowWorkflow,
  WhatsAppTemplateSyncWorkflow,
} from '../notification.workflows';
import {
  type DigestItem,
  type FlowArrival,
  type FlowWorkflowInput,
  MAX_CHANNEL_DEFERRALS,
  MAX_HELD_DEFERRALS,
  type NotificationActivities,
  TEMPLATE_RECHECK_WAITS_MS,
  TEMPLATE_SYNC_REQUESTED_SIGNAL,
} from '../notification-workflow.types';

const temporal = vi.hoisted(() => ({
  sendChannel: vi.fn<NotificationActivities['sendChannel']>(),
  recordSkip: vi.fn<NotificationActivities['recordSkip']>(),
  syncWhatsAppTemplates: vi.fn<NotificationActivities['syncWhatsAppTemplates']>(),
  sleep: vi.fn<(ms: number) => Promise<void>>(),
  /** Called inside each `condition` wait, before it answers; may deliver a signal. */
  duringWait: vi.fn<(ms: number) => void>(),
  handlers: new Map<string, (arg: unknown) => void>(),
}));

// The workflow sandbox is not available in a unit test; the workflow's own logic is.
vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    sendChannel: temporal.sendChannel,
    recordSkip: temporal.recordSkip,
    syncWhatsAppTemplates: temporal.syncWhatsAppTemplates,
  }),
  sleep: temporal.sleep,
  condition: async (fn: () => boolean, ms: number) => {
    temporal.duringWait(ms);
    return fn();
  },
  defineSignal: (name: string) => name,
  setHandler: (name: string, handler: (arg: unknown) => void) => {
    temporal.handlers.set(name, handler);
  },
  workflowInfo: () => ({ workflowId: 'notification-digest:t1:user-guardian-1:ATTENDANCE_ABSENT' }),
}));

const NOW = new Date('2026-11-23T17:00:00.000Z');
const AUDIENCE = {
  scope: 'institute',
  tenantId: '019a0000-0000-7000-8000-000000000001',
  resellerId: null,
} as const;
const MESSAGE = {
  type: 'LEAVE_DECIDED',
  params: {
    leaveId: 'leave-1',
    status: 'APPROVED',
    audience: 'guardian',
    applicantName: 'Priya Verma',
    startDate: '2026-04-20',
    endDate: '2026-04-21',
  },
} as const;
const REF = { kind: 'guardians_of_student', studentMembershipId: 'membership-student-1' } as const;

function input(): FlowWorkflowInput {
  return {
    flowId: 'notification-flow:NOTIFICATION:7:LEAVE_DECIDED',
    audience: AUDIENCE,
    message: MESSAGE,
    recipients: [
      { userId: 'user-guardian-1', notificationId: 'notification-1' },
      { userId: 'user-guardian-2', notificationId: 'notification-2' },
    ],
    recipientsRef: REF,
    flow: guardianAlertFlow(),
    enabled: { EMAIL: true, PUSH: true, SMS: true, WHATSAPP: false },
    critical: false,
    data: { leaveId: 'leave-1' },
  };
}

const sends = () => temporal.sendChannel.mock.calls.map(([i]) => [i.recipientUserId, i.channel]);
const skips = () =>
  temporal.recordSkip.mock.calls.map(([i]) => [i.recipientUserId, i.channel, i.reason]);

function arrive(arrival: FlowArrival): void {
  const handler = temporal.handlers.get('flowArrival');
  if (!handler) throw new Error('no flowArrival handler');
  handler(arrival);
}

describe('NotificationFlowWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // Created in vi.hoisted, so restoreMocks does not reset them between tests.
    temporal.sendChannel.mockReset().mockResolvedValue('SENT');
    temporal.recordSkip.mockReset().mockResolvedValue(undefined);
    temporal.sleep.mockReset().mockResolvedValue(undefined);
    temporal.duringWait.mockReset();
    temporal.handlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pass each recipient their own in-app id, and the flow id, settings and source', async () => {
    await NotificationFlowWorkflow(input());

    const [first, , third] = temporal.sendChannel.mock.calls.map(([i]) => i);
    expect(first).toEqual({
      audience: AUDIENCE,
      recipientUserId: 'user-guardian-1',
      channel: 'PUSH',
      enabled: true,
      deferrable: true,
      content: { kind: 'single', message: MESSAGE, notificationId: 'notification-1' },
      // A device acknowledges the push by this id.
      data: { leaveId: 'leave-1', notificationId: 'notification-1' },
      flowId: 'notification-flow:NOTIFICATION:7:LEAVE_DECIDED',
      recipientsRef: REF,
    });
    expect(third).toEqual({
      ...first,
      channel: 'WHATSAPP',
      enabled: false,
      data: { leaveId: 'leave-1' },
    });
  });

  it('should end the flow on a signal from one of its recipients and record the rest', async () => {
    temporal.duringWait.mockImplementationOnce(() =>
      arrive({ recipientUserId: 'user-guardian-2', via: 'IN_APP' }),
    );

    await NotificationFlowWorkflow(input());

    expect(sends()).toEqual([
      ['user-guardian-1', 'PUSH'],
      ['user-guardian-2', 'PUSH'],
    ]);
    expect(skips()).toEqual([
      ['user-guardian-1', 'WHATSAPP', 'not_needed'],
      ['user-guardian-1', 'SMS', 'not_needed'],
      ['user-guardian-2', 'WHATSAPP', 'not_needed'],
      ['user-guardian-2', 'SMS', 'not_needed'],
    ]);
    expect(temporal.recordSkip.mock.calls[0]?.[0]).toEqual({
      audience: AUDIENCE,
      recipientUserId: 'user-guardian-1',
      notificationId: 'notification-1',
      type: 'LEAVE_DECIDED',
      channel: 'WHATSAPP',
      reason: 'not_needed',
      flowId: 'notification-flow:NOTIFICATION:7:LEAVE_DECIDED',
    });
  });

  it('should ignore a signal about someone who is not a recipient of the flow', async () => {
    temporal.duringWait.mockImplementation(() =>
      arrive({ recipientUserId: 'user-someone-else', via: 'WHATSAPP' }),
    );

    await NotificationFlowWorkflow(input());

    expect(sends()).toHaveLength(6);
    expect(skips()).toEqual([]);
  });

  it('should move on at once from a send that failed after its retries', async () => {
    temporal.sendChannel.mockImplementation((i) =>
      i.channel === 'WHATSAPP' && i.recipientUserId === 'user-guardian-1'
        ? Promise.reject(new Error('activity failed after its retries'))
        : Promise.resolve('SENT'),
    );

    await NotificationFlowWorkflow(input());

    // Waits: after the app step, after guardian 1's SMS, after guardian 2's WhatsApp.
    expect(temporal.duringWait.mock.calls.map(([ms]) => ms / 60_000)).toEqual([30, 5, 15]);
  });

  it('should wait out a deferral and try the channel again', async () => {
    temporal.sendChannel
      .mockResolvedValueOnce('SKIPPED')
      .mockResolvedValueOnce('SKIPPED')
      .mockResolvedValueOnce({ deferUntil: '2026-11-24T01:30:00.000Z', reason: 'quiet_hours' });

    await NotificationFlowWorkflow(input());

    expect(temporal.duringWait.mock.calls[0]).toEqual([8.5 * 60 * 60 * 1000]);
    expect(sends().slice(0, 4)).toEqual([
      ['user-guardian-1', 'PUSH'],
      ['user-guardian-2', 'PUSH'],
      ['user-guardian-1', 'WHATSAPP'],
      ['user-guardian-1', 'WHATSAPP'],
    ]);
  });

  it('should not send a deferred channel when someone was reached meanwhile', async () => {
    temporal.sendChannel
      .mockResolvedValueOnce('SKIPPED')
      .mockResolvedValueOnce('SKIPPED')
      .mockResolvedValueOnce({ deferUntil: '2026-11-24T01:30:00.000Z', reason: 'quiet_hours' });
    temporal.duringWait.mockImplementationOnce(() =>
      arrive({ recipientUserId: 'user-guardian-1', via: 'IN_APP' }),
    );

    await NotificationFlowWorkflow(input());

    expect(sends()).toEqual([
      ['user-guardian-1', 'PUSH'],
      ['user-guardian-2', 'PUSH'],
      ['user-guardian-1', 'WHATSAPP'],
    ]);
    expect(skips()).toEqual([
      ['user-guardian-1', 'WHATSAPP', 'not_needed'],
      ['user-guardian-1', 'SMS', 'not_needed'],
      ['user-guardian-2', 'WHATSAPP', 'not_needed'],
      ['user-guardian-2', 'SMS', 'not_needed'],
    ]);
  });

  it('should make the call after the last deferral final, then move on', async () => {
    temporal.sendChannel.mockImplementation((i) =>
      Promise.resolve(
        i.channel === 'WHATSAPP' && i.recipientUserId === 'user-guardian-1'
          ? i.deferrable
            ? { deferUntil: '2026-11-23T18:00:00.000Z', reason: 'quiet_hours' as const }
            : 'SKIPPED'
          : i.channel === 'PUSH'
            ? 'SKIPPED'
            : 'SENT',
      ),
    );

    await NotificationFlowWorkflow(input());

    const whatsapp = temporal.sendChannel.mock.calls
      .map(([i]) => i)
      .filter((i) => i.channel === 'WHATSAPP' && i.recipientUserId === 'user-guardian-1');
    expect(whatsapp.map((i) => i.deferrable)).toEqual([
      ...Array.from({ length: MAX_CHANNEL_DEFERRALS }, () => true),
      false,
    ]);
    // One wait per deferral, then the flow goes on: guardian 1's SMS is sent next.
    expect(sends()[2 + MAX_CHANNEL_DEFERRALS + 1]).toEqual(['user-guardian-1', 'SMS']);
  });

  it('should count holds by the rate or a paused provider apart from the 30 deferrals', async () => {
    let held = 0;
    temporal.sendChannel.mockImplementation((i) => {
      if (i.channel !== 'WHATSAPP' || i.recipientUserId !== 'user-guardian-1') {
        return Promise.resolve(i.channel === 'PUSH' ? 'SKIPPED' : 'SENT');
      }
      held += 1;
      return Promise.resolve(
        held <= MAX_CHANNEL_DEFERRALS + 5
          ? {
              deferUntil: '2026-11-23T18:00:00.000Z',
              reason: held % 2 === 0 ? ('rate_limited' as const) : ('provider_paused' as const),
            }
          : 'SENT',
      );
    });

    await NotificationFlowWorkflow(input());

    const whatsapp = temporal.sendChannel.mock.calls
      .map(([i]) => i)
      .filter((i) => i.channel === 'WHATSAPP' && i.recipientUserId === 'user-guardian-1');
    expect(whatsapp.map((i) => i.deferrable)).toEqual(
      Array.from({ length: MAX_CHANNEL_DEFERRALS + 6 }, () => true),
    );
  });

  it('should make the call after the last held deferral final', async () => {
    temporal.sendChannel.mockImplementation((i) =>
      Promise.resolve(
        i.channel === 'WHATSAPP' && i.recipientUserId === 'user-guardian-1'
          ? i.deferrable
            ? { deferUntil: '2026-11-23T18:00:00.000Z', reason: 'rate_limited' as const }
            : 'SKIPPED'
          : i.channel === 'PUSH'
            ? 'SKIPPED'
            : 'SENT',
      ),
    );

    await NotificationFlowWorkflow(input());

    const whatsapp = temporal.sendChannel.mock.calls
      .map(([i]) => i)
      .filter((i) => i.channel === 'WHATSAPP' && i.recipientUserId === 'user-guardian-1');
    expect(whatsapp.map((i) => i.deferrable)).toEqual([
      ...Array.from({ length: MAX_HELD_DEFERRALS }, () => true),
      false,
    ]);
  });
});

describe('NotificationDigestWorkflow', () => {
  const item = (dedupeKey: string): DigestItem => ({
    dedupeKey,
    message: {
      type: 'ATTENDANCE_ABSENT',
      params: {
        sessionId: dedupeKey,
        studentId: 'membership-student-1',
        studentName: null,
        status: 'ABSENT',
        markedAt: '09:05',
        sessionDate: null,
        sectionName: null,
        standardName: null,
      },
    },
    runAt: '2026-11-23T12:30:00.000Z',
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    temporal.sendChannel.mockReset().mockResolvedValue('SENT');
    temporal.recordSkip.mockReset().mockResolvedValue(undefined);
    temporal.sleep.mockReset().mockResolvedValue(undefined);
    temporal.duringWait.mockReset();
    temporal.handlers.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runDigest(appOnly: boolean) {
    const run = NotificationDigestWorkflow({
      audience: AUDIENCE,
      recipientUserId: 'user-guardian-1',
      type: 'ATTENDANCE_ABSENT',
      flow: guardianAlertFlow(),
      enabled: { EMAIL: true, PUSH: true, SMS: true, WHATSAPP: true },
      critical: false,
      appOnly,
      runAt: '2026-11-23T12:30:00.000Z',
    });
    temporal.handlers.get('digestItem')?.(item('s1'));
    await run;
  }

  it('should send one summary through the flow, with the digest workflow as its flow id', async () => {
    await runDigest(false);

    expect(sends()).toEqual([
      ['user-guardian-1', 'PUSH'],
      ['user-guardian-1', 'WHATSAPP'],
      ['user-guardian-1', 'SMS'],
    ]);
    const [push] = temporal.sendChannel.mock.calls.map(([i]) => i);
    expect(push?.flowId).toBe('notification-digest:t1:user-guardian-1:ATTENDANCE_ABSENT');
    expect(push?.recipientsRef).toBeNull();
    expect(push?.content.kind).toBe('digest');
  });

  it('should send a guardian after the first the app summary alone', async () => {
    await runDigest(true);

    expect(sends()).toEqual([['user-guardian-1', 'PUSH']]);
    expect(temporal.duringWait).not.toHaveBeenCalled();
  });

  it('should stop the summary when its WhatsApp is delivered', async () => {
    temporal.duringWait
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() =>
        arrive({ recipientUserId: 'user-guardian-1', via: 'WHATSAPP' }),
      );

    await runDigest(false);

    expect(sends()).toEqual([
      ['user-guardian-1', 'PUSH'],
      ['user-guardian-1', 'WHATSAPP'],
    ]);
    expect(skips()).toEqual([['user-guardian-1', 'SMS', 'not_needed']]);
  });
});

describe('WhatsAppTemplateSyncWorkflow', () => {
  const ACCOUNT = { providerAccountId: 'acct-1' };
  const requestSync = () => temporal.handlers.get(TEMPLATE_SYNC_REQUESTED_SIGNAL)?.(null);

  beforeEach(() => {
    temporal.handlers.clear();
    temporal.duringWait.mockReset();
    temporal.syncWhatsAppTemplates.mockReset();
  });

  it('should sync once and end when no template waits for a review', async () => {
    temporal.syncWhatsAppTemplates.mockResolvedValue({ pending: 0 });

    await WhatsAppTemplateSyncWorkflow(ACCOUNT);

    expect(temporal.syncWhatsAppTemplates).toHaveBeenCalledTimes(1);
    expect(temporal.syncWhatsAppTemplates).toHaveBeenCalledWith(ACCOUNT);
    expect(temporal.duringWait).not.toHaveBeenCalled();
  });

  it("should read the provider's list again while a template waits, then end when none does", async () => {
    temporal.syncWhatsAppTemplates
      .mockResolvedValueOnce({ pending: 2 })
      .mockResolvedValueOnce({ pending: 1 })
      .mockResolvedValueOnce({ pending: 0 });

    await WhatsAppTemplateSyncWorkflow(ACCOUNT);

    expect(temporal.syncWhatsAppTemplates).toHaveBeenCalledTimes(3);
    expect(temporal.duringWait.mock.calls.map(([ms]) => ms)).toEqual(
      TEMPLATE_RECHECK_WAITS_MS.slice(0, 2),
    );
  });

  it('should stop reading again after the last wait, however many still wait', async () => {
    temporal.syncWhatsAppTemplates.mockResolvedValue({ pending: 1 });

    await WhatsAppTemplateSyncWorkflow(ACCOUNT);

    expect(temporal.syncWhatsAppTemplates).toHaveBeenCalledTimes(
      TEMPLATE_RECHECK_WAITS_MS.length + 1,
    );
  });

  it('should sync again at once for a request that arrived during a sync', async () => {
    temporal.syncWhatsAppTemplates
      .mockImplementationOnce(async () => {
        requestSync();
        return { pending: 0 };
      })
      .mockResolvedValueOnce({ pending: 0 });

    await WhatsAppTemplateSyncWorkflow(ACCOUNT);

    expect(temporal.syncWhatsAppTemplates).toHaveBeenCalledTimes(2);
    expect(temporal.duringWait).not.toHaveBeenCalled();
  });
});
