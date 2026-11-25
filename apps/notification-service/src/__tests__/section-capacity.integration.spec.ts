/**
 * ROV-351 against the real test database: a section reaching its optimal strength tells its
 * class teacher, else the institute's academic coordinators, once per event.
 */
import assert from 'node:assert/strict';
import { DefaultRoles } from '@roviq/common-types';
import {
  academicYears,
  createDrizzleDb,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  notifications,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
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
import { and, eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelSender } from '../delivery/channel-sender';
import { SectionListener } from '../listeners/section.listener';
import { NotificationConfigReadDrizzleRepository } from '../repositories/notification-config-read.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { NotificationDispatcher, RetryWait } from '../services/notification-dispatcher.service';
import { RecipientResolver } from '../services/recipient-resolver.service';

const CTX = 'test:section-capacity';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

describe('section capacity warning (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let foreignInstitute: TestInstitute;
  let listener: SectionListener;
  let standardId: string;
  let yearId: string;
  let classTeacher: TestTeacher;
  let coordinators: TestTeacher[];
  let foreignCoordinator: TestTeacher;
  const people: TestTeacher[] = [];
  let sequence = 9_000;

  const temporal = createMock<TemporalClientService>({
    startWorkflowOnce: vi.fn().mockResolvedValue(true),
    signalWithStart: vi.fn().mockResolvedValue('run-1'),
  });

  async function person(tenantId: string): Promise<TestTeacher> {
    const created = await createTestTeacher(db, tenantId);
    people.push(created);
    return created;
  }

  /** Gives the members the institute's academic coordinator role. */
  async function makeCoordinators(tenantId: string, members: TestTeacher[]) {
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          ...by,
          name: { en: DefaultRoles.AcademicCoordinator },
          scope: 'institute',
          tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
        })
        .returning({ id: roles.id });
      assert(role);
      await tx
        .update(memberships)
        .set({ roleId: role.id })
        .where(
          inArray(
            memberships.id,
            members.map((member) => member.membershipId),
          ),
        );
    });
  }

  async function makeSection(classTeacherId: string | null): Promise<string> {
    const [section] = await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .insert(sections)
        .values({
          ...by,
          tenantId: institute.tenantId,
          academicYearId: yearId,
          standardId,
          name: { en: `S${sequence}`, hi: `खंड ${sequence}` },
          classTeacherId,
        })
        .returning({ id: sections.id }),
    );
    assert(section);
    return section.id;
  }

  async function warn(tenantId: string, sectionId: string, seq = ++sequence) {
    await listener.handleCapacityWarning(
      { tenantId, sectionId, currentStrength: 40, optimal: 40 },
      createMock<JetStreamContext>({
        getStream: vi.fn().mockReturnValue('NOTIFICATION'),
        getSequence: vi.fn().mockReturnValue({ stream: seq, consumer: 1 }),
      }),
    );
  }

  async function sentFor(sectionId: string) {
    const rows = await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({
          userId: notifications.recipientUserId,
          tenantId: notifications.tenantId,
          title: notifications.title,
          body: notifications.body,
          data: notifications.data,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.type, 'SECTION_CAPACITY_WARNING'),
            inArray(
              notifications.recipientUserId,
              people.map((p) => p.userId),
            ),
          ),
        ),
    );
    return rows.filter((row) => row.data?.sectionId === sectionId);
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

    const recipients = new RecipientReadDrizzleRepository(db);
    const dispatcher = new NotificationDispatcher(
      new NotificationConfigReadDrizzleRepository(db),
      recipients,
      new NotificationWriteDrizzleRepository(db),
      createMock<ChannelSender>(),
      temporal,
      createMock<EventBusService>({ emit: vi.fn() }),
      createMock<RetryWait>(),
    );
    listener = new SectionListener(dispatcher, new RecipientResolver(recipients));

    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [year] = await tx
        .insert(academicYears)
        .values({
          ...by,
          tenantId: institute.tenantId,
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          isActive: true,
          status: 'ACTIVE',
        })
        .returning({ id: academicYears.id });
      assert(year);
      yearId = year.id;
      const [standard] = await tx
        .insert(standards)
        .values({
          ...by,
          tenantId: institute.tenantId,
          academicYearId: year.id,
          name: { en: 'Class 5', hi: 'कक्षा 5' },
          numericOrder: 5,
        })
        .returning({ id: standards.id });
      assert(standard);
      standardId = standard.id;
    });

    classTeacher = await person(institute.tenantId);
    coordinators = [await person(institute.tenantId), await person(institute.tenantId)];
    await makeCoordinators(institute.tenantId, coordinators);
    foreignCoordinator = await person(foreignInstitute.tenantId);
    await makeCoordinators(foreignInstitute.tenantId, [foreignCoordinator]);
  });

  afterAll(async () => {
    if (!db) return;
    await superPool.query('DELETE FROM notifications WHERE recipient_user_id = ANY($1)', [
      people.map((p) => p.userId),
    ]);
    const tenantIds = [institute?.tenantId, foreignInstitute?.tenantId].filter(
      (id): id is string => typeof id === 'string',
    );
    await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      await tx.delete(sections).where(inArray(sections.tenantId, tenantIds));
      await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
      await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
    });
    // Institutes first: that removes every membership and the coordinator roles.
    if (institute) await cleanupTestInstitute(db, institute);
    if (foreignInstitute) await cleanupTestInstitute(db, foreignInstitute);
    for (const p of people) await cleanupTestTeacher(db, p);
    await pool.end();
    await superPool.end();
  });

  it('tells the class teacher only, with the six-point copy and a link to the standard', async () => {
    const name = `S${sequence}`;
    const sectionId = await makeSection(classTeacher.membershipId);
    await warn(institute.tenantId, sectionId);

    const sent = await sentFor(sectionId);
    expect(sent.map((row) => row.userId)).toEqual([classTeacher.userId]);
    const [row] = sent;
    assert(row);
    expect(row.tenantId).toBe(institute.tenantId);
    expect(row.title).toEqual({
      en: `Class 5 ${name} has reached its usual size`,
      hi: expect.stringContaining('कक्षा 5'),
    });
    expect(row.body.en).toContain('now has 40 students');
    expect(row.body.en).toContain('add a section or move some students');
    expect(row.body.en).toContain('drops below 40');
    expect(row.body.hi).toContain('40');
    expect(row.data).toMatchObject({
      sectionId,
      standardId,
      path: `/institute/academics/${standardId}`,
    });
  });

  it('tells every academic coordinator when the section has no class teacher', async () => {
    const sectionId = await makeSection(null);
    await warn(institute.tenantId, sectionId);

    const sent = await sentFor(sectionId);
    expect(sent.map((row) => row.userId).sort()).toEqual(coordinators.map((c) => c.userId).sort());
  });

  it('falls back to the coordinators when the class teacher is suspended', async () => {
    const suspended = await person(institute.tenantId);
    await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .update(memberships)
        .set({ status: 'SUSPENDED' })
        .where(eq(memberships.id, suspended.membershipId)),
    );
    const sectionId = await makeSection(suspended.membershipId);
    await warn(institute.tenantId, sectionId);

    const sent = await sentFor(sectionId);
    expect(sent.map((row) => row.userId).sort()).toEqual(coordinators.map((c) => c.userId).sort());
  });

  it('stores one notification when the same event is delivered twice', async () => {
    const sectionId = await makeSection(classTeacher.membershipId);
    const seq = ++sequence;
    await warn(institute.tenantId, sectionId, seq);
    await warn(institute.tenantId, sectionId, seq);

    expect(await sentFor(sectionId)).toHaveLength(1);
  });

  it("sends nothing for another institute's section id", async () => {
    const sectionId = await makeSection(classTeacher.membershipId);
    await warn(foreignInstitute.tenantId, sectionId);

    expect(await sentFor(sectionId)).toEqual([]);
    const foreignRows = await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.recipientUserId, foreignCoordinator.userId)),
    );
    expect(foreignRows).toEqual([]);
  });
});
