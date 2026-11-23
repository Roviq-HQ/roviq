import type { JetStreamContext } from '@roviq/nats-jetstream';
import type { AttendanceAbsentEvent } from '@roviq/notifications';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDispatcher } from '../../services/notification-dispatcher.service';
import { RecipientResolver } from '../../services/recipient-resolver.service';
import { AttendanceListener } from '../attendance.listener';

const TENANT = '019a0000-0000-7000-8000-000000000001';
const STUDENT = '019a0000-0000-7000-8000-000000000002';

function makeEvent(overrides: Partial<AttendanceAbsentEvent> = {}): AttendanceAbsentEvent {
  return {
    tenantId: TENANT,
    sessionId: 'session-42',
    studentId: STUDENT,
    studentName: 'Aarav Sharma',
    status: 'ABSENT',
    remarks: null,
    markedAt: '2026-03-07T09:05:00.000Z',
    sessionDate: '2026-03-07',
    sectionName: 'A',
    standardName: 'Class 5',
    ...overrides,
  };
}

function makeCtx(): JetStreamContext {
  return createMock<JetStreamContext>({
    getStream: vi.fn().mockReturnValue('NOTIFICATION'),
    getSequence: vi.fn().mockReturnValue({ stream: 41, consumer: 3 }),
  });
}

describe('AttendanceListener', () => {
  let dispatcher: ReturnType<typeof createMock<NotificationDispatcher>>;
  let recipients: ReturnType<typeof createMock<RecipientResolver>>;
  let listener: AttendanceListener;

  beforeEach(() => {
    dispatcher = createMock<NotificationDispatcher>({
      dispatch: vi.fn().mockResolvedValue(undefined),
    });
    recipients = createMock<RecipientResolver>({
      guardiansOfStudent: vi.fn().mockResolvedValue([]),
    });
    listener = new AttendanceListener(dispatcher, recipients);
  });

  it('should dispatch one institute notification per linked guardian', async () => {
    recipients.guardiansOfStudent.mockResolvedValue([
      {
        recipient: { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' },
        appOnly: false,
      },
      {
        recipient: { userId: 'user-guardian-2', membershipId: 'membership-guardian-2' },
        appOnly: true,
      },
    ]);

    await listener.handleAbsent(makeEvent(), makeCtx());

    expect(recipients.guardiansOfStudent).toHaveBeenCalledWith(TENANT, STUDENT);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenNthCalledWith(1, {
      message: {
        type: 'ATTENDANCE_ABSENT',
        params: {
          sessionId: 'session-42',
          studentId: STUDENT,
          studentName: 'Aarav Sharma',
          status: 'ABSENT',
          markedAt: '2026-03-07T09:05:00.000Z',
          sessionDate: '2026-03-07',
          sectionName: 'A',
          standardName: 'Class 5',
        },
      },
      audience: { scope: 'institute', tenantId: TENANT, resellerId: null },
      recipient: { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' },
      source: { stream: 'NOTIFICATION', sequence: 41 },
      dedupeKey: `attendance:session-42:${STUDENT}:ABSENT:user-guardian-1`,
      inApp: true,
      appOnly: false,
    });
    expect(dispatcher.dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        recipient: { userId: 'user-guardian-2', membershipId: 'membership-guardian-2' },
        appOnly: true,
      }),
    );
  });

  it('should pass nulls when the event has no display fields', async () => {
    recipients.guardiansOfStudent.mockResolvedValue([
      {
        recipient: { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' },
        appOnly: false,
      },
    ]);

    await listener.handleAbsent(
      makeEvent({
        studentName: undefined,
        sessionDate: undefined,
        sectionName: undefined,
        standardName: undefined,
        status: 'LATE',
      }),
      makeCtx(),
    );

    expect(dispatcher.dispatch).toHaveBeenCalledWith({
      message: {
        type: 'ATTENDANCE_ABSENT',
        params: {
          sessionId: 'session-42',
          studentId: STUDENT,
          studentName: null,
          status: 'LATE',
          markedAt: '2026-03-07T09:05:00.000Z',
          sessionDate: null,
          sectionName: null,
          standardName: null,
        },
      },
      audience: { scope: 'institute', tenantId: TENANT, resellerId: null },
      recipient: { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' },
      source: { stream: 'NOTIFICATION', sequence: 41 },
      dedupeKey: `attendance:session-42:${STUDENT}:LATE:user-guardian-1`,
      inApp: true,
      appOnly: false,
    });
  });

  it('should give re-sent absences of one session and student the same key, and a new status a new one', async () => {
    recipients.guardiansOfStudent.mockResolvedValue([
      {
        recipient: { userId: 'user-guardian-1', membershipId: 'membership-guardian-1' },
        appOnly: false,
      },
    ]);
    const keys = async (event: AttendanceAbsentEvent, sequence: number) => {
      const ctx = createMock<JetStreamContext>({
        getStream: vi.fn().mockReturnValue('NOTIFICATION'),
        getSequence: vi.fn().mockReturnValue({ stream: sequence, consumer: 1 }),
      });
      await listener.handleAbsent(event, ctx);
      return vi.mocked(dispatcher.dispatch).mock.lastCall?.[0].dedupeKey;
    };

    const first = await keys(makeEvent(), 41);
    const again = await keys(makeEvent({ markedAt: '2026-03-07T09:20:00.000Z' }), 57);
    const late = await keys(makeEvent({ status: 'LATE' }), 58);

    expect(first).toBe(`attendance:session-42:${STUDENT}:ABSENT:user-guardian-1`);
    expect(again).toBe(first);
    expect(late).toBe(`attendance:session-42:${STUDENT}:LATE:user-guardian-1`);
  });

  it('should dispatch nothing when the student has no linked guardian', async () => {
    await listener.handleAbsent(makeEvent(), makeCtx());

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
