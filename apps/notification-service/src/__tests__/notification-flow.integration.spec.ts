/**
 * ROV-332 against the real test database: one flow per event walks a student's guardians over
 * the app, WhatsApp and SMS, and ends when one of them is reached. Temporal is replaced by a
 * recorder; the workflow body is run by hand through `runFlow` with the real activities, and
 * its arrival signal is routed back from the real listeners and webhook service.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { NotificationChannel } from '@roviq/common-types';
import { GuardianRelationship } from '@roviq/common-types';
import {
  createDrizzleDb,
  type DrizzleDB,
  deviceTokens,
  guardianProfiles,
  instituteNotificationConfigs,
  mkAdminCtx,
  notifications,
  phoneNumbers,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import type { JetStreamContext } from '@roviq/nats-jetstream';
import type { AttendanceAbsentEvent } from '@roviq/notifications';
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
import { and, eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter, ChannelMessage } from '../delivery/adapters/channel-adapter';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { GuardianConsentGate } from '../delivery/consent-gate';
import { SMS_HTTP_PROVIDER } from '../delivery/sms/sms-http.client';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { ArrivalListener } from '../listeners/arrival.listener';
import { AttendanceListener } from '../listeners/attendance.listener';
import { ConsentReadDrizzleRepository } from '../repositories/consent-read.drizzle-repository';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { DeliveryReceiptDrizzleRepository } from '../repositories/delivery-receipt.drizzle-repository';
import { FlowArrivalDrizzleRepository } from '../repositories/flow-arrival.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { NotificationConfigReadDrizzleRepository } from '../repositories/notification-config-read.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { FlowArrivals } from '../services/flow-arrivals.service';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';
import { SmsWebhookService } from '../services/sms-webhook.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { runFlow } from '../workflows/flow-runner';
import { createNotificationActivities } from '../workflows/notification.activities';
import {
  type FlowArrival,
  type FlowRecipient,
  type FlowWorkflowInput,
  sendData,
} from '../workflows/notification-workflow.types';

const CTX = 'test:notification-flow';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const MIN = 60_000;
const RUN = randomUUID().slice(0, 8);
const WHATSAPP_PROVIDER = 'recording-whatsapp';

interface Sent {
  channel: NotificationChannel;
  userId: string;
  to: readonly string[];
}

/** Every send of every channel in one log, so their order across channels is visible. */
const log: Sent[] = [];

class RecordingAdapter implements ChannelAdapter {
  private count = 0;

  constructor(
    readonly channel: NotificationChannel,
    readonly provider: string,
  ) {}

  async send(message: ChannelMessage) {
    this.count += 1;
    log.push({ channel: this.channel, userId: message.recipientUserId, to: message.to });
    return { providerMessageId: `${this.provider}-${RUN}-${this.count}` };
  }
}

interface GuardianSpec {
  phone?: boolean;
  device?: boolean;
  /** WhatsApp consent for this student; withdrawn means the guardian opted out. */
  consent?: boolean;
}

interface Family {
  student: TestTeacher;
  studentProfileId: string;
  guardians: TestTeacher[];
  guardianProfileIds: string[];
  phones: (string | null)[];
}

let sequence = 20_000;
function jetStreamCtx(): JetStreamContext {
  sequence += 1;
  const seq = sequence;
  return createMock<JetStreamContext>({
    getStream: vi.fn().mockReturnValue('NOTIFICATION'),
    getSequence: vi.fn().mockReturnValue({ stream: seq, consumer: 1 }),
  });
}

function isFlowInput(value: unknown): value is FlowWorkflowInput {
  return typeof value === 'object' && value !== null && 'flowId' in value && 'recipients' in value;
}
function isArrival(value: unknown): value is FlowArrival {
  return (
    typeof value === 'object' && value !== null && 'recipientUserId' in value && 'via' in value
  );
}

