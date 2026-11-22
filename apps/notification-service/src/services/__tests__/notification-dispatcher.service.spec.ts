import assert from 'node:assert';
import { EventBusService } from '@roviq/event-bus';
import { TemporalClientService } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSender } from '../../delivery/channel-sender';
import { NotificationConfigReadRepository } from '../../repositories/notification-config-read.repository';
import { NotificationWriteRepository } from '../../repositories/notification-write.repository';
import { RecipientReadRepository } from '../../repositories/recipient-read.repository';
import type { DeliveryOutcome } from '../../repositories/types';
import {
  NotificationDispatcher,
  type RegularDispatch,
  RetryWait,
  type SecretDispatch,
} from '../notification-dispatcher.service';

const TENANT = '019a0000-0000-7000-8000-000000000001';
const INSTITUTE = { scope: 'institute', tenantId: TENANT, resellerId: null } as const;
const GUARDIAN = { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' };
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
  recipient: GUARDIAN,
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
  recipient: GUARDIAN,
  source: SOURCE,
  inApp: true,
};

const SENT: DeliveryOutcome = { status: 'SENT', provider: 'log', providerMessageId: 'm1' };
const FAILED: DeliveryOutcome = { status: 'FAILED', provider: 'smtp', errorCode: 'ECONNECTION' };

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
    it('should store the in-app row and announce it', async () => {
      await dispatcher.dispatch(ABSENCE);

      expect(configs.findByTenantAndType).toHaveBeenCalledWith(TENANT, 'ATTENDANCE');
      expect(writes.insertInApp).toHaveBeenCalledWith({
        audience: INSTITUTE,
        recipient: GUARDIAN,
        type: 'ATTENDANCE_ABSENT',
        title: { en: 'Absence recorded', hi: 'अनुपस्थिति दर्ज' },
        body: {
          en: 'Your ward Aarav Sharma (Class 5-A) was marked absent on 10 April 2026. Please contact the institute if this is incorrect.',
          hi: '10 अप्रैल 2026 को आपके बच्चे Aarav Sharma (Class 5-A) को अनुपस्थित दर्ज किया गया। यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।',
        },
        data: {
          sessionId: 'session-1',
          studentId: 'membership-student-1',
          path: '/institute/attendance',
        },
        dedupeKey: 'NOTIFICATION:41:ATTENDANCE_ABSENT:user-guardian-1',
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
            channels: [
              { channel: 'WHATSAPP', enabled: true },
              { channel: 'EMAIL', enabled: true },
              { channel: 'PUSH', enabled: false },
            ],
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

    it('should key the row and the digest item by the business key the listener gives', async () => {
      const key = 'attendance:session-1:membership-student-1:ABSENT:user-guardian-1';

      await dispatcher.dispatch({ ...ABSENCE, dedupeKey: key });

      expect(writes.insertInApp).toHaveBeenCalledWith({
        audience: INSTITUTE,
        recipient: GUARDIAN,
        type: 'ATTENDANCE_ABSENT',
        title: { en: 'Absence recorded', hi: 'अनुपस्थिति दर्ज' },
        body: {
          en: 'Your ward Aarav Sharma (Class 5-A) was marked absent on 10 April 2026. Please contact the institute if this is incorrect.',
          hi: '10 अप्रैल 2026 को आपके बच्चे Aarav Sharma (Class 5-A) को अनुपस्थित दर्ज किया गया। यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।',
        },
        data: {
          sessionId: 'session-1',
          studentId: 'membership-student-1',
          path: '/institute/attendance',
        },
        dedupeKey: key,
      });
      expect(temporal.signalWithStart).toHaveBeenCalledWith('NotificationDigestWorkflow', {
        workflowId: `notification-digest:${TENANT}:user-guardian-1:ATTENDANCE_ABSENT`,
        taskQueue: 'notifications',
        args: [
          {
            audience: INSTITUTE,
            recipientUserId: 'user-guardian-1',
            type: 'ATTENDANCE_ABSENT',
            channels: [
              { channel: 'WHATSAPP', enabled: true },
              { channel: 'EMAIL', enabled: true },
              { channel: 'PUSH', enabled: false },
            ],
            runAt: '2026-04-10T12:30:00.000Z',
          },
        ],
        signal: 'digestItem',
        signalArgs: [
          { dedupeKey: key, message: ABSENCE.message, runAt: '2026-04-10T12:30:00.000Z' },
        ],
      });
    });

    it('should derive the delivery workflow id from the business key the listener gives', async () => {
      await dispatcher.dispatch({ ...REMINDER, dedupeKey: 'business-key-1' });

      expect(temporal.startWorkflowOnce).toHaveBeenCalledWith('NotificationDeliveryWorkflow', {
        workflowId: 'notification-delivery:business-key-1',
        taskQueue: 'notifications',
        args: [
          {
            audience: INSTITUTE,
            recipientUserId: 'user-guardian-1',
            message: REMINDER.message,
            notificationId: 'notification-1',
            channels: [
              { channel: 'EMAIL', enabled: true },
              { channel: 'WHATSAPP', enabled: true },
              { channel: 'PUSH', enabled: false },
            ],
            data: {
              feeId: 'fee-1',
              studentId: 'membership-student-1',
              path: '/institute/dashboard',
            },
          },
        ],
      });
    });

    it('should start one delivery workflow keyed by the event for a type without a digest', async () => {
      await dispatcher.dispatch(REMINDER);

      expect(temporal.startWorkflowOnce).toHaveBeenCalledWith('NotificationDeliveryWorkflow', {
        workflowId: 'notification-delivery:NOTIFICATION:41:FEE_REMINDER:user-guardian-1',
        taskQueue: 'notifications',
        args: [
          {
            audience: INSTITUTE,
            recipientUserId: 'user-guardian-1',
            message: REMINDER.message,
            notificationId: 'notification-1',
            channels: [
              { channel: 'EMAIL', enabled: true },
              { channel: 'WHATSAPP', enabled: true },
              { channel: 'PUSH', enabled: false },
            ],
            data: {
              feeId: 'fee-1',
              studentId: 'membership-student-1',
              path: '/institute/dashboard',
            },
          },
        ],
      });
    });

    it('should skip the in-app row when the institute turned in-app off', async () => {
      configs.findByTenantAndType.mockResolvedValue({
        inAppEnabled: false,
        whatsappEnabled: false,
        emailEnabled: true,
        pushEnabled: false,
        digestEnabled: false,
        digestCron: null,
      });

      await dispatcher.dispatch(ABSENCE);

      expect(writes.insertInApp).not.toHaveBeenCalled();
      expect(temporal.startWorkflowOnce).toHaveBeenCalledWith('NotificationDeliveryWorkflow', {
        workflowId: 'notification-delivery:NOTIFICATION:41:ATTENDANCE_ABSENT:user-guardian-1',
        taskQueue: 'notifications',
        args: [
          {
            audience: INSTITUTE,
            recipientUserId: 'user-guardian-1',
            message: ABSENCE.message,
            notificationId: null,
            channels: [
              { channel: 'WHATSAPP', enabled: false },
              { channel: 'EMAIL', enabled: true },
              { channel: 'PUSH', enabled: false },
            ],
            data: {
              sessionId: 'session-1',
              studentId: 'membership-student-1',
              path: '/institute/attendance',
            },
          },
        ],
      });
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
      const { compose, ...attempt } = call[0];
      expect(attempt).toEqual({
        type: 'EMAIL_VERIFICATION',
        channel: 'EMAIL',
        audience: { scope: 'platform', tenantId: null, resellerId: null },
        recipientUserId: 'user-1',
        notificationId: null,
        channelEnabled: true,
        attempt: 1,
        address: { given: 'new-address@example.in' },
        data: {},
      });
      expect(compose('en').body).toContain('482913');
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

    it('should let a database failure propagate', async () => {
      sender.attempt.mockRejectedValue(new Error('connection terminated'));

      await expect(dispatcher.dispatchSecret(VERIFICATION)).rejects.toThrow(
        'connection terminated',
      );
    });
  });
});
