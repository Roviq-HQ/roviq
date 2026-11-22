import { createMock } from '@roviq/testing';
import { ApplicationFailure } from '@temporalio/activity';
import { describe, expect, it, vi } from 'vitest';
import { ChannelSender } from '../../delivery/channel-sender';
import { createNotificationActivities } from '../notification.activities';
import type { SendChannelInput } from '../notification-workflow.types';

const INPUT: SendChannelInput = {
  audience: {
    scope: 'institute',
    tenantId: '019a0000-0000-7000-8000-000000000001',
    resellerId: null,
  },
  recipientUserId: 'user-guardian-1',
  channel: 'EMAIL',
  enabled: true,
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
};

describe('sendChannel activity', () => {
  it('should record the Temporal attempt number and look the address up', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SENT', provider: 'smtp', providerMessageId: null }),
    });

    const status = await createNotificationActivities(sender, () => 3).sendChannel(INPUT);

    expect(status).toBe('SENT');
    const [call] = sender.attempt.mock.calls;
    expect(call?.[0].attempt).toBe(3);
    expect(call?.[0].address).toBe('lookup');
    expect(call?.[0].notificationId).toBe('notification-1');
    expect(call?.[0].type).toBe('LEAVE_DECIDED');
  });

  it('should throw a retryable failure carrying only the error code', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'FAILED', provider: 'smtp', errorCode: 'EAUTH_535' }),
    });

    const result = createNotificationActivities(sender, () => 1).sendChannel(INPUT);

    await expect(result).rejects.toBeInstanceOf(ApplicationFailure);
    await expect(result).rejects.toMatchObject({ type: 'EAUTH_535', nonRetryable: false });
  });

  it('should compose a digest summary for a digest run', async () => {
    const sender = createMock<ChannelSender>({
      attempt: vi
        .fn()
        .mockResolvedValue({ status: 'SKIPPED', provider: null, skipReason: 'no_address' }),
    });

    await createNotificationActivities(sender, () => 1).sendChannel({
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
});
