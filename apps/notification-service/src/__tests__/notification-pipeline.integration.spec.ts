/**
 * ROV-314 pipeline against the real test database: listener → dispatcher → repositories →
 * notification rows, with Temporal replaced by a recorder and the workflow bodies run by hand
 * (there is no Temporal test server in this repo).
 */
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { Gender, GuardianRelationship } from '@roviq/common-types';
import {
  createDrizzleDb,
  type DrizzleDB,
  guardianProfiles,
  instituteNotificationConfigs,
  memberships,
  mkAdminCtx,
  notifications,
  phoneNumbers,
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
import { InstitutePortal } from '../config/institute-portal';
import type { AdapterErrorCode } from '../delivery/adapters/adapter-errors';
import type { ChannelAdapter, ChannelMessage } from '../delivery/adapters/channel-adapter';
import { ChannelAdapterError } from '../delivery/adapters/channel-adapter';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { GuardianConsentGate } from '../delivery/consent-gate';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { AttendanceListener } from '../listeners/attendance.listener';
import { AuthListener } from '../listeners/auth.listener';
import { LeaveListener } from '../listeners/leave.listener';
import { UserListener } from '../listeners/user.listener';
import { ConsentReadDrizzleRepository } from '../repositories/consent-read.drizzle-repository';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { NotificationConfigReadDrizzleRepository } from '../repositories/notification-config-read.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { appOnlyFlow, channelsOf } from '../types/flow';
import { DigestBuffer, runDigestLoop } from '../workflows/digest-logic';
import { runFlow } from '../workflows/flow-runner';
import { createNotificationActivities } from '../workflows/notification.activities';
import {
  type DigestItem,
  type DigestWorkflowInput,
  type FlowWorkflowInput,
  sendData,
} from '../workflows/notification-workflow.types';
import { noDeliveryLimits } from './delivery-limits';

const CTX = 'test:notification-pipeline';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const GUARDIAN_PHONE = (() => {
  const number = `9${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`;
  return { countryCode: '+91', number, full: `+91${number}` };
})();

class RecordingAdapter implements ChannelAdapter {
  readonly provider = 'recording';
  readonly sent: ChannelMessage[] = [];
  failWith: AdapterErrorCode | null = null;

  constructor(readonly channel: ChannelMessage['channel']) {}

  async send(message: ChannelMessage) {
    if (this.failWith) throw new ChannelAdapterError(this.failWith, 'provider refused');
    this.sent.push(message);
    return { providerMessageId: `recording-${this.sent.length}` };
  }
}

function isFlowInput(value: unknown): value is FlowWorkflowInput {
  return typeof value === 'object' && value !== null && 'flowId' in value && 'recipients' in value;
}
function isDigestInput(value: unknown): value is DigestWorkflowInput {
  return typeof value === 'object' && value !== null && 'runAt' in value && 'appOnly' in value;
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
  let studentProfileId: string;
  let guardianProfileId: string;
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
  let writes: NotificationWriteDrizzleRepository;
  let recipientRepo: RecipientReadDrizzleRepository;
  let dispatcher: NotificationDispatcher;
  let attendance: AttendanceListener;
  let users: UserListener;

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

  const activitiesAt = (attempt: number) =>
    createNotificationActivities({ sender, recipients: recipientRepo, writes }, () => attempt);

  /** One activity per channel of the flow and recipient, as one execution of each would run. */
  async function runDelivery(input: FlowWorkflowInput, attempt = 1) {
    const activities = activitiesAt(attempt);
    const plans = input.recipients.flatMap((recipient) =>
      channelsOf(input.flow).map((channel) => ({ recipient, channel })),
    );
    const results = await Promise.allSettled(
      plans.map(({ recipient, channel }) =>
        activities.sendChannel({
          audience: input.audience,
          recipientUserId: recipient.userId,
          channel,
          enabled: input.enabled[channel],
          content: {
            kind: 'single',
            message: input.message,
            notificationId: recipient.notificationId,
          },
          data: sendData(input.data, channel, recipient.notificationId),
          deferrable: true,
          flowId: input.flowId,
          recipientsRef: input.recipientsRef,
        }),
      ),
    );
    return plans.map((plan, i) => ({ ...plan, result: results[i] }));
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
      studentProfileId = studentProfile.id;
      guardianProfileId = guardianProfile.id;
      await tx.insert(studentGuardianLinks).values({
        ...by,
        tenantId: institute.tenantId,
        studentProfileId: studentProfile.id,
        guardianProfileId: guardianProfile.id,
        relationship: GuardianRelationship.FATHER,
      });
      await tx.insert(phoneNumbers).values({
        ...by,
        userId: guardian.userId,
        isPrimary: true,
        countryCode: GUARDIAN_PHONE.countryCode,
        number: GUARDIAN_PHONE.number,
      });
    });

    const contacts = new ContactReadDrizzleRepository(db);
    writes = new NotificationWriteDrizzleRepository(db);
    const recipients = new RecipientReadDrizzleRepository(db);
    recipientRepo = recipients;
    sender = new ChannelSender(
      new ChannelAdapters([email, sms]),
      new GuardianConsentGate(new ConsentReadDrizzleRepository(db)),
      contacts,
      writes,
      new WhatsAppRoute(new MessagingSenderDrizzleRepository(db), recipients, new Clock()),
      new NotificationMetrics(),
      ...noDeliveryLimits(),
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
    users = new UserListener(
      dispatcher,
      recipients,
      new InstitutePortal(new ConfigService({ INSTITUTE_PORTAL_URL: 'https://app.roviq.test/' })),
    );
  });

  beforeEach(() => {
    email.sent.length = 0;
    sms.sent.length = 0;
    email.failWith = null;
    sms.failWith = null;
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
    await superPool.query('DELETE FROM consent_records WHERE guardian_profile_id = $1', [
      guardianProfileId,
    ]);
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
      await tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, guardian.userId));
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
      expect(input.appOnly).toBe(false);
      const activities = activitiesAt(1);
      const waits: number[] = [];
      const summaries = await runDigestLoop({
        firstRunAt: Date.parse(input.runAt),
        buffer,
        sleepUntil: async () => {},
        // The summary walks the type's flow, as the digest workflow does.
        send: async (messages) => {
          const digest = { type: input.type, items: messages.map((m) => m.params) };
          await runFlow(
            {
              flow: input.appOnly ? appOnlyFlow(input.flow) : input.flow,
              recipients: [input.recipientUserId],
              conditions: { type_is_critical: input.critical, audience_is_institute: true },
            },
            {
              send: async (userId, channel) => {
                const result = await activities.sendChannel({
                  audience: input.audience,
                  recipientUserId: userId,
                  channel,
                  enabled: input.enabled[channel],
                  content: { kind: 'digest', digest },
                  data: {},
                  deferrable: true,
                  flowId: null,
                  recipientsRef: null,
                });
                return typeof result === 'string' ? result : 'SKIPPED';
              },
              waitForArrival: async (ms) => {
                waits.push(ms);
                return false;
              },
              arrived: () => false,
              sleep: async () => {},
              recordSkip: async () => {},
            },
          );
        },
      });

      expect(summaries).toBe(1);
      expect(sms.sent.map((m) => [m.to, m.body])).toEqual([
        [[GUARDIAN_PHONE.full], '2 attendance alerts were recorded today.'],
      ]);
      expect(email.sent).toEqual([]);
      // No device token, so the app step sent nothing and did not wait; the SMS is the last send.
      expect(waits).toEqual([]);
      const rows = (await deliveriesFor(guardian.userId)).filter(
        (d) => d.type === 'ATTENDANCE_ABSENT' && d.notification_id === null,
      );
      expect(rows.map((d) => [d.channel, d.status, d.skip_reason])).toEqual([
        ['PUSH', 'SKIPPED', 'channel_disabled'],
        ['WHATSAPP', 'SKIPPED', 'no_consent'],
        ['SMS', 'SENT', null],
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

  describe('WhatsApp consent (ROV-269)', () => {
    const whatsapp = new RecordingAdapter('WHATSAPP');
    let consentSender: ChannelSender;

    /** Appends one consent row as the superuser; the table is append-only for the app role. */
    async function recordConsent(isGranted: boolean, tenantId = institute.tenantId) {
      await superPool.query(
        `INSERT INTO consent_records
           (tenant_id, guardian_profile_id, student_profile_id, purpose, is_granted)
         VALUES ($1, $2, $3, 'whatsapp_communication', $4)`,
        [tenantId, guardianProfileId, studentProfileId, isGranted],
      );
    }

    function send(channel: 'WHATSAPP' | 'EMAIL', data: Record<string, string>) {
      return consentSender.attempt({
        type: 'ATTENDANCE_ABSENT',
        channel,
        audience: { scope: 'institute', tenantId: institute.tenantId, resellerId: null },
        recipientUserId: guardian.userId,
        notificationId: null,
        flowId: null,
        channelEnabled: true,
        critical: false,
        deferrable: true,
        attempt: 1,
        address: { given: channel === 'EMAIL' ? 'guardian@example.in' : '+919876543210' },
        data,
        compose: () => ({ subject: 'Absent today', body: 'Aarav was marked absent.' }),
      });
    }
    const aboutStudent = () => ({ studentId: student.membershipId });

    beforeAll(() => {
      consentSender = new ChannelSender(
        new ChannelAdapters([email, whatsapp]),
        new GuardianConsentGate(new ConsentReadDrizzleRepository(db)),
        new ContactReadDrizzleRepository(db),
        new NotificationWriteDrizzleRepository(db),
        new WhatsAppRoute(
          new MessagingSenderDrizzleRepository(db),
          new RecipientReadDrizzleRepository(db),
          new Clock(),
        ),
        new NotificationMetrics(),
        ...noDeliveryLimits(),
      );
    });

    beforeEach(() => {
      whatsapp.sent.length = 0;
    });

    it('should follow the latest consent row: none, granted, withdrawn, granted again', async () => {
      const blocked = { status: 'SKIPPED', provider: null, skipReason: 'no_consent' };
      const whatsappRows = async () =>
        (await deliveriesFor(guardian.userId)).filter((d) => d.channel === 'WHATSAPP');
      const before = (await whatsappRows()).length;

      // Another institute's row for the same pair must not count: RLS hides it.
      await recordConsent(true, foreignInstitute.tenantId);
      expect(await send('WHATSAPP', aboutStudent())).toEqual(blocked);
      // Other channels are not gated by this consent.
      expect((await send('EMAIL', aboutStudent())).status).toBe('SENT');

      await recordConsent(true);
      expect((await send('WHATSAPP', aboutStudent())).status).toBe('SENT');

      await recordConsent(false);
      expect(await send('WHATSAPP', aboutStudent())).toEqual(blocked);
      // A message about no particular student has no granted pair to rely on either.
      expect(await send('WHATSAPP', {})).toEqual(blocked);

      await recordConsent(true);
      expect((await send('WHATSAPP', aboutStudent())).status).toBe('SENT');
      expect((await send('WHATSAPP', {})).status).toBe('SENT');

      expect(whatsapp.sent).toHaveLength(3);
      const rows = (await whatsappRows()).slice(before);
      expect(rows.map((d) => [d.status, d.skip_reason])).toEqual([
        ['SKIPPED', 'no_consent'],
        ['SENT', null],
        ['SKIPPED', 'no_consent'],
        ['SKIPPED', 'no_consent'],
        ['SENT', null],
        ['SENT', null],
      ]);
    });

    it('should block a message about a student of another institute', async () => {
      const outcome = await send('WHATSAPP', { studentId: foreignInstitute.membershipId });

      expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_consent' });
      expect(whatsapp.sent).toEqual([]);
    });

    it('should not gate a recipient who is not a guardian of the institute', async () => {
      const outcome = await consentSender.attempt({
        type: 'APPROVAL_REQUESTED',
        channel: 'WHATSAPP',
        audience: { scope: 'institute', tenantId: institute.tenantId, resellerId: null },
        recipientUserId: student.userId,
        notificationId: null,
        flowId: null,
        channelEnabled: true,
        critical: false,
        deferrable: true,
        attempt: 1,
        address: { given: '+919876500000' },
        data: {},
        compose: () => ({ subject: 'Approval needed', body: 'A leave request is waiting.' }),
      });

      expect(outcome.status).toBe('SENT');
    });

    it('should not let consent for one child cover a message about another', async () => {
      // The guardian's consent for the first student is granted (previous test). Link a second.
      const sibling = await createTestTeacher(db, institute.tenantId);
      extraTeachers.push(sibling);
      userIds.push(sibling.userId);
      await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
        const [siblingProfile] = await tx
          .insert(studentProfiles)
          .values({
            ...by,
            tenantId: institute.tenantId,
            userId: sibling.userId,
            membershipId: sibling.membershipId,
            admissionNumber: `ROV269-${sibling.membershipId.slice(-6)}`,
            admissionDate: '2025-04-01',
          })
          .returning({ id: studentProfiles.id });
        assert(siblingProfile);
        await tx.insert(studentGuardianLinks).values({
          ...by,
          tenantId: institute.tenantId,
          studentProfileId: siblingProfile.id,
          guardianProfileId,
          relationship: GuardianRelationship.FATHER,
        });
      });
      const blocked = { status: 'SKIPPED', provider: null, skipReason: 'no_consent' };

      expect((await send('WHATSAPP', aboutStudent())).status).toBe('SENT');
      expect(await send('WHATSAPP', { studentId: sibling.membershipId })).toEqual(blocked);
      // A message that names no student needs every linked student granted.
      expect(await send('WHATSAPP', {})).toEqual(blocked);
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
      recipients: [{ userId: guardian.userId, membershipId: guardian.membershipId }],
      recipientsRef: {
        kind: 'guardians_of_student' as const,
        studentMembershipId: student.membershipId,
      },
      inApp: true,
    });

    function startedInput(): FlowWorkflowInput {
      const [call] = temporal.startWorkflowOnce.mock.calls;
      assert(call);
      const input = call[1].args?.[0];
      assert(isFlowInput(input));
      return input;
    }

    it('should record channel_disabled without calling the adapter when WhatsApp is off', async () => {
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
      const input = startedInput();
      await runDelivery(input);

      const rows = (await deliveriesFor(guardian.userId)).filter(
        (d) =>
          d.notification_id === input.recipients[0]?.notificationId && d.channel === 'WHATSAPP',
      );
      expect(rows.map((d) => [d.status, d.skip_reason, d.provider, d.attempt])).toEqual([
        ['SKIPPED', 'channel_disabled', null, 1],
      ]);
    });

    it('should record FAILED rows with the error code per attempt and keep the in-app row', async () => {
      sms.failWith = 'ECONNECTION';
      sequence += 1;

      await dispatcher.dispatch({ ...reminder(), source: { stream: 'NOTIFICATION', sequence } });
      const input = startedInput();
      const first = await runDelivery(input, 1);
      const second = await runDelivery(input, 2);

      const smsResult = first.find((r) => r.channel === 'SMS')?.result;
      assert(smsResult?.status === 'rejected');
      expect(smsResult.reason).toBeInstanceOf(ApplicationFailure);
      expect(second.filter((r) => r.result?.status === 'rejected')).toHaveLength(1);
      const notificationId = input.recipients[0]?.notificationId;
      assert(notificationId);
      const failed = (await deliveriesFor(guardian.userId)).filter(
        (d) => d.status === 'FAILED' && d.notification_id === notificationId,
      );
      expect(failed.map((d) => [d.channel, d.provider, d.error_code, d.attempt])).toEqual([
        ['SMS', 'recording', 'ECONNECTION', 1],
        ['SMS', 'recording', 'ECONNECTION', 2],
      ]);
      const inApp = (await rowsFor(guardian.userId)).filter((r) => r.id === notificationId);
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

      await users.handleUserCreated(event, jetStreamCtx());

      expect(email.sent.map((m) => m.to)).toEqual([[event.email]]);
      expect(email.sent[0]?.body).toContain('Tmp-ROV314-9xQ2');
      // ROV-315: the person did not ask for the account, so the institute and the portal are named.
      expect(email.sent[0]?.subject).toBe(
        `Your Roviq sign-in details for Test Institute ${institute.slug.slice('test-'.length)}`,
      );
      expect(email.sent[0]?.body).toContain('Sign in at https://app.roviq.test/login.');
      expect(sms.sent).toEqual([]);
      const rows = await deliveriesFor(institute.userId);
      expect(rows.map((d) => [d.channel, d.status, d.skip_reason, d.notification_id])).toEqual([
        ['EMAIL', 'SENT', null, null],
        ['SMS', 'SKIPPED', 'no_address', null],
      ]);
      await assertNoSecretStored(institute.userId, 'Tmp-ROV314-9xQ2');
    });

    it('should text the welcome when the event has a phone and no email (ROV-315)', async () => {
      const event: UserCreatedEvent = {
        userId: student.userId,
        scope: 'institute',
        tenantId: institute.tenantId,
        resellerId: null,
        username: student.username,
        email: null,
        phone: '+919876512345',
        firstName: null,
        lastName: null,
        tempPassword: 'Tmp-ROV315-sms7',
      };

      await users.handleUserCreated(event, jetStreamCtx());

      expect(email.sent).toEqual([]);
      expect(sms.sent.map((m) => m.to)).toEqual([['+919876512345']]);
      expect(sms.sent[0]?.body).toContain('Tmp-ROV315-sms7');
      // A registered SMS template carries no web address (ROV-318); the email does.
      expect(sms.sent[0]?.body).toContain("institute's Roviq portal");
      expect(sms.sent[0]?.body).not.toContain('http');
      const rows = (await deliveriesFor(student.userId)).filter((d) => d.type === 'USER_WELCOME');
      expect(rows.map((d) => [d.channel, d.status, d.skip_reason])).toEqual([
        ['EMAIL', 'SKIPPED', 'no_address'],
        ['SMS', 'SENT', null],
      ]);
      await assertNoSecretStored(student.userId, 'Tmp-ROV315-sms7');
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

  describe('sign-in alert', () => {
    it('should store only the in-app row, with the plain IPv4 address', async () => {
      const member = await createTestTeacher(db, institute.tenantId);
      userIds.push(member.userId);
      extraTeachers.push(member);
      const event: AuthSecurityEvent = {
        userId: member.userId,
        tenantId: institute.tenantId,
        eventType: 'LOGIN',
        scope: 'institute',
        resellerId: null,
        metadata: { ip: '::ffff:127.0.0.1' },
      };

      await new AuthListener(dispatcher).handleSecurity(event, jetStreamCtx());

      const rows = await rowsFor(member.userId);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      assert(row);
      expect({
        scope: row.scope,
        tenantId: row.tenantId,
        type: row.type,
        title: row.title,
      }).toEqual({
        scope: 'institute',
        tenantId: institute.tenantId,
        type: 'AUTH_LOGIN',
        title: { en: 'New sign-in to your account', hi: 'आपके खाते में नया साइन-इन' },
      });
      // The time is the moment of the call; its format is pinned in notification-types.spec.ts.
      expect(row.body.en).toMatch(
        /^A new sign-in was detected from IP 127\.0\.0\.1 at \d{1,2} \w{3} \d{4}, \d{1,2}:\d{2} [ap]m\. If this wasn't you, secure your account immediately\.$/,
      );
      expect(row.body.hi).toMatch(
        /^\d{1,2} \S+ \d{4}, \d{2}:\d{2} पर IP 127\.0\.0\.1 से नया साइन-इन हुआ। यदि यह आप नहीं थे, तो तुरंत अपना खाता सुरक्षित करें।$/,
      );
      expect(await deliveriesFor(member.userId)).toEqual([]);
      expect(email.sent).toEqual([]);
      expect(temporal.startWorkflowOnce).not.toHaveBeenCalled();
      expect(temporal.signalWithStart).not.toHaveBeenCalled();
    });
  });
});
