import assert from 'node:assert';
import { EventBusService } from '@roviq/event-bus';
import { TemporalClientService } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSender } from '../../delivery/channel-sender';
import { smsDraftForSecret } from '../../delivery/sms/sms-templates';
import { NotificationConfigReadRepository } from '../../repositories/notification-config-read.repository';
import { NotificationWriteRepository } from '../../repositories/notification-write.repository';
import { RecipientReadRepository } from '../../repositories/recipient-read.repository';
import type { DeliveryOutcome } from '../../repositories/types';
import { guardianAlertFlow } from '../../types/flow';
import type {
  DigestWorkflowInput,
  FlowWorkflowInput,
} from '../../workflows/notification-workflow.types';
import {
  NotificationDispatcher,
  type RegularDispatch,
  RetryWait,
  type SecretDispatch,
} from '../notification-dispatcher.service';

const TENANT = '019a0000-0000-7000-8000-000000000001';
const INSTITUTE = { scope: 'institute', tenantId: TENANT, resellerId: null } as const;
const GUARDIAN = { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' };
const SECOND = { userId: 'user-guardian-2', membershipId: 'membership-guardian-2' };
const SOURCE = { stream: 'NOTIFICATION', sequence: 41 };
const NOW = new Date('2026-04-10T05:00:00.000Z');

const ABSENCE: RegularDispatch = {
  message: {
    type: 'ATTENDANCE_ABSENT',
    params: {
      sessionId: 'session-1',
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      status: 'ABSENT',
      markedAt: '2026-04-10T03:35:00.000Z',
      sessionDate: '2026-04-10',
      sectionName: 'A',
      standardName: 'Class 5',
    },
  },
  audience: INSTITUTE,
  recipients: [GUARDIAN],
  recipientsRef: { kind: 'guardians_of_student', studentMembershipId: 'membership-student-1' },
  source: SOURCE,
  inApp: true,
};

const REMINDER: RegularDispatch = {
  message: {
    type: 'FEE_REMINDER',
    params: {
      studentId: 'membership-student-1',
      studentName: 'Aarav Sharma',
      feeId: 'fee-1',
      amount: 5000,
      currency: 'INR',
      dueDate: '2026-04-20',
      feeType: 'Tuition',
      feePeriod: 'April 2026',
    },
  },
  audience: INSTITUTE,
  recipients: [GUARDIAN],
  recipientsRef: { kind: 'guardians_of_student', studentMembershipId: 'membership-student-1' },
  source: SOURCE,
  inApp: true,
};

function isDigestInput(value: unknown): value is DigestWorkflowInput {
  return typeof value === 'object' && value !== null && 'appOnly' in value;
}
function isFlowInput(value: unknown): value is FlowWorkflowInput {
  return typeof value === 'object' && value !== null && 'flowId' in value;
}

const SENT: DeliveryOutcome = { status: 'SENT', provider: 'log', providerMessageId: 'm1' };
const FAILED: DeliveryOutcome = {
  status: 'FAILED',
  provider: 'smtp',
  errorCode: 'ECONNECTION',
  retryable: true,
};

describe('NotificationDispatcher', () => {
  let configs: ReturnType<typeof createMock<NotificationConfigReadRepository>>;
  let recipients: ReturnType<typeof createMock<RecipientReadRepository>>;
  let writes: ReturnType<typeof createMock<NotificationWriteRepository>>;
  let sender: ReturnType<typeof createMock<ChannelSender>>;
  let temporal: ReturnType<typeof createMock<TemporalClientService>>;
  let eventBus: ReturnType<typeof createMock<EventBusService>>;
  let retryWait: ReturnType<typeof createMock<RetryWait>>;
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    configs = createMock<NotificationConfigReadRepository>({
      findByTenantAndType: vi.fn().mockResolvedValue(null),
    });
    recipients = createMock<RecipientReadRepository>({
      findInstituteTimezone: vi.fn().mockResolvedValue('Asia/Kolkata'),
    });
    writes = createMock<NotificationWriteRepository>({
      insertInApp: vi.fn().mockResolvedValue({ id: 'notification-1', created: true }),
    });
    sender = createMock<ChannelSender>({ attempt: vi.fn().mockResolvedValue(SENT) });
    temporal = createMock<TemporalClientService>({
      startWorkflowOnce: vi.fn().mockResolvedValue(true),
      signalWithStart: vi.fn().mockResolvedValue('run-1'),
    });
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    retryWait = createMock<RetryWait>({ wait: vi.fn().mockResolvedValue(undefined) });
    dispatcher = new NotificationDispatcher(
      configs,
      recipients,
      writes,
      sender,
      temporal,
      eventBus,
      retryWait,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('dispatch', () => {
    const ABSENCE_COPY = {
      title: { en: 'Absence recorded', hi: 'ऐब्सेंट दर्ज' },
      body: {
        en: 'Your ward Aarav Sharma (Class 5-A) was marked absent on 10 April 2026. Please contact the institute if this is incorrect.',
        hi: '10 अप्रैल 2026 को आपके बच्चे Aarav Sharma (Class 5-A) को ऐब्सेंट दर्ज किया गया। यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।',
      },
      data: {
        sessionId: 'session-1',
        studentId: 'membership-student-1',
        path: '/institute/attendance',
      },
    };
    const NO_DIGEST = {
      inAppEnabled: true,
      whatsappEnabled: true,
      emailEnabled: true,
      pushEnabled: true,
      digestEnabled: false,
      digestCron: null,
    };

    it('should store the in-app row and announce it', async () => {
      await dispatcher.dispatch(ABSENCE);

      expect(configs.findByTenantAndType).toHaveBeenCalledWith(TENANT, 'ATTENDANCE');
      expect(writes.insertInApp).toHaveBeenCalledWith({
        audience: INSTITUTE,
        recipient: GUARDIAN,
        type: 'ATTENDANCE_ABSENT',
        ...ABSENCE_COPY,
        dedupeKey: 'NOTIFICATION:41:ATTENDANCE_ABSENT:user-guardian-1',
        // A digest walks no flow, so no workflow waits for this row to be seen.
        flowId: null,
      });
      expect(eventBus.emit).toHaveBeenCalledWith('NOTIFICATION.inapp.created', {
        notificationId: 'notification-1',
        scope: 'institute',
        tenantId: TENANT,
        resellerId: null,
        recipientUserId: 'user-guardian-1',
      });
    });

    it('should not announce a row a redelivered event already stored', async () => {
      writes.insertInApp.mockResolvedValue({ id: 'notification-1', created: false });

      await dispatcher.dispatch(REMINDER);

      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(temporal.startWorkflowOnce).toHaveBeenCalledTimes(1);
    });

    it('should collect an absence into the digest that closes at 18:00 institute time', async () => {
      await dispatcher.dispatch(ABSENCE);

      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
      expect(temporal.signalWithStart).toHaveBeenCalledWith('NotificationDigestWorkflow', {
        workflowId: `notification-digest:${TENANT}:user-guardian-1:ATTENDANCE_ABSENT`,
        taskQueue: 'notifications',
        args: [
          {
            audience: INSTITUTE,
            recipientUserId: 'user-guardian-1',
            type: 'ATTENDANCE_ABSENT',
            flow: guardianAlertFlow(),
            enabled: { EMAIL: true, PUSH: false, SMS: true, WHATSAPP: true },
            critical: false,
            appOnly: false,
            runAt: '2026-04-10T12:30:00.000Z',
          },
        ],
        signal: 'digestItem',
        signalArgs: [
          {
            dedupeKey: 'NOTIFICATION:41:ATTENDANCE_ABSENT:user-guardian-1',
            message: ABSENCE.message,
            runAt: '2026-04-10T12:30:00.000Z',
          },
        ],
      });
    });

    it('should collect a digest per guardian, the later ones by the app alone', async () => {
      await dispatcher.dispatch({ ...ABSENCE, recipients: [GUARDIAN, SECOND] });

      const started = temporal.signalWithStart.mock.calls.map(([, options]) => {
        const [input] = options.args;
        assert(isDigestInput(input));
        return [options.workflowId, input.recipientUserId, input.appOnly];
      });
      expect(started).toEqual([
        [
          `notification-digest:${TENANT}:user-guardian-1:ATTENDANCE_ABSENT`,
          'user-guardian-1',
          false,
        ],
        [
          `notification-digest:${TENANT}:user-guardian-2:ATTENDANCE_ABSENT`,
          'user-guardian-2',
          true,
        ],
      ]);
    });

    it('should key each in-app row and digest item by the event key and the recipient', async () => {
      const key = 'attendance:session-1:membership-student-1:ABSENT';

      await dispatcher.dispatch({ ...ABSENCE, dedupeKey: key });

      expect(writes.insertInApp).toHaveBeenCalledWith({
        audience: INSTITUTE,
        recipient: GUARDIAN,
        type: 'ATTENDANCE_ABSENT',
        ...ABSENCE_COPY,
        dedupeKey: `${key}:user-guardian-1`,
        flowId: null,
      });
      expect(temporal.signalWithStart.mock.calls.map(([, options]) => options.signalArgs)).toEqual([
        [
          {
            dedupeKey: `${key}:user-guardian-1`,
            message: ABSENCE.message,
            runAt: '2026-04-10T12:30:00.000Z',
          },
        ],
      ]);
    });

    it('should start one flow for all guardians, keyed by the event, with ids only', async () => {
      configs.findByTenantAndType.mockResolvedValue(NO_DIGEST);
      writes.insertInApp
        .mockResolvedValueOnce({ id: 'notification-1', created: true })
        .mockResolvedValueOnce({ id: 'notification-2', created: true });

      await dispatcher.dispatch({
        ...ABSENCE,
        recipients: [GUARDIAN, SECOND],
        dedupeKey: 'attendance:session-1:membership-student-1:ABSENT',
      });

      const flowId = 'notification-flow:attendance:session-1:membership-student-1:ABSENT';
      expect(writes.insertInApp.mock.calls.map(([row]) => [row.dedupeKey, row.flowId])).toEqual([
        ['attendance:session-1:membership-student-1:ABSENT:user-guardian-1', flowId],
        ['attendance:session-1:membership-student-1:ABSENT:user-guardian-2', flowId],
      ]);
      expect(temporal.startWorkflowOnce.mock.calls).toEqual([
        [
          'NotificationFlowWorkflow',
          {
            workflowId: flowId,
            taskQueue: 'notifications',
            args: [
              {
                flowId,
                audience: INSTITUTE,
                message: ABSENCE.message,
                recipients: [
                  { userId: 'user-guardian-1', notificationId: 'notification-1' },
                  { userId: 'user-guardian-2', notificationId: 'notification-2' },
                ],
                recipientsRef: ABSENCE.recipientsRef,
                flow: guardianAlertFlow(),
                enabled: { EMAIL: true, PUSH: true, SMS: true, WHATSAPP: true },
                critical: false,
                data: ABSENCE_COPY.data,
              },
            ],
          },
        ],
      ]);
      expect(temporal.signalWithStart).not.toHaveBeenCalled();
    });

    it('should key the flow by the event stream sequence and type without a business key', async () => {
      await dispatcher.dispatch(REMINDER);

      expect(
        temporal.startWorkflowOnce.mock.calls.map(([type, options]) => [type, options.workflowId]),
      ).toEqual([['NotificationFlowWorkflow', 'notification-flow:NOTIFICATION:41:FEE_REMINDER']]);
      expect(writes.insertInApp.mock.calls.map(([row]) => row.dedupeKey)).toEqual([
        'NOTIFICATION:41:FEE_REMINDER:user-guardian-1',
      ]);
    });

    it('should skip the in-app row when the institute turned in-app off, and still start the flow', async () => {
      configs.findByTenantAndType.mockResolvedValue({ ...NO_DIGEST, inAppEnabled: false });

      await dispatcher.dispatch(ABSENCE);

      expect(writes.insertInApp).not.toHaveBeenCalled();
      const [call] = temporal.startWorkflowOnce.mock.calls;
      assert(call);
      const [input] = call[1].args ?? [];
      assert(isFlowInput(input));
      expect(input.recipients).toEqual([{ userId: 'user-guardian-1', notificationId: null }]);
    });

    it('should start no workflow for a type with no channel outside the app', async () => {
      await dispatcher.dispatch({
        message: {
          type: 'AUTH_LOGIN',
          params: { ip: null, at: '2026-04-10T05:00:00.000Z', accountPath: '/institute/account' },
        },
        audience: INSTITUTE,
        recipients: [GUARDIAN],
        recipientsRef: null,
        source: SOURCE,
        inApp: true,
      });

      expect(writes.insertInApp.mock.calls.map(([row]) => row.flowId)).toEqual([null]);
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
    });

    it('should do nothing for an event with no recipient', async () => {
      await dispatcher.dispatch({ ...REMINDER, recipients: [] });

      expect(writes.insertInApp).not.toHaveBeenCalled();
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
    });
  });

  describe('dispatchSecret', () => {
    const VERIFICATION: SecretDispatch = {
      message: { type: 'EMAIL_VERIFICATION', params: { code: '482913' } },
      audience: { scope: 'platform', tenantId: null, resellerId: null },
      recipientUserId: 'user-1',
      addresses: { EMAIL: 'new-address@example.in' },
    };

    it('should send at once and never call Temporal', async () => {
      await dispatcher.dispatchSecret(VERIFICATION);

      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
      expect(temporal.signalWithStart).not.toHaveBeenCalled();
      expect(writes.insertInApp).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(sender.attempt).toHaveBeenCalledTimes(1);
      const [call] = sender.attempt.mock.calls;
      assert(call);
      const { compose, sms, ...attempt } = call[0];
      expect(attempt).toEqual({
        type: 'EMAIL_VERIFICATION',
        channel: 'EMAIL',
        audience: { scope: 'platform', tenantId: null, resellerId: null },
        recipientUserId: 'user-1',
        notificationId: null,
        flowId: null,
        channelEnabled: true,
        critical: true,
        digest: false,
        deferrable: false,
        attempt: 1,
        address: { given: 'new-address@example.in' },
        data: {},
      });
      expect(compose('en').body).toContain('482913');
      assert(sms);
      expect(sms('en')).toBeNull();
    });

    it('should give the registered SMS template of the message', async () => {
      const message = { type: 'IMPERSONATION_OTP', params: { otp: '771204' } } as const;
      await dispatcher.dispatchSecret({
        message,
        audience: INSTITUTE,
        recipientUserId: 'user-admin-1',
        addresses: { SMS: '+919800000001', EMAIL: 'admin@example.in' },
      });

      const smsCall = sender.attempt.mock.calls.find(([a]) => a.channel === 'SMS');
      assert(smsCall);
      const sms = smsCall[0].sms;
      assert(sms);
      const expected = smsDraftForSecret(message, 'hi');
      expect(expected).not.toBeNull();
      expect(sms('hi')).toEqual(expected);
    });

    it('should look up the address of a channel the event does not name', async () => {
      await dispatcher.dispatchSecret({
        message: { type: 'IMPERSONATION_OTP', params: { otp: '771204' } },
        audience: INSTITUTE,
        recipientUserId: 'user-admin-1',
        addresses: { SMS: null },
      });

      const addresses = sender.attempt.mock.calls.map(([a]) => [a.channel, a.address]);
      expect(addresses).toEqual([
        ['SMS', { given: null }],
        ['EMAIL', 'lookup'],
      ]);
    });

    it('should try a failing channel three times with backoff and not throw', async () => {
      sender.attempt.mockResolvedValue(FAILED);

      await expect(dispatcher.dispatchSecret(VERIFICATION)).resolves.toBeUndefined();

      expect(sender.attempt.mock.calls.map(([a]) => a.attempt)).toEqual([1, 2, 3]);
      expect(retryWait.wait.mock.calls).toEqual([[1_000], [3_000]]);
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
    });

    it('should stop retrying once an attempt succeeds', async () => {
      sender.attempt.mockResolvedValueOnce(FAILED).mockResolvedValueOnce(SENT);

      await dispatcher.dispatchSecret(VERIFICATION);

      expect(sender.attempt.mock.calls.map(([a]) => a.attempt)).toEqual([1, 2]);
    });

    it('should not retry a failure the provider would refuse again', async () => {
      sender.attempt.mockResolvedValue({ ...FAILED, retryable: false });

      await dispatcher.dispatchSecret(VERIFICATION);

      expect(sender.attempt.mock.calls.map(([a]) => a.attempt)).toEqual([1]);
      expect(retryWait.wait).not.toHaveBeenCalled();
    });

    it('should let a database failure propagate', async () => {
      sender.attempt.mockRejectedValue(new Error('connection terminated'));

      await expect(dispatcher.dispatchSecret(VERIFICATION)).rejects.toThrow(
        'connection terminated',
      );
    });
  });
});
