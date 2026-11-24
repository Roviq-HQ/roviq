import assert from 'node:assert';
import { createMock } from '@roviq/testing';
import { ApplicationFailure } from '@temporalio/activity';
import { describe, expect, it, vi } from 'vitest';
import { ChannelSender } from '../../delivery/channel-sender';
import { smsDraftForRegular } from '../../delivery/sms/sms-templates';
import {
  whatsappDigestTemplateFor,
  whatsappTemplateFor,
} from '../../delivery/whatsapp/whatsapp-templates';
import type { NotificationWriteRepository } from '../../repositories/notification-write.repository';
import type { RecipientReadRepository } from '../../repositories/recipient-read.repository';
import type { RegularDigest, RegularMessage } from '../../types/compose';
import { createNotificationActivities } from '../notification.activities';
import type { SendChannelInput } from '../notification-workflow.types';

const INPUT_MESSAGE = {
  type: 'LEAVE_DECIDED',
  params: {
    leaveId: 'leave-1',
    status: 'APPROVED',
    audience: 'applicant',
    applicantName: 'Priya Verma',
    startDate: '2026-04-20',
    endDate: '2026-04-21',
  },
} as const;

const INPUT: SendChannelInput = {
  audience: {
    scope: 'institute',
    tenantId: '019a0000-0000-7000-8000-000000000001',
    resellerId: null,
  },
  recipientUserId: 'user-guardian-1',
  channel: 'EMAIL',
  enabled: true,
  deferrable: true,
  content: {
    kind: 'single',
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
  },
  data: { leaveId: 'leave-1' },
  flowId: 'notification-flow:key-1',
  recipientsRef: null,
};

const STUDENT = 'membership-student-1';

function deps(
  sender: ChannelSender,
  recipients = createMock<RecipientReadRepository>(),
  writes = createMock<NotificationWriteRepository>(),
) {
  return { sender, recipients, writes };
}

