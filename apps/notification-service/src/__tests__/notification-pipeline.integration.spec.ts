/**
 * ROV-314 pipeline against the real test database: listener → dispatcher → repositories →
 * notification rows, with Temporal replaced by a recorder and the workflow bodies run by hand
 * (there is no Temporal test server in this repo).
 */
import assert from 'node:assert/strict';
import { Gender, GuardianRelationship } from '@roviq/common-types';
import {
  createDrizzleDb,
  type DrizzleDB,
  guardianProfiles,
  instituteNotificationConfigs,
  memberships,
  mkAdminCtx,
  notifications,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  userProfiles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import type { JetStreamContext } from '@roviq/nats-jetstream';
import type {
  AttendanceAbsentEvent,
  AuthSecurityEvent,
  LeaveDecidedEvent,
  UserCreatedEvent,
} from '@roviq/notifications';
import { TemporalClientService } from '@roviq/temporal';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createMock,
  createTestInstitute,
  createTestTeacher,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { ApplicationFailure } from '@temporalio/activity';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelMessage } from '../delivery/adapters/channel-adapter';
import { ChannelAdapterError } from '../delivery/adapters/channel-adapter';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { AllowAllConsentGate } from '../delivery/consent-gate';
import { AttendanceListener } from '../listeners/attendance.listener';
import { AuthListener } from '../listeners/auth.listener';
import { LeaveListener } from '../listeners/leave.listener';
import { UserListener } from '../listeners/user.listener';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { NotificationConfigReadDrizzleRepository } from '../repositories/notification-config-read.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';
import { DigestBuffer, runDigestLoop } from '../workflows/digest-logic';
import { createNotificationActivities } from '../workflows/notification.activities';
import type {
  DeliveryWorkflowInput,
  DigestItem,
  DigestWorkflowInput,
} from '../workflows/notification-workflow.types';

const CTX = 'test:notification-pipeline';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

class RecordingAdapter implements ChannelAdapter {
  readonly provider = 'recording';
  readonly sent: ChannelMessage[] = [];
  failWith: string | null = null;

  constructor(readonly channel: ChannelMessage['channel']) {}

  async send(message: ChannelMessage) {
    if (this.failWith) throw new ChannelAdapterError(this.failWith, 'provider refused');
    this.sent.push(message);
    return { providerMessageId: `recording-${this.sent.length}` };
  }
}

function isDeliveryInput(value: unknown): value is DeliveryWorkflowInput {
  return typeof value === 'object' && value !== null && 'message' in value && 'channels' in value;
}
function isDigestInput(value: unknown): value is DigestWorkflowInput {
  return typeof value === 'object' && value !== null && 'runAt' in value && 'channels' in value;
}
function isDigestItem(value: unknown): value is DigestItem {
  return typeof value === 'object' && value !== null && 'dedupeKey' in value && 'message' in value;
}

let sequence = 1_000;
function jetStreamCtx(): JetStreamContext {
  sequence += 1;
  const seq = sequence;
  return createMock<JetStreamContext>({
    getStream: vi.fn().mockReturnValue('NOTIFICATION'),
    getSequence: vi.fn().mockReturnValue({ stream: seq, consumer: 1 }),
  });
}

