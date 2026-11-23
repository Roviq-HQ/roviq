/**
 * ROV-328 against the real test database: the order of a student's guardians, and which of
 * them is sent the paid channels.
 */
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { GuardianRelationship } from '@roviq/common-types';
import {
  createDrizzleDb,
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  notifications,
  roles,
  SYSTEM_USER_ID,
  staffProfiles,
  studentGuardianLinks,
  studentProfiles,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import type { JetStreamContext } from '@roviq/nats-jetstream';
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
import { inArray } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelSender } from '../delivery/channel-sender';
import { AttendanceListener } from '../listeners/attendance.listener';
import { NotificationConfigReadDrizzleRepository } from '../repositories/notification-config-read.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';
import type { DeliveryWorkflowInput } from '../workflows/notification-workflow.types';

const CTX = 'test:guardian-order';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

type Staff = 'no' | 'active' | 'suspended' | 'other_institute';
interface GuardianSpec {
  primary: boolean;
  staff: Staff;
}

/** The delivery and the digest workflow input both carry the recipient and the channel plan. */
function isWorkflowInput(
  value: unknown,
): value is Pick<DeliveryWorkflowInput, 'recipientUserId' | 'channels'> {
  return (
    typeof value === 'object' && value !== null && 'recipientUserId' in value && 'channels' in value
  );
}