describe('sendChannel activity', () => {
  it('should record the Temporal attempt number and look the address up', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'smtp', providerMessageId: null }),
    });

    const status = await createNotificationActivities(deps(sender), () => 3).sendChannel(INPUT);

    expect(status).toBe('SENT');
    const [call] = sender.attempt.mock.calls;
    expect(call?.[0].attempt).toBe(3);
    expect(call?.[0].address).toBe('lookup');
    expect(call?.[0].notificationId).toBe('notification-1');
    expect(call?.[0].type).toBe('LEAVE_DECIDED');
    expect(call?.[0].flowId).toBe('notification-flow:key-1');
  });

  it('should send to a guardian still linked to the student', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });
    const recipients = createMock<RecipientReadRepository>({
      isActiveGuardianOf: vi.fn().mockResolvedValue(true),
    });

    const status = await createNotificationActivities(
      deps(sender, recipients),
      () => 1,
    ).sendChannel({
      ...INPUT,
      recipientsRef: { kind: 'guardians_of_student', studentMembershipId: STUDENT },
    });

    expect(status).toBe('SENT');
    expect(recipients.isActiveGuardianOf).toHaveBeenCalledWith(
      '019a0000-0000-7000-8000-000000000001',
      STUDENT,
      'user-guardian-1',
    );
  });

  it('should not send to a guardian unlinked since the flow started, and record why', async () => {
    const sender = createMock<ChannelSender>();
    const recipients = createMock<RecipientReadRepository>({
      isActiveGuardianOf: vi.fn().mockResolvedValue(false),
    });
    const writes = createMock<NotificationWriteRepository>({
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    });

    const status = await createNotificationActivities(
      deps(sender, recipients, writes),
      () => 1,
    ).sendChannel({
      ...INPUT,
      channel: 'WHATSAPP',
      recipientsRef: { kind: 'guardians_of_student', studentMembershipId: STUDENT },
    });

    expect(status).toBe('SKIPPED');
    expect(sender.attempt).not.toHaveBeenCalled();
    expect(writes.recordDelivery.mock.calls).toEqual([
      [
        {
          audience: INPUT.audience,
          notificationId: 'notification-1',
          recipientUserId: 'user-guardian-1',
          type: 'LEAVE_DECIDED',
          channel: 'WHATSAPP',
          attempt: 1,
          outcome: { status: 'SKIPPED', provider: null, skipReason: 'recipient_removed' },
          flowId: 'notification-flow:key-1',
        },
      ],
    ]);
  });

  it('should throw a retryable failure carrying only the error code', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi.fn().mockResolvedValue({
        status: 'FAILED',
        provider: 'smtp',
        errorCode: 'EAUTH_535',
        retryable: true,
      }),
    });

    const result = createNotificationActivities(deps(sender), () => 1).sendChannel(INPUT);

    await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
    await expect(result).rejects.toMatchObject({ type: 'EAUTH_535', nonRetryable: false });
  });

  it('should compose a digest summary for a digest run', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SKIPPED', provider: null, skipReason: 'no_address' }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({
      ...INPUT,
      content: {
        kind: 'digest',
        digest: {
          type: 'ATTENDANCE_ABSENT',
          items: [
            {
              sessionId: 's1',
              studentId: 'm1',
              studentName: null,
              status: 'ABSENT',
              markedAt: '09:05',
              sessionDate: null,
              sectionName: null,
              standardName: null,
            },
            {
              sessionId: 's2',
              studentId: 'm1',
              studentName: null,
              status: 'LATE',
              markedAt: '09:40',
              sessionDate: null,
              sectionName: null,
              standardName: null,
            },
          ],
        },
      },
    });

    const [call] = sender.attempt.mock.calls;
    expect(call?.[0].notificationId).toBeNull();
    expect(call?.[0].compose('en')).toEqual({
      subject: 'Attendance alerts: 1 absence, 1 late arrival',
      body: '2 attendance alerts were recorded today.',
    });
  });

  it('should return the deferral time as an ISO string', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi.fn().mockResolvedValue({
        status: 'DEFERRED',
        until: new Date('2026-11-24T01:30:00.000Z'),
        reason: 'quiet_hours',
      }),
    });

    const result = await createNotificationActivities(deps(sender), () => 1).sendChannel(INPUT);

    expect(result).toEqual({ deferUntil: '2026-11-24T01:30:00.000Z', reason: 'quiet_hours' });
  });

  it('should throw a non-retryable failure when the provider would refuse again', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi.fn().mockResolvedValue({
        status: 'FAILED',
        provider: 'whatsapp_cloud',
        errorCode: 'WA_TEMPLATE_REJECTED',
        retryable: false,
      }),
    });

    const result = createNotificationActivities(deps(sender), () => 1).sendChannel(INPUT);

    await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
    await expect(result).rejects.toMatchObject({
      type: 'WA_TEMPLATE_REJECTED',
      nonRetryable: true,
    });
  });

  it.each([
    [
      'AUTH_NEW_DEVICE',
      true,
      {
        type: 'AUTH_NEW_DEVICE',
        params: { ip: null, at: '2026-11-23T05:00:00.000Z', accountPath: '/institute/account' },
      },
    ],
    ['LEAVE_DECIDED', false, INPUT_MESSAGE],
  ] as const)('should take critical for %s from the type registry (%s)', async (_type, critical, message) => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({
      ...INPUT,
      content: { kind: 'single', message, notificationId: null },
    });

    expect(sender.attempt.mock.calls.map(([a]) => a.critical)).toEqual([critical]);
  });

  it('should give the registry template of a single message', async () => {
    const message: RegularMessage<'FEE_REMINDER'> = {
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
    };
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({
      ...INPUT,
      channel: 'WHATSAPP',
      content: { kind: 'single', message, notificationId: null },
    });

    const [call] = sender.attempt.mock.calls;
    assert(call);
    const template = call[0].template;
    assert(template);
    const expected = whatsappTemplateFor(message, 'hi');
    expect(expected).not.toBeNull();
    expect(template('hi')).toEqual(expected);
  });

  it('should give the registry SMS draft of a single message', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({
      ...INPUT,
      channel: 'SMS',
    });

    const [call] = sender.attempt.mock.calls;
    assert(call);
    const sms = call[0].sms;
    assert(sms);
    expect(sms('en')).toBe(smsDraftForRegular(INPUT_MESSAGE, 'en'));
  });

  it('should give no SMS draft for a digest run', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({
      ...INPUT,
      channel: 'SMS',
      content: { kind: 'digest', digest: { type: 'LEAVE_DECIDED', items: [INPUT_MESSAGE.params] } },
    });

    const [call] = sender.attempt.mock.calls;
    assert(call);
    const sms = call[0].sms;
    assert(sms);
    expect(sms('en')).toBeNull();
  });

  it('should give the registry digest template of a digest run', async () => {
    const absence = {
      studentId: 'm1',
      studentName: 'Aarav Sharma',
      markedAt: '09:05',
      sessionDate: '2026-04-10',
      sectionName: 'A',
      standardName: 'Class 5',
    };
    const digest: RegularDigest<'ATTENDANCE_ABSENT'> = {
      type: 'ATTENDANCE_ABSENT',
      items: [
        { ...absence, sessionId: 's1', status: 'ABSENT' },
        { ...absence, sessionId: 's2', status: 'LATE', markedAt: '09:40' },
      ],
    };
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({
      ...INPUT,
      channel: 'WHATSAPP',
      content: { kind: 'digest', digest },
    });

    const [call] = sender.attempt.mock.calls;
    assert(call);
    const template = call[0].template;
    assert(template);
    const expected = whatsappDigestTemplateFor(digest, 'en');
    expect(expected).not.toBeNull();
    expect(template('en')).toEqual(expected);
  });

  it.each([true, false])('should pass deferrable %s through to the attempt', async (deferrable) => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });

    await createNotificationActivities(deps(sender), () => 1).sendChannel({ ...INPUT, deferrable });

    expect(sender.attempt.mock.calls.map(([a]) => a.deferrable)).toEqual([deferrable]);
  });

  it('should mark a digest run as a digest and a single message as not', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'log', providerMessageId: null }),
    });
    const activities = createNotificationActivities(deps(sender), () => 1);

    await activities.sendChannel(INPUT);
    await activities.sendChannel({
      ...INPUT,
      content: { kind: 'digest', digest: { type: 'LEAVE_DECIDED', items: [INPUT_MESSAGE.params] } },
    });

    expect(sender.attempt.mock.calls.map(([a]) => a.digest)).toEqual([false, true]);
  });
});

describe('recordSkip activity', () => {
  it('should write one SKIPPED row with the reason and the flow id', async () => {
    const writes = createMock<NotificationWriteRepository>({
      recordDelivery: vi.fn().mockResolvedValue(undefined),
    });

    await createNotificationActivities(
      deps(createMock<ChannelSender>(), createMock<RecipientReadRepository>(), writes),
      () => 4,
    ).recordSkip({
      audience: INPUT.audience,
      recipientUserId: 'user-guardian-2',
      notificationId: 'notification-2',
      type: 'ATTENDANCE_ABSENT',
      channel: 'SMS',
      reason: 'not_needed',
      flowId: 'notification-flow:key-1',
    });

    expect(writes.recordDelivery.mock.calls).toEqual([
      [
        {
          audience: INPUT.audience,
          notificationId: 'notification-2',
          recipientUserId: 'user-guardian-2',
          type: 'ATTENDANCE_ABSENT',
          channel: 'SMS',
          attempt: 1,
          outcome: { status: 'SKIPPED', provider: null, skipReason: 'not_needed' },
          flowId: 'notification-flow:key-1',
        },
      ],
    ]);
  });
});