describe('notification pipeline (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let foreignInstitute: TestInstitute;
  let student: TestTeacher;
  let guardian: TestTeacher;
  const userIds: string[] = [];
  const extraTeachers: TestTeacher[] = [];

  const email = new RecordingAdapter('EMAIL');
  const sms = new RecordingAdapter('SMS');
  const temporal = createMock<TemporalClientService>({
    startWorkflowOnce: vi.fn().mockResolvedValue(true),
    signalWithStart: vi.fn().mockResolvedValue('run-1'),
  });
  const eventBus = createMock<EventBusService>({ emit: vi.fn() });
  let sender: ChannelSender;
  let dispatcher: NotificationDispatcher;
  let attendance: AttendanceListener;

  async function rowsFor(userId: string) {
    return withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx.select().from(notifications).where(eq(notifications.recipientUserId, userId)),
    );
  }

  async function deliveriesFor(userId: string) {
    const { rows } = await superPool.query<{
      scope: string;
      tenant_id: string | null;
      notification_id: string | null;
      type: string;
      channel: string;
      provider: string | null;
      status: string;
      skip_reason: string | null;
      error_code: string | null;
      attempt: number;
      json: string;
    }>(
      `SELECT scope, tenant_id, notification_id, type, channel, provider, status, skip_reason,
              error_code, attempt, row_to_json(d)::text AS json
         FROM notification_deliveries d WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return rows;
  }

  async function runDelivery(input: DeliveryWorkflowInput, attempt = 1) {
    const activities = createNotificationActivities(sender, () => attempt);
    return Promise.allSettled(
      input.channels.map((plan) =>
        activities.sendChannel({
          audience: input.audience,
          recipientUserId: input.recipientUserId,
          channel: plan.channel,
          enabled: plan.enabled,
          content: { kind: 'single', message: input.message, notificationId: input.notificationId },
          data: input.data,
        }),
      ),
    );
  }

  function absence(overrides: Partial<AttendanceAbsentEvent> = {}): AttendanceAbsentEvent {
    return {
      tenantId: institute.tenantId,
      sessionId: 'session-1',
      studentId: student.membershipId,
      studentName: 'Aarav Sharma',
      status: 'ABSENT',
      remarks: null,
      markedAt: '2026-04-10T03:35:00.000Z',
      sessionDate: '2026-04-10',
      sectionName: 'A',
      standardName: 'Class 5',
      ...overrides,
    };
  }

  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL_TEST ??
        'postgresql://roviq_pooler:roviq_pooler_dev@localhost:5434/roviq_test',
    });
    superPool = new pg.Pool({
      connectionString:
        process.env.DATABASE_URL_TEST_MIGRATE ??
        'postgresql://roviq:roviq_dev@localhost:5434/roviq_test',
    });
    db = createDrizzleDb(pool);
    institute = await createTestInstitute(db);
    foreignInstitute = await createTestInstitute(db);
    student = await createTestTeacher(db, institute.tenantId);
    guardian = await createTestTeacher(db, institute.tenantId);
    userIds.push(institute.userId, foreignInstitute.userId, student.userId, guardian.userId);

    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      await tx.insert(userProfiles).values({
        ...by,
        userId: student.userId,
        firstName: { en: 'Aarav' },
        gender: Gender.MALE,
      });
      const [studentProfile] = await tx
        .insert(studentProfiles)
        .values({
          ...by,
          tenantId: institute.tenantId,
          userId: student.userId,
          membershipId: student.membershipId,
          admissionNumber: `ROV314-${student.membershipId.slice(-6)}`,
          admissionDate: '2025-04-01',
        })
        .returning({ id: studentProfiles.id });
      const [guardianProfile] = await tx
        .insert(guardianProfiles)
        .values({
          ...by,
          tenantId: institute.tenantId,
          userId: guardian.userId,
          membershipId: guardian.membershipId,
        })
        .returning({ id: guardianProfiles.id });
      assert(studentProfile && guardianProfile);
      await tx.insert(studentGuardianLinks).values({
        ...by,
        tenantId: institute.tenantId,
        studentProfileId: studentProfile.id,
        guardianProfileId: guardianProfile.id,
        relationship: GuardianRelationship.FATHER,
      });
    });

    const contacts = new ContactReadDrizzleRepository(db);
    const writes = new NotificationWriteDrizzleRepository(db);
    const recipients = new RecipientReadDrizzleRepository(db);
    sender = new ChannelSender(
      new ChannelAdapters([email, sms]),
      new AllowAllConsentGate(),
      contacts,
      writes,
    );
    dispatcher = new NotificationDispatcher(
      new NotificationConfigReadDrizzleRepository(db),
      recipients,
      writes,
      sender,
      temporal,
      eventBus,
      createMock<RetryWait>({ wait: vi.fn().mockResolvedValue(undefined) }),
    );
    attendance = new AttendanceListener(dispatcher, new RecipientResolver(recipients));
  });

  beforeEach(() => {
    email.sent.length = 0;
    sms.sent.length = 0;
    email.failWith = null;
    temporal.startWorkflowOnce.mockClear();
    temporal.signalWithStart.mockClear();
    eventBus.emit.mockClear();
  });

  afterAll(async () => {
    if (!db) return;
    const tenantIds = [institute?.tenantId, foreignInstitute?.tenantId].filter(
      (id): id is string => typeof id === 'string',
    );
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)', [
      userIds,
    ]);
    await superPool.query('DELETE FROM notifications WHERE recipient_user_id = ANY($1)', [userIds]);
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      await tx
        .delete(instituteNotificationConfigs)
        .where(inArray(instituteNotificationConfigs.tenantId, tenantIds));
      await tx
        .delete(studentGuardianLinks)
        .where(inArray(studentGuardianLinks.tenantId, tenantIds));
      await tx.delete(guardianProfiles).where(inArray(guardianProfiles.tenantId, tenantIds));
      await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
      await tx.delete(userProfiles).where(eq(userProfiles.userId, student.userId));
    });
    await cleanupTestTeacher(db, student);
    await cleanupTestTeacher(db, guardian);
    for (const teacher of extraTeachers) await cleanupTestTeacher(db, teacher);
    await cleanupTestInstitute(db, institute);
    await cleanupTestInstitute(db, foreignInstitute);
    await pool.end();
    await superPool.end();
  });

  describe('absence', () => {
    it('should store one in-app row for the guardian, and none on redelivery', async () => {
      const ctx = jetStreamCtx();

      await attendance.handleAbsent(absence(), ctx);
      await attendance.handleAbsent(absence(), ctx);

      const rows = await rowsFor(guardian.userId);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      assert(row);
      expect({
        scope: row.scope,
        tenantId: row.tenantId,
        resellerId: row.resellerId,
        recipientMembershipId: row.recipientMembershipId,
        type: row.type,
        title: row.title,
        body: row.body,
        dedupeKey: row.dedupeKey,
      }).toEqual({
        scope: 'institute',
        tenantId: institute.tenantId,
        resellerId: null,
        recipientMembershipId: guardian.membershipId,
        type: 'ATTENDANCE_ABSENT',
        title: { en: 'Absence recorded', hi: 'अनुपस्थिति दर्ज' },
        body: {
          en: 'Your ward Aarav Sharma (Class 5-A) was marked absent on 10 April 2026. Please contact the institute if this is incorrect.',
          hi: '10 अप्रैल 2026 को आपके बच्चे Aarav Sharma (Class 5-A) को अनुपस्थित दर्ज किया गया। यदि यह सही नहीं है तो कृपया संस्थान से संपर्क करें।',
        },
        dedupeKey: `attendance:session-1:${student.membershipId}:ABSENT:${guardian.userId}`,
      });
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('NOTIFICATION.inapp.created', {
        notificationId: row.id,
        scope: 'institute',
        tenantId: institute.tenantId,
        resellerId: null,
        recipientUserId: guardian.userId,
      });
      expect(await rowsFor(student.userId)).toEqual([]);
    });

    it('should alert once for an absence marked again, and again for a new status', async () => {
      const repeat = { sessionId: 'session-repeat' };
      const key = `attendance:session-repeat:${student.membershipId}:ABSENT:${guardian.userId}`;

      // Absent, absent again, then absent after a present (which emits nothing): new sequences.
      await attendance.handleAbsent(absence(repeat), jetStreamCtx());
      await attendance.handleAbsent(
        absence({ ...repeat, markedAt: '2026-04-10T03:40:00.000Z' }),
        jetStreamCtx(),
      );
      await attendance.handleAbsent(
        absence({ ...repeat, markedAt: '2026-04-10T04:10:00.000Z' }),
        jetStreamCtx(),
      );

      const rows = (await rowsFor(guardian.userId)).filter((r) => r.dedupeKey?.includes('repeat'));
      expect(rows.map((r) => r.dedupeKey)).toEqual([key]);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      const items = temporal.signalWithStart.mock.calls.map(([, options]) => {
        const [item] = options.signalArgs;
        assert(isDigestItem(item));
        return item;
      });
      expect(items.map((item) => item.dedupeKey)).toEqual([key, key, key]);
      const buffer = new DigestBuffer<DigestItem['message']>();
      for (const item of items) {
        buffer.add({ dedupeKey: item.dedupeKey, runAt: item.runAt, value: item.message });
      }
      expect(buffer.drain()).toEqual([items[0]?.message]);

      await attendance.handleAbsent(absence({ ...repeat, status: 'LATE' }), jetStreamCtx());

      const after = (await rowsFor(guardian.userId)).filter((r) => r.dedupeKey?.includes('repeat'));
      expect(after.map((r) => r.dedupeKey).sort()).toEqual(
        [key, `attendance:session-repeat:${student.membershipId}:LATE:${guardian.userId}`].sort(),
      );
    });

    it('should refuse a student of another institute', async () => {
      const before = (await rowsFor(guardian.userId)).length;

      await attendance.handleAbsent(
        absence({ tenantId: foreignInstitute.tenantId }),
        jetStreamCtx(),
      );

      expect(await rowsFor(guardian.userId)).toHaveLength(before);
      expect(temporal.signalWithStart).not.toHaveBeenCalled();
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should send two absences in one digest window as one summary', async () => {
      await attendance.handleAbsent(absence({ sessionId: 'session-a' }), jetStreamCtx());
      await attendance.handleAbsent(
        absence({ sessionId: 'session-b', status: 'LATE' }),
        jetStreamCtx(),
      );

      const calls = temporal.signalWithStart.mock.calls;
      expect(calls).toHaveLength(2);
      const workflowIds = new Set(calls.map(([, options]) => options.workflowId));
      expect([...workflowIds]).toEqual([
        `notification-digest:${institute.tenantId}:${guardian.userId}:ATTENDANCE_ABSENT`,
      ]);
      const [firstCall] = calls;
      assert(firstCall);
      const input = firstCall[1].args[0];
      assert(isDigestInput(input));

      const buffer = new DigestBuffer<DigestItem['message']>();
      for (const [, options] of calls) {
        const [item] = options.signalArgs;
        assert(isDigestItem(item));
        buffer.add({ dedupeKey: item.dedupeKey, runAt: item.runAt, value: item.message });
      }
      const activities = createNotificationActivities(sender, () => 1);
      const summaries = await runDigestLoop({
        firstRunAt: Date.parse(input.runAt),
        buffer,
        sleepUntil: async () => {},
        send: async (messages) => {
          await Promise.allSettled(
            input.channels.map((plan) =>
              activities.sendChannel({
                audience: input.audience,
                recipientUserId: input.recipientUserId,
                channel: plan.channel,
                enabled: plan.enabled,
                content: {
                  kind: 'digest',
                  digest: { type: input.type, items: messages.map((m) => m.params) },
                },
                data: {},
              }),
            ),
          );
        },
      });

      expect(summaries).toBe(1);
      expect(email.sent.map((m) => [m.to, m.subject, m.body])).toEqual([
        [
          [`${guardian.username}@test.local`],
          'Attendance alerts: 1 absence, 1 late arrival',
          '2 attendance alerts were recorded today.',
        ],
      ]);
    });
  });

  describe('leave decision', () => {
    let staff: TestTeacher;
    let leaveListener: LeaveListener;

    beforeAll(async () => {
      staff = await createTestTeacher(db, institute.tenantId);
      userIds.push(staff.userId);
      extraTeachers.push(staff);
      leaveListener = new LeaveListener(
        dispatcher,
        new RecipientResolver(new RecipientReadDrizzleRepository(db)),
      );
    });

    const decided = (): LeaveDecidedEvent => ({
      tenantId: institute.tenantId,
      leaveId: 'leave-1',
      userId: staff.membershipId,
      status: 'APPROVED',
      applicantName: 'Priya Verma',
      startDate: '2026-04-20',
      endDate: '2026-04-21',
    });

    it('should tell an active applicant the leave dates, without the leave id', async () => {
      await leaveListener.handleDecided(decided(), jetStreamCtx());

      expect(
        (await rowsFor(staff.userId)).map((r) => ({
          type: r.type,
          recipientMembershipId: r.recipientMembershipId,
          title: r.title,
          body: r.body,
          data: r.data,
        })),
      ).toEqual([
        {
          type: 'LEAVE_DECIDED',
          recipientMembershipId: staff.membershipId,
          title: { en: 'Your leave was approved', hi: 'आपकी छुट्टी स्वीकृत हुई' },
          body: {
            en: 'Your leave application from 20 April 2026 to 21 April 2026 has been approved.',
            hi: 'आपका 20 अप्रैल 2026 से 21 अप्रैल 2026 तक का छुट्टी आवेदन स्वीकृत कर दिया गया है।',
          },
          data: { leaveId: 'leave-1', path: '/institute/leave' },
        },
      ]);
    });

    it('should send nothing to an applicant whose membership is not active', async () => {
      await withAdmin(db, mkAdminCtx(CTX), (tx) =>
        tx
          .update(memberships)
          .set({ status: 'SUSPENDED' })
          .where(eq(memberships.id, staff.membershipId)),
      );
      const before = await rowsFor(staff.userId);

      await leaveListener.handleDecided(decided(), jetStreamCtx());

      expect(await rowsFor(staff.userId)).toEqual(before);
      expect(await deliveriesFor(staff.userId)).toEqual([]);
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('channel settings and failures', () => {
    const reminder = () => ({
      message: {
        type: 'FEE_REMINDER' as const,
        params: {
          studentId: student.membershipId,
          studentName: 'Aarav Sharma',
          feeId: 'fee-1',
          amount: 5000,
          currency: 'INR',
          dueDate: '2026-04-20',
          feeType: 'Tuition',
          feePeriod: 'April 2026',
        },
      },
      audience: { scope: 'institute' as const, tenantId: institute.tenantId, resellerId: null },
      recipient: { userId: guardian.userId, membershipId: guardian.membershipId },
      inApp: true,
    });

    function startedInput(): DeliveryWorkflowInput {
      const [call] = temporal.startWorkflowOnce.mock.calls;
      assert(call);
      const input = call[1].args?.[0];
      assert(isDeliveryInput(input));
      return input;
    }

    it('should record channel_disabled without calling the adapter when email is off', async () => {
      await withAdmin(db, mkAdminCtx(CTX), (tx) =>
        tx.insert(instituteNotificationConfigs).values({
          ...by,
          tenantId: institute.tenantId,
          notificationType: 'FEE',
          emailEnabled: false,
          whatsappEnabled: false,
        }),
      );
      sequence += 1;

      await dispatcher.dispatch({ ...reminder(), source: { stream: 'NOTIFICATION', sequence } });
      await runDelivery(startedInput());

      expect(email.sent).toEqual([]);
      const rows = (await deliveriesFor(guardian.userId)).filter(
        (d) => d.type === 'FEE_REMINDER' && d.channel === 'EMAIL',
      );
      expect(rows.map((d) => [d.status, d.skip_reason, d.provider, d.attempt])).toEqual([
        ['SKIPPED', 'channel_disabled', null, 1],
      ]);
    });

    it('should record FAILED rows with the error code per attempt and keep the in-app row', async () => {
      await withAdmin(db, mkAdminCtx(CTX), (tx) =>
        tx
          .update(instituteNotificationConfigs)
          .set({ emailEnabled: true })
          .where(eq(instituteNotificationConfigs.tenantId, institute.tenantId)),
      );
      email.failWith = 'ECONNECTION';
      sequence += 1;

      await dispatcher.dispatch({ ...reminder(), source: { stream: 'NOTIFICATION', sequence } });
      const input = startedInput();
      const first = await runDelivery(input, 1);
      const second = await runDelivery(input, 2);

      const emailResult = first.find((_, i) => input.channels[i]?.channel === 'EMAIL');
      assert(emailResult?.status === 'rejected');
      expect(emailResult.reason).toBeInstanceOf(ApplicationFailure);
      expect(second.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const failed = (await deliveriesFor(guardian.userId)).filter(
        (d) => d.status === 'FAILED' && d.notification_id === input.notificationId,
      );
      expect(failed.map((d) => [d.channel, d.provider, d.error_code, d.attempt])).toEqual([
        ['EMAIL', 'recording', 'ECONNECTION', 1],
        ['EMAIL', 'recording', 'ECONNECTION', 2],
      ]);
      assert(input.notificationId);
      const inApp = (await rowsFor(guardian.userId)).filter((r) => r.id === input.notificationId);
      expect(inApp.map((r) => r.type)).toEqual(['FEE_REMINDER']);
    });
  });

  describe('secret types', () => {
    async function assertNoSecretStored(userId: string, secret: string) {
      expect(await rowsFor(userId)).toEqual([]);
      for (const row of await deliveriesFor(userId)) expect(row.json).not.toContain(secret);
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
      expect(temporal.signalWithStart).not.toHaveBeenCalled();
    }

    it('should email the welcome with the temporary password and store no secret', async () => {
      const event: UserCreatedEvent = {
        userId: institute.userId,
        scope: 'institute',
        tenantId: institute.tenantId,
        resellerId: null,
        username: institute.username,
        email: `${institute.username}@test.local`,
        phone: null,
        firstName: 'Priya',
        lastName: null,
        tempPassword: 'Tmp-ROV314-9xQ2',
      };

      await new UserListener(dispatcher).handleUserCreated(event, jetStreamCtx());

      expect(email.sent.map((m) => m.to)).toEqual([[event.email]]);
      expect(email.sent[0]?.body).toContain('Tmp-ROV314-9xQ2');
      expect(sms.sent).toEqual([]);
      const rows = await deliveriesFor(institute.userId);
      expect(rows.map((d) => [d.channel, d.status, d.skip_reason, d.notification_id])).toEqual([
        ['EMAIL', 'SENT', null, null],
        ['SMS', 'SKIPPED', 'no_address', null],
      ]);
      await assertNoSecretStored(institute.userId, 'Tmp-ROV314-9xQ2');
    });

    it('should email a verification code only to the address the event names', async () => {
      const event: AuthSecurityEvent = {
        userId: foreignInstitute.userId,
        tenantId: null,
        eventType: 'EMAIL_VERIFICATION',
        scope: 'platform',
        resellerId: null,
        metadata: { otp: '604213', recipientEmail: 'changed-address@example.in' },
      };

      await new AuthListener(dispatcher).handleSecurity(event, jetStreamCtx());

      expect(email.sent.map((m) => [m.to, m.body.includes('604213')])).toEqual([
        [['changed-address@example.in'], true],
      ]);
      expect(sms.sent).toEqual([]);
      const rows = await deliveriesFor(foreignInstitute.userId);
      expect(rows.map((d) => [d.scope, d.channel, d.status])).toEqual([
        ['platform', 'EMAIL', 'SENT'],
      ]);
      await assertNoSecretStored(foreignInstitute.userId, '604213');
      expect(rows.map((d) => d.json).join()).not.toContain('changed-address@example.in');
    });

    it('should send the impersonation code by SMS and email and store no secret', async () => {
      const event: AuthSecurityEvent = {
        userId: guardian.userId,
        tenantId: institute.tenantId,
        eventType: 'IMPERSONATION_OTP',
        scope: 'institute',
        resellerId: null,
        metadata: { otp: '771204', recipientPhone: '+919876500000' },
      };
      const before = (await deliveriesFor(guardian.userId)).length;
      const inAppBefore = (await rowsFor(guardian.userId)).length;

      await new AuthListener(dispatcher).handleSecurity(event, jetStreamCtx());

      expect(sms.sent.map((m) => [m.to, m.body.includes('771204')])).toEqual([
        [['+919876500000'], true],
      ]);
      expect(email.sent.map((m) => [m.to, m.body.includes('771204')])).toEqual([
        [[`${guardian.username}@test.local`], true],
      ]);
      const rows = (await deliveriesFor(guardian.userId)).slice(before);
      expect(rows.map((d) => [d.type, d.channel, d.status, d.notification_id])).toEqual([
        ['IMPERSONATION_OTP', 'SMS', 'SENT', null],
        ['IMPERSONATION_OTP', 'EMAIL', 'SENT', null],
      ]);
      for (const row of rows) {
        expect(row.json).not.toContain('771204');
        expect(row.json).not.toContain('+919876500000');
      }
      expect(await rowsFor(guardian.userId)).toHaveLength(inAppBefore);
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
    });
  });
});