describe('guardian order for alerts (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let foreignInstitute: TestInstitute;
  let recipients: RecipientReadDrizzleRepository;
  let resolver: RecipientResolver;
  let attendance: AttendanceListener;
  const people: TestTeacher[] = [];
  const temporal = createMock<TemporalClientService>({
    startWorkflowOnce: vi.fn().mockResolvedValue(true),
    signalWithStart: vi.fn().mockResolvedValue('run-1'),
  });
  let linkMinute = 0;
  let sequence = 5_000;

  /** A staff profile for an existing user, on its own membership of the given institute. */
  async function makeStaff(userId: string, tenantId: string, status: 'ACTIVE' | 'SUSPENDED') {
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          ...by,
          name: { en: `Staff ${userId.slice(-6)} ${tenantId.slice(-6)}` },
          scope: 'institute',
          tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
        })
        .returning({ id: roles.id });
      assert(role);
      const [membership] = await tx
        .insert(memberships)
        .values({ ...by, userId, roleId: role.id, tenantId, status })
        .returning({ id: memberships.id });
      assert(membership);
      await tx
        .insert(staffProfiles)
        .values({ ...by, tenantId, userId, membershipId: membership.id });
    });
  }

  /** A student and its guardians, linked in the order given, one minute apart. */
  async function makeFamily(specs: GuardianSpec[]) {
    const student = await createTestTeacher(db, institute.tenantId);
    people.push(student);
    const guardians: TestTeacher[] = [];
    for (const _ of specs) {
      const guardian = await createTestTeacher(db, institute.tenantId);
      people.push(guardian);
      guardians.push(guardian);
    }
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [studentProfile] = await tx
        .insert(studentProfiles)
        .values({
          ...by,
          tenantId: institute.tenantId,
          userId: student.userId,
          membershipId: student.membershipId,
          admissionNumber: `ROV328-${student.membershipId.slice(-6)}`,
          admissionDate: '2025-04-01',
        })
        .returning({ id: studentProfiles.id });
      assert(studentProfile);
      for (const [index, spec] of specs.entries()) {
        const guardian = guardians[index];
        assert(guardian);
        const [profile] = await tx
          .insert(guardianProfiles)
          .values({
            ...by,
            tenantId: institute.tenantId,
            userId: guardian.userId,
            membershipId: guardian.membershipId,
          })
          .returning({ id: guardianProfiles.id });
        assert(profile);
        linkMinute += 1;
        await tx.insert(studentGuardianLinks).values({
          ...by,
          tenantId: institute.tenantId,
          studentProfileId: studentProfile.id,
          guardianProfileId: profile.id,
          relationship: GuardianRelationship.FATHER,
          isPrimaryContact: spec.primary,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, linkMinute)),
        });
      }
    });
    for (const [index, spec] of specs.entries()) {
      const guardian = guardians[index];
      assert(guardian);
      if (spec.staff === 'active') await makeStaff(guardian.userId, institute.tenantId, 'ACTIVE');
      if (spec.staff === 'suspended')
        await makeStaff(guardian.userId, institute.tenantId, 'SUSPENDED');
      if (spec.staff === 'other_institute')
        await makeStaff(guardian.userId, foreignInstitute.tenantId, 'ACTIVE');
    }
    return { student, guardians };
  }

  async function orderOf(student: TestTeacher): Promise<string[]> {
    const found = await recipients.findStudentGuardians(institute.tenantId, student.membershipId);
    return found.map((guardian) => guardian.userId);
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
    recipients = new RecipientReadDrizzleRepository(db);
    resolver = new RecipientResolver(recipients);
    const dispatcher = new NotificationDispatcher(
      new NotificationConfigReadDrizzleRepository(db),
      recipients,
      new NotificationWriteDrizzleRepository(db),
      createMock<ChannelSender>(),
      temporal,
      createMock<EventBusService>({ emit: vi.fn() }),
      createMock<RetryWait>(),
    );
    attendance = new AttendanceListener(dispatcher, resolver);
  });

  afterEach(() => {
    temporal.startWorkflowOnce.mockClear();
    temporal.signalWithStart.mockClear();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!db) return;
    const tenantIds = [institute?.tenantId, foreignInstitute?.tenantId].filter(
      (id): id is string => typeof id === 'string',
    );
    await superPool.query('DELETE FROM notifications WHERE recipient_user_id = ANY($1)', [
      people.map((person) => person.userId),
    ]);
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      await tx
        .delete(studentGuardianLinks)
        .where(inArray(studentGuardianLinks.tenantId, tenantIds));
      await tx.delete(guardianProfiles).where(inArray(guardianProfiles.tenantId, tenantIds));
      await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
      await tx.delete(staffProfiles).where(inArray(staffProfiles.tenantId, tenantIds));
    });
    // Institutes first: that removes every membership, the extra staff ones included.
    if (institute) await cleanupTestInstitute(db, institute);
    if (foreignInstitute) await cleanupTestInstitute(db, foreignInstitute);
    for (const person of people) await cleanupTestTeacher(db, person);
    await pool.end();
    await superPool.end();
  });

  it('should put the primary guardian first when nobody is staff', async () => {
    const { student, guardians } = await makeFamily([
      { primary: false, staff: 'no' },
      { primary: true, staff: 'no' },
    ]);
    const [other, primary] = guardians;
    assert(other && primary);

    expect(await orderOf(student)).toEqual([primary.userId, other.userId]);
  });

  it('should put a guardian who is active staff of the institute before the primary', async () => {
    const { student, guardians } = await makeFamily([
      { primary: true, staff: 'no' },
      { primary: false, staff: 'active' },
    ]);
    const [primary, staff] = guardians;
    assert(primary && staff);

    expect(await orderOf(student)).toEqual([staff.userId, primary.userId]);
  });

  it('should not count staff of another institute, or a suspended staff membership', async () => {
    const { student, guardians } = await makeFamily([
      { primary: true, staff: 'no' },
      { primary: false, staff: 'other_institute' },
      { primary: false, staff: 'suspended' },
    ]);

    expect(await orderOf(student)).toEqual(guardians.map((guardian) => guardian.userId));
  });

  it('should put the primary first among two staff guardians', async () => {
    const { student, guardians } = await makeFamily([
      { primary: false, staff: 'active' },
      { primary: true, staff: 'active' },
      { primary: false, staff: 'no' },
    ]);
    const [staff, primaryStaff, other] = guardians;
    assert(staff && primaryStaff && other);

    expect(await orderOf(student)).toEqual([primaryStaff.userId, staff.userId, other.userId]);
  });

  it('should use the earliest link and log a warning when no guardian is primary', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { student, guardians } = await makeFamily([
      { primary: false, staff: 'no' },
      { primary: false, staff: 'no' },
    ]);

    const targets = await resolver.guardiansOfStudent(institute.tenantId, student.membershipId);

    expect(targets.map((target) => target.recipient.userId)).toEqual(
      guardians.map((guardian) => guardian.userId),
    );
    expect(targets.map((target) => target.appOnly)).toEqual([false, true]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no primary guardian'));
  });

  it("should resolve no guardian for another institute's student id", async () => {
    const { student } = await makeFamily([{ primary: true, staff: 'no' }]);

    const asForeign = await recipients.findStudentGuardians(
      foreignInstitute.tenantId,
      student.membershipId,
    );

    expect(asForeign).toEqual([]);
  });

  it('should give every guardian the in-app alert, and the paid channels to the first only', async () => {
    const { student, guardians } = await makeFamily([
      { primary: true, staff: 'no' },
      { primary: false, staff: 'active' },
    ]);
    const [primary, staff] = guardians;
    assert(primary && staff);
    sequence += 1;
    const seq = sequence;

    await attendance.handleAbsent(
      {
        tenantId: institute.tenantId,
        sessionId: `session-${seq}`,
        studentId: student.membershipId,
        studentName: 'Aarav Sharma',
        status: 'ABSENT',
        remarks: null,
        markedAt: '2026-04-10T03:35:00.000Z',
        sessionDate: '2026-04-10',
        sectionName: 'A',
        standardName: 'Class 5',
      },
      createMock<JetStreamContext>({
        getStream: vi.fn().mockReturnValue('NOTIFICATION'),
        getSequence: vi.fn().mockReturnValue({ stream: seq, consumer: 1 }),
      }),
    );

    const inApp = await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ userId: notifications.recipientUserId })
        .from(notifications)
        .where(inArray(notifications.recipientUserId, [primary.userId, staff.userId])),
    );
    expect(inApp.map((row) => row.userId).sort()).toEqual([primary.userId, staff.userId].sort());

    const plans = new Map<string, string[]>();
    const started = [
      ...temporal.startWorkflowOnce.mock.calls,
      ...temporal.signalWithStart.mock.calls,
    ];
    for (const [, options] of started) {
      const [input] = options.args ?? [];
      assert(isWorkflowInput(input));
      plans.set(
        input.recipientUserId,
        input.channels.map((plan) => plan.channel),
      );
    }
    expect(plans.get(staff.userId)).toEqual(['WHATSAPP', 'EMAIL', 'PUSH']);
    expect(plans.get(primary.userId)).toEqual(['PUSH']);
  });
});