describe('notification flow (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let foreignInstitute: TestInstitute;
  const people: TestTeacher[] = [];
  const profileIds: string[] = [];
  let linkMinute = 0;

  const temporal = createMock<TemporalClientService>({
    startWorkflowOnce: vi.fn().mockResolvedValue(true),
    signalWithStart: vi.fn().mockResolvedValue('run-1'),
    signal: vi.fn().mockResolvedValue(false),
  });
  const eventBus = createMock<EventBusService>({ emit: vi.fn() });
  let writes: NotificationWriteDrizzleRepository;
  let recipients: RecipientReadDrizzleRepository;
  let sender: ChannelSender;
  let attendance: AttendanceListener;
  let arrivals: ArrivalListener;
  let smsWebhook: SmsWebhookService;
  let receipts: DeliveryReceiptDrizzleRepository;
  let flowArrivals: FlowArrivals;

  function randomPhone() {
    const number = `9${Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, '0')}`;
    return { countryCode: '+91', number, full: `+91${number}` };
  }

  /** A student of the institute and its guardians, linked in the order given (first primary). */
  async function makeFamily(specs: GuardianSpec[], tenantId = institute.tenantId): Promise<Family> {
    const student = await createTestTeacher(db, tenantId);
    people.push(student);
    const guardians: TestTeacher[] = [];
    for (const _ of specs) {
      const guardian = await createTestTeacher(db, tenantId);
      people.push(guardian);
      guardians.push(guardian);
    }
    const phones: (string | null)[] = [];
    const guardianProfileIds: string[] = [];
    let studentProfileId = '';
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [studentProfile] = await tx
        .insert(studentProfiles)
        .values({
          ...by,
          tenantId,
          userId: student.userId,
          membershipId: student.membershipId,
          admissionNumber: `ROV332-${student.membershipId.slice(-6)}`,
          admissionDate: '2025-04-01',
        })
        .returning({ id: studentProfiles.id });
      assert(studentProfile);
      studentProfileId = studentProfile.id;
      for (const [index, spec] of specs.entries()) {
        const guardian = guardians[index];
        assert(guardian);
        const [profile] = await tx
          .insert(guardianProfiles)
          .values({ ...by, tenantId, userId: guardian.userId, membershipId: guardian.membershipId })
          .returning({ id: guardianProfiles.id });
        assert(profile);
        guardianProfileIds.push(profile.id);
        profileIds.push(profile.id);
        linkMinute += 1;
        await tx.insert(studentGuardianLinks).values({
          ...by,
          tenantId,
          studentProfileId: studentProfile.id,
          guardianProfileId: profile.id,
          relationship: GuardianRelationship.FATHER,
          isPrimaryContact: index === 0,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, linkMinute)),
        });
        if (spec.phone ?? true) {
          const phone = randomPhone();
          phones.push(phone.full);
          await tx.insert(phoneNumbers).values({
            ...by,
            userId: guardian.userId,
            isPrimary: true,
            countryCode: phone.countryCode,
            number: phone.number,
          });
        } else {
          phones.push(null);
        }
        if (spec.device ?? true) {
          await tx.insert(deviceTokens).values({
            ...by,
            userId: guardian.userId,
            token: `device-${RUN}-${guardian.userId}`,
            platform: 'ANDROID',
          });
        }
      }
    });
    for (const [index, spec] of specs.entries()) {
      await superPool.query(
        `INSERT INTO consent_records
           (tenant_id, guardian_profile_id, student_profile_id, purpose, is_granted)
         VALUES ($1, $2, $3, 'whatsapp_communication', $4)`,
        [tenantId, guardianProfileIds[index], studentProfileId, spec.consent ?? true],
      );
    }
    return { student, studentProfileId, guardians, guardianProfileIds, phones };
  }

  function absence(family: Family): AttendanceAbsentEvent {
    return {
      tenantId: institute.tenantId,
      sessionId: `session-${RUN}-${sequence}`,
      studentId: family.student.membershipId,
      studentName: 'Aarav Sharma',
      status: 'ABSENT',
      remarks: null,
      markedAt: '2026-04-10T03:35:00.000Z',
      sessionDate: '2026-04-10',
      sectionName: 'A',
      standardName: 'Class 5',
    };
  }

  /** Dispatches an absence and returns the one flow input it started. */
  async function startFlow(family: Family): Promise<FlowWorkflowInput> {
    const before = temporal.startWorkflowOnce.mock.calls.length;
    await attendance.handleAbsent(absence(family), jetStreamCtx());
    const calls = temporal.startWorkflowOnce.mock.calls.slice(before);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    assert(call);
    const [input] = call[1].args ?? [];
    assert(isFlowInput(input));
    return input;
  }

  /** The workflow body, run by hand; `onWait` acts while the flow waits for arrival. */
  async function walk(
    input: FlowWorkflowInput,
    onWait: (ms: number) => Promise<void> = async () => {},
  ) {
    const ids = new Set(input.recipients.map((r) => r.userId));
    let arrived = false;
    // The signal a FlowArrivals call sends reaches this flow's handler only by this flow's id.
    temporal.signal.mockImplementation(async (workflowId, signalName, args) => {
      const [arrival] = args;
      if (workflowId !== input.flowId || signalName !== 'flowArrival') return false;
      assert(isArrival(arrival));
      if (ids.has(arrival.recipientUserId)) arrived = true;
      return true;
    });
    const waits: number[] = [];
    const activities = createNotificationActivities({ sender, recipients, writes }, () => 1);
    await runFlow<FlowRecipient>(
      {
        flow: input.flow,
        recipients: input.recipients,
        conditions: { type_is_critical: input.critical, audience_is_institute: true },
      },
      {
        send: async (recipient, channel) => {
          try {
            const result = await activities.sendChannel({
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
            });
            return typeof result === 'string' ? result : 'SKIPPED';
          } catch {
            return 'FAILED';
          }
        },
        waitForArrival: async (ms) => {
          waits.push(ms);
          await onWait(ms);
          return arrived;
        },
        arrived: () => arrived,
        sleep: async () => {},
        recordSkip: (recipient, channel, reason) =>
          activities.recordSkip({
            audience: input.audience,
            recipientUserId: recipient.userId,
            notificationId: recipient.notificationId,
            type: input.message.type,
            channel,
            reason,
            flowId: input.flowId,
          }),
      },
    );
    return { waits };
  }

  async function rowsOf(flowId: string) {
    const { rows } = await superPool.query<{
      recipient_user_id: string;
      channel: string;
      status: string;
      skip_reason: string | null;
      provider_message_id: string | null;
    }>(
      `SELECT recipient_user_id, channel, status, skip_reason, provider_message_id
         FROM notification_deliveries WHERE flow_id = $1 ORDER BY created_at, id`,
      [flowId],
    );
    return rows;
  }

  /** The outcome of every paid channel per guardian, in order of rows. */
  async function paidOf(flowId: string, family: Family) {
    const name = new Map(family.guardians.map((g, i) => [g.userId, `g${i + 1}`]));
    return (await rowsOf(flowId))
      .filter((r) => r.channel === 'WHATSAPP' || r.channel === 'SMS')
      .map((r) => [name.get(r.recipient_user_id), r.channel, r.status, r.skip_reason]);
  }

  const paidLog = (family: Family) => {
    const name = new Map(family.guardians.map((g, i) => [g.userId, `g${i + 1}`]));
    return log
      .filter((s) => s.channel !== 'PUSH' && name.has(s.userId))
      .map((s) => [name.get(s.userId), s.channel]);
  };

  /** A WhatsApp provider's delivery report, handled as the webhook service handles one. */
  async function whatsappDelivered(providerMessageId: string) {
    const result = await receipts.record({
      provider: WHATSAPP_PROVIDER,
      providerMessageId,
      status: 'DELIVERED',
      errorCode: null,
    });
    assert(result.kind === 'recorded' && result.arrival);
    const { flowId, recipientUserId, channel } = result.arrival;
    await flowArrivals.arrived(flowId, recipientUserId, channel);
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
    // Alerts go out at once (no digest), on every channel.
    await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx.insert(instituteNotificationConfigs).values({
        ...by,
        tenantId: institute.tenantId,
        notificationType: 'ATTENDANCE',
        pushEnabled: true,
        whatsappEnabled: true,
        emailEnabled: true,
        digestEnabled: false,
      }),
    );

    writes = new NotificationWriteDrizzleRepository(db);
    recipients = new RecipientReadDrizzleRepository(db);
    receipts = new DeliveryReceiptDrizzleRepository(db);
    flowArrivals = new FlowArrivals(temporal);
    sender = new ChannelSender(
      new ChannelAdapters([
        new RecordingAdapter('PUSH', 'recording-push'),
        new RecordingAdapter('WHATSAPP', WHATSAPP_PROVIDER),
        new RecordingAdapter('SMS', SMS_HTTP_PROVIDER),
      ]),
      new GuardianConsentGate(new ConsentReadDrizzleRepository(db)),
      new ContactReadDrizzleRepository(db),
      writes,
      new WhatsAppRoute(new MessagingSenderDrizzleRepository(db), recipients, new Clock()),
      new NotificationMetrics(),
    );
    const dispatcher = new NotificationDispatcher(
      new NotificationConfigReadDrizzleRepository(db),
      recipients,
      writes,
      sender,
      temporal,
      eventBus,
      createMock<RetryWait>(),
    );
    attendance = new AttendanceListener(dispatcher, new RecipientResolver(recipients));
    arrivals = new ArrivalListener(
      new FlowArrivalDrizzleRepository(db),
      flowArrivals,
      new NotificationMetrics(),
    );
    smsWebhook = new SmsWebhookService(receipts, flowArrivals, new NotificationMetrics());
  });

  beforeEach(() => {
    log.length = 0;
    temporal.startWorkflowOnce.mockClear();
    temporal.signal.mockReset().mockResolvedValue(false);
    eventBus.emit.mockClear();
  });

  afterAll(async () => {
    if (!db) return;
    const userIds = people.map((p) => p.userId);
    const tenantIds = [institute?.tenantId, foreignInstitute?.tenantId].filter(
      (id): id is string => typeof id === 'string',
    );
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)', [
      userIds,
    ]);
    await superPool.query('DELETE FROM notifications WHERE recipient_user_id = ANY($1)', [userIds]);
    await superPool.query('DELETE FROM consent_records WHERE guardian_profile_id = ANY($1)', [
      profileIds,
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
      await tx.delete(phoneNumbers).where(inArray(phoneNumbers.userId, userIds));
      await tx.delete(deviceTokens).where(inArray(deviceTokens.userId, userIds));
    });
    if (institute) await cleanupTestInstitute(db, institute);
    if (foreignInstitute) await cleanupTestInstitute(db, foreignInstitute);
    for (const person of people) await cleanupTestTeacher(db, person);
    await pool.end();
    await superPool.end();
  });

  it('should end the flow when the second guardian reads the app copy: no paid message to anyone', async () => {
    const family = await makeFamily([{}, {}]);
    const [g1, g2] = family.guardians;
    assert(g1 && g2);
    const input = await startFlow(family);
    const [r1, r2] = input.recipients;
    const first = r1?.notificationId;
    const second = r2?.notificationId;
    assert(first && second);

    const inApp = await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ userId: notifications.recipientUserId, flowId: notifications.flowId })
        .from(notifications)
        .where(inArray(notifications.id, [first, second])),
    );
    expect(inApp.map((r) => [r.userId, r.flowId]).sort()).toEqual(
      [
        [g1.userId, input.flowId],
        [g2.userId, input.flowId],
      ].sort(),
    );

    const { waits } = await walk(input, () =>
      arrivals.handleSeen({ notificationId: second, recipientUserId: g2.userId }),
    );

    expect(waits).toEqual([30 * MIN]);
    // Both pushes go out together, so their order is not fixed.
    expect(log.map((s) => [s.channel, s.userId]).sort()).toEqual(
      [
        ['PUSH', g1.userId],
        ['PUSH', g2.userId],
      ].sort(),
    );
    expect(await paidOf(input.flowId, family)).toEqual([
      ['g1', 'WHATSAPP', 'SKIPPED', 'not_needed'],
      ['g1', 'SMS', 'SKIPPED', 'not_needed'],
      ['g2', 'WHATSAPP', 'SKIPPED', 'not_needed'],
      ['g2', 'SMS', 'SKIPPED', 'not_needed'],
    ]);
  });

  it("should send WhatsApp to the first guardian only, and end on that message's delivery report", async () => {
    const family = await makeFamily([{}, {}]);
    const input = await startFlow(family);

    const { waits } = await walk(input, async (ms) => {
      if (ms !== 15 * MIN) return;
      const [row] = (await rowsOf(input.flowId)).filter(
        (r) => r.channel === 'WHATSAPP' && r.status === 'SENT',
      );
      assert(row?.provider_message_id);
      await whatsappDelivered(row.provider_message_id);
    });

    expect(waits).toEqual([30 * MIN, 15 * MIN]);
    expect(paidLog(family)).toEqual([['g1', 'WHATSAPP']]);
    expect(log.find((s) => s.channel === 'WHATSAPP')?.to).toEqual([family.phones[0]]);
    expect(await paidOf(input.flowId, family)).toEqual([
      ['g1', 'WHATSAPP', 'SENT', null],
      ['g1', 'WHATSAPP', 'DELIVERED', null],
      ['g1', 'SMS', 'SKIPPED', 'not_needed'],
      ['g2', 'WHATSAPP', 'SKIPPED', 'not_needed'],
      ['g2', 'SMS', 'SKIPPED', 'not_needed'],
    ]);
  });

  it('should send the second guardian WhatsApp then SMS when the first is reached on neither', async () => {
    const family = await makeFamily([{}, {}]);
    const input = await startFlow(family);

    const { waits } = await walk(input);

    expect(paidLog(family)).toEqual([
      ['g1', 'WHATSAPP'],
      ['g1', 'SMS'],
      ['g2', 'WHATSAPP'],
      ['g2', 'SMS'],
    ]);
    // No wait after the last send of the flow.
    expect(waits).toEqual([30 * MIN, 15 * MIN, 5 * MIN, 15 * MIN]);
  });

  it('should be reached by an SMS delivery report through the SMS webhook', async () => {
    const family = await makeFamily([{}, {}]);
    const input = await startFlow(family);

    await walk(input, async (ms) => {
      if (ms !== 5 * MIN) return;
      const [row] = (await rowsOf(input.flowId)).filter(
        (r) => r.channel === 'SMS' && r.status === 'SENT',
      );
      assert(row?.provider_message_id);
      await smsWebhook.handle([
        { requestId: row.provider_message_id, status: 'DELIVERED', errorCode: null },
      ]);
    });

    expect(paidLog(family)).toEqual([
      ['g1', 'WHATSAPP'],
      ['g1', 'SMS'],
    ]);
  });

  it('should send the second guardian WhatsApp at once when the first opted out and has no phone', async () => {
    const family = await makeFamily([{ consent: false, phone: false }, {}]);
    const input = await startFlow(family);

    const { waits } = await walk(input);

    // After the app step, the first wait is the second guardian's WhatsApp: nothing waited for g1.
    expect(waits).toEqual([30 * MIN, 15 * MIN]);
    expect(paidLog(family)).toEqual([
      ['g2', 'WHATSAPP'],
      ['g2', 'SMS'],
    ]);
    expect(await paidOf(input.flowId, family)).toEqual([
      ['g1', 'WHATSAPP', 'SKIPPED', 'no_consent'],
      ['g1', 'SMS', 'SKIPPED', 'no_address'],
      ['g2', 'WHATSAPP', 'SENT', null],
      ['g2', 'SMS', 'SENT', null],
    ]);
  });

  it('should never try a third guardian on a paid channel', async () => {
    const family = await makeFamily([{}, {}, {}]);
    const [, , g3] = family.guardians;
    assert(g3);
    const input = await startFlow(family);

    await walk(input);

    expect(paidLog(family).filter(([name]) => name === 'g3')).toEqual([]);
    const rowsOfThird = (await rowsOf(input.flowId)).filter(
      (r) => r.recipient_user_id === g3.userId,
    );
    expect(rowsOfThird.map((r) => [r.channel, r.status])).toEqual([['PUSH', 'SENT']]);
  });

  it('should start the flow with guardian ids only: no name, phone or email of theirs', async () => {
    const family = await makeFamily([{}, {}]);
    const input = await startFlow(family);

    const serialized = JSON.stringify(input);
    expect(input.recipients.map((r) => r.userId)).toEqual(family.guardians.map((g) => g.userId));
    for (const [index, guardian] of family.guardians.entries()) {
      expect(serialized).not.toContain(guardian.username);
      expect(serialized).not.toContain(`${guardian.username}@test.local`);
      const phone = family.phones[index];
      assert(phone);
      expect(serialized).not.toContain(phone.slice(3));
    }
  });

  it('should not message a guardian unlinked after the flow started', async () => {
    const family = await makeFamily([{}, {}]);
    const [g1, g2] = family.guardians;
    const [firstProfile] = family.guardianProfileIds;
    assert(g1 && g2 && firstProfile);
    const input = await startFlow(family);
    await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .delete(studentGuardianLinks)
        .where(
          and(
            eq(studentGuardianLinks.guardianProfileId, firstProfile),
            eq(studentGuardianLinks.studentProfileId, family.studentProfileId),
          ),
        ),
    );

    await walk(input);

    expect(log.filter((s) => s.userId === g1.userId)).toEqual([]);
    const ofFirst = (await rowsOf(input.flowId)).filter((r) => r.recipient_user_id === g1.userId);
    expect(ofFirst.map((r) => [r.channel, r.status, r.skip_reason])).toEqual([
      ['PUSH', 'SKIPPED', 'recipient_removed'],
      ['WHATSAPP', 'SKIPPED', 'recipient_removed'],
      ['SMS', 'SKIPPED', 'recipient_removed'],
    ]);
    expect(paidLog(family)).toEqual([
      ['g2', 'WHATSAPP'],
      ['g2', 'SMS'],
    ]);
  });

  it("should treat a guardian of another institute's student as removed", async () => {
    const foreignFamily = await makeFamily([{}], foreignInstitute.tenantId);
    const [foreignGuardian] = foreignFamily.guardians;
    assert(foreignGuardian);
    const activities = createNotificationActivities({ sender, recipients, writes }, () => 1);
    const flowId = `notification-flow:spec-${RUN}-foreign`;

    const result = await activities.sendChannel({
      audience: { scope: 'institute', tenantId: institute.tenantId, resellerId: null },
      recipientUserId: foreignGuardian.userId,
      channel: 'SMS',
      enabled: true,
      content: {
        kind: 'single',
        message: { type: 'ATTENDANCE_ABSENT', params: { ...absenceParams(foreignFamily) } },
        notificationId: null,
      },
      data: {},
      deferrable: true,
      flowId,
      recipientsRef: {
        kind: 'guardians_of_student',
        studentMembershipId: foreignFamily.student.membershipId,
      },
    });

    expect(result).toBe('SKIPPED');
    expect(log).toEqual([]);
    expect((await rowsOf(flowId)).map((r) => [r.status, r.skip_reason])).toEqual([
      ['SKIPPED', 'recipient_removed'],
    ]);
  });

  it('should go to WhatsApp at once without a device token, without the 30-minute wait', async () => {
    const family = await makeFamily([{ device: false }]);
    const input = await startFlow(family);

    const { waits } = await walk(input);

    expect(waits).toEqual([15 * MIN]);
    expect((await rowsOf(input.flowId)).map((r) => [r.channel, r.status, r.skip_reason])).toEqual([
      ['PUSH', 'SKIPPED', 'no_address'],
      ['WHATSAPP', 'SENT', null],
      ['SMS', 'SENT', null],
    ]);
  });

  it('should send neither WhatsApp nor SMS when the push is acknowledged within the wait', async () => {
    const family = await makeFamily([{}]);
    const [g1] = family.guardians;
    assert(g1);
    const input = await startFlow(family);
    const [r1] = input.recipients;
    assert(r1?.notificationId);

    await walk(input, () =>
      arrivals.handlePushAcknowledged({
        notificationId: r1.notificationId,
        recipientUserId: g1.userId,
      }),
    );

    expect(log.map((s) => s.channel)).toEqual(['PUSH']);
    expect((await rowsOf(input.flowId)).map((r) => [r.channel, r.status, r.skip_reason])).toEqual([
      ['PUSH', 'SENT', null],
      ['PUSH', 'DELIVERED', null],
      ['WHATSAPP', 'SKIPPED', 'not_needed'],
      ['SMS', 'SKIPPED', 'not_needed'],
    ]);
  });

  it('should not end the flow on a seen event or acknowledgement of another flow or recipient', async () => {
    const family = await makeFamily([{}]);
    const other = await makeFamily([{}]);
    const [g1] = family.guardians;
    const [otherGuardian] = other.guardians;
    assert(g1 && otherGuardian);
    const otherInput = await startFlow(other);
    await walk(otherInput, async () => {});
    const input = await startFlow(family);
    const [mine] = input.recipients;
    const [theirs] = otherInput.recipients;
    assert(mine?.notificationId && theirs?.notificationId);

    const { waits } = await walk(input, async () => {
      // Another flow's notification, read by its own recipient: signals that flow only.
      await arrivals.handleSeen({
        notificationId: theirs.notificationId,
        recipientUserId: otherGuardian.userId,
      });
      // This flow's notification named with someone else's id: found for nobody.
      await arrivals.handleSeen({
        notificationId: mine.notificationId,
        recipientUserId: otherGuardian.userId,
      });
      await arrivals.handlePushAcknowledged({
        notificationId: mine.notificationId,
        recipientUserId: otherGuardian.userId,
      });
    });

    expect(waits).toEqual([30 * MIN, 15 * MIN]);
    expect(paidLog(family)).toEqual([
      ['g1', 'WHATSAPP'],
      ['g1', 'SMS'],
    ]);
    expect(temporal.signal.mock.calls.map(([workflowId]) => workflowId)).toEqual([
      otherInput.flowId,
      otherInput.flowId,
    ]);
  });

  it('should append one DELIVERED push row for two acknowledgements, and none for another recipient', async () => {
    const family = await makeFamily([{}, {}]);
    const [g1, g2] = family.guardians;
    assert(g1 && g2);
    const input = await startFlow(family);
    const [r1] = input.recipients;
    assert(r1?.notificationId);
    await walk(input, () =>
      arrivals.handlePushAcknowledged({
        notificationId: r1.notificationId,
        recipientUserId: g1.userId,
      }),
    );

    await arrivals.handlePushAcknowledged({
      notificationId: r1.notificationId,
      recipientUserId: g1.userId,
    });
    await arrivals.handlePushAcknowledged({
      notificationId: r1.notificationId,
      recipientUserId: g2.userId,
    });

    const pushRows = (await rowsOf(input.flowId)).filter((r) => r.channel === 'PUSH');
    // Both pushes go out together, so their two SENT rows come in either order.
    const outcomes = pushRows.map((r) => `${r.status}:${r.recipient_user_id}`).sort();
    expect(outcomes).toEqual(
      [`SENT:${g1.userId}`, `SENT:${g2.userId}`, `DELIVERED:${g1.userId}`].sort(),
    );
    expect(temporal.signal).toHaveBeenCalledTimes(1);
  });

  it('should start no second flow and write no second in-app row for a redelivered event', async () => {
    const family = await makeFamily([{}, {}]);
    const ctx = jetStreamCtx();
    temporal.startWorkflowOnce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await attendance.handleAbsent(absence(family), ctx);
    await attendance.handleAbsent(absence(family), ctx);

    const ids = temporal.startWorkflowOnce.mock.calls.map(([, options]) => options.workflowId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
    const rows = await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          inArray(
            notifications.recipientUserId,
            family.guardians.map((g) => g.userId),
          ),
        ),
    );
    expect(rows).toHaveLength(2);
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
  });

  function absenceParams(family: Family) {
    return {
      sessionId: `session-${RUN}-foreign`,
      studentId: family.student.membershipId,
      studentName: null,
      status: 'ABSENT' as const,
      markedAt: '2026-04-10T03:35:00.000Z',
      sessionDate: null,
      sectionName: null,
      standardName: null,
    };
  }
});
