/**
 * The institute delivery log (ROV-327) through resolver, service, repository and RLS: one
 * entry per message and recipient, the state per channel, every filter, pagination, and
 * isolation from other institutes and from platform and reseller rows.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ROLE_ABILITIES,
  GuardianRelationship,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationTypeKey,
} from '@roviq/common-types';
import {
  guardianProfiles,
  memberships,
  mkAdminCtx,
  notificationDeliveries,
  notifications,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  tenantUserProfiles,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const CTX = 'test:notification-delivery-log';
const SUPERUSER_URL =
  process.env.DATABASE_URL_TEST_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5434/roviq_test';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const LOG = `query($filter: NotificationDeliveryLogFilterInput, $first: Int, $after: String) {
  notificationDeliveryLog(filter: $filter, first: $first, after: $after) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges { cursor node {
      id type module critical at studentMembershipId studentFirstName studentLastName
      recipientUserId recipientFirstName recipientLastName relationship
      channels { channel state reason at }
    } }
  }
}`;

interface ChannelNode {
  channel: NotificationChannel;
  state: string;
  reason: string | null;
  at: string;
}
interface EntryNode {
  id: string;
  type: string;
  module: string;
  critical: boolean;
  at: string;
  studentMembershipId: string | null;
  studentFirstName: Record<string, string> | null;
  studentLastName: Record<string, string> | null;
  recipientUserId: string;
  recipientFirstName: Record<string, string> | null;
  recipientLastName: Record<string, string> | null;
  relationship: string | null;
  channels: ChannelNode[];
}
interface LogData {
  notificationDeliveryLog: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { cursor: string; node: EntryNode }[];
  };
}

/** Row times: minute offsets from a fixed start, so `at` and the date filters are exact. */
const START = Date.parse('2026-03-02T04:00:00.000Z');
const minute = (n: number) => new Date(START + n * 60_000);
const iso = (n: number) => minute(n).toISOString();

describe('notificationDeliveryLog (integration)', () => {
  let app: IntegrationAppResult;
  let superPool: pg.Pool;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let studentA: TestTeacher;
  let guardianA: TestTeacher;
  let guardianA2: TestTeacher;
  let studentB: TestTeacher;
  let guardianB: TestTeacher;
  let principal: TestTeacher;
  let teacher: TestTeacher;
  const people: TestTeacher[] = [];
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const run = randomUUID().slice(0, 8);
  /** Values that must never reach a response. */
  const secret = {
    pm: [1, 2, 3, 4, 5, 6].map((n) => `wamid.secret-${run}-${n}`),
    flow: [
      `notification-flow:a-${run}`,
      `notification-flow:b-${run}`,
      `notification-flow:c-${run}`,
    ],
  };

  const tokenOf = (
    person: { userId: string; membershipId: string; roleId: string },
    tenantId: string,
  ) =>
    createInstituteToken({
      sub: person.userId,
      membershipId: person.membershipId,
      roleId: person.roleId,
      tenantId,
    });
  let principalToken: string;
  let adminAToken: string;
  let adminBToken: string;

  async function log(
    token: string,
    variables: { filter?: Record<string, unknown>; first?: number; after?: string } = {},
  ) {
    const response = await gqlRequest<LogData>(app.httpServer, { query: LOG, variables, token });
    expect(response.errors).toBeUndefined();
    assert(response.data);
    return response.data.notificationDeliveryLog;
  }

  /** Which fixture entry a node is: type and recipient are unique per entry here. */
  function label(node: EntryNode): string {
    const who =
      node.recipientUserId === guardianA.userId
        ? 'gA'
        : node.recipientUserId === guardianA2.userId
          ? 'gA2'
          : node.recipientUserId === principal.userId
            ? 'principal'
            : node.recipientUserId === guardianB.userId
              ? 'gB'
              : 'unknown';
    return `${node.type}/${who}`;
  }
  const labels = (page: { edges: { node: EntryNode }[] }) => page.edges.map((e) => label(e.node));

  const E = {
    second: 'ATTENDANCE_ABSENT/gA2',
    row: 'EMAIL_VERIFICATION/gA2',
    pm: 'USER_WELCOME/gA2',
    skipped: 'FEE_REMINDER/gA',
    waiting: 'APPROVAL_REQUESTED/principal',
    deferSent: 'LEAVE_DECIDED/gA',
    retry: 'AUTH_NEW_DEVICE/gA',
    failed: 'FEE_OVERDUE/gA',
    read: 'ATTENDANCE_ABSENT/gA',
  };
  /** Newest first by each entry's latest row. */
  const ALL_A = [
    E.second,
    E.row,
    E.pm,
    E.skipped,
    E.waiting,
    E.deferSent,
    E.retry,
    E.failed,
    E.read,
  ];

  async function person(
    tenantId: string,
    abilities?: (typeof DEFAULT_ROLE_ABILITIES)['principal'],
  ) {
    const record = await createTestTeacher(app.db, tenantId);
    people.push(record);
    if (abilities) {
      await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
        await tx.update(roles).set({ abilities }).where(eq(roles.id, record.roleId));
        await tx
          .update(memberships)
          .set({ abilities: [] })
          .where(eq(memberships.id, record.membershipId));
      });
    }
    return record;
  }

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    superPool = new pg.Pool({ connectionString: SUPERUSER_URL });
    instA = await createTestInstitute(app.db);
    instB = await createTestInstitute(app.db);
    studentA = await person(instA.tenantId);
    guardianA = await person(instA.tenantId);
    guardianA2 = await person(instA.tenantId);
    studentB = await person(instB.tenantId);
    guardianB = await person(instB.tenantId);
    principal = await person(instA.tenantId, DEFAULT_ROLE_ABILITIES.principal);
    teacher = await person(instA.tenantId);
    principalToken = tokenOf(principal, instA.tenantId);
    adminAToken = tokenOf(instA, instA.tenantId);
    adminBToken = tokenOf(instB, instB.tenantId);

    await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
      // Students and guardians as the institute's register holds them.
      async function student(
        tenantId: string,
        who: TestTeacher,
        first: string,
        last: string | null,
      ) {
        await tx.insert(tenantUserProfiles).values({
          ...by,
          tenantId,
          userId: who.userId,
          firstName: { en: first },
          lastName: last === null ? null : { en: last },
        });
        const [row] = await tx
          .insert(studentProfiles)
          .values({
            ...by,
            tenantId,
            userId: who.userId,
            membershipId: who.membershipId,
            admissionNumber: `ND-${run}-${first}`,
            admissionDate: '2026-04-01',
          })
          .returning({ id: studentProfiles.id });
        assert(row);
        return row.id;
      }
      async function guardian(
        tenantId: string,
        who: TestTeacher,
        first: string,
        studentProfileId: string,
        relationship: GuardianRelationship,
      ) {
        await tx
          .insert(tenantUserProfiles)
          .values({ ...by, tenantId, userId: who.userId, firstName: { en: first } });
        const [row] = await tx
          .insert(guardianProfiles)
          .values({ ...by, tenantId, userId: who.userId, membershipId: who.membershipId })
          .returning({ id: guardianProfiles.id });
        assert(row);
        await tx
          .insert(studentGuardianLinks)
          .values({ ...by, tenantId, guardianProfileId: row.id, studentProfileId, relationship });
      }
      const studentAProfile = await student(instA.tenantId, studentA, 'Aarav', 'Sharma');
      await guardian(
        instA.tenantId,
        guardianA,
        'Meera',
        studentAProfile,
        GuardianRelationship.MOTHER,
      );
      await guardian(
        instA.tenantId,
        guardianA2,
        'Rohan',
        studentAProfile,
        GuardianRelationship.FATHER,
      );
      const studentBProfile = await student(instB.tenantId, studentB, 'Kabir', null);
      await guardian(
        instB.tenantId,
        guardianB,
        'Anita',
        studentBProfile,
        GuardianRelationship.MOTHER,
      );

      async function notification(
        tenantId: string,
        recipientUserId: string,
        type: NotificationTypeKey,
        data: Record<string, string>,
      ) {
        const [row] = await tx
          .insert(notifications)
          .values({
            ...by,
            scope: 'institute',
            tenantId,
            recipientUserId,
            type,
            title: { en: 'Title' },
            body: { en: 'Body' },
            data,
          })
          .returning({ id: notifications.id });
        assert(row);
        return row.id;
      }
      const aboutA = { studentId: studentA.membershipId };
      const n1 = await notification(instA.tenantId, guardianA.userId, 'ATTENDANCE_ABSENT', {
        ...aboutA,
        sessionId: sessionA,
      });
      const n2 = await notification(instA.tenantId, guardianA.userId, 'FEE_OVERDUE', aboutA);
      const n3 = await notification(instA.tenantId, guardianA.userId, 'LEAVE_DECIDED', {});
      const n4 = await notification(instA.tenantId, principal.userId, 'APPROVAL_REQUESTED', {});
      const n5 = await notification(instA.tenantId, guardianA.userId, 'FEE_REMINDER', aboutA);
      const n6 = await notification(instA.tenantId, guardianA2.userId, 'ATTENDANCE_ABSENT', {
        ...aboutA,
        sessionId: sessionA,
      });
      const nB = await notification(instB.tenantId, guardianB.userId, 'ATTENDANCE_ABSENT', {
        studentId: studentB.membershipId,
        sessionId: sessionB,
      });

      interface Row {
        at: number;
        type: NotificationTypeKey;
        recipient: string;
        channel: NotificationChannel;
        status: NotificationDeliveryStatus;
        notificationId?: string;
        flowId?: string;
        pm?: string;
        skipReason?: string;
        errorCode?: string;
        attempt?: number;
        scope?: 'institute' | 'platform' | 'reseller';
        tenantId?: string;
      }
      // Inserted in this order, so row ids rise with the list.
      const rows: Row[] = [
        {
          at: 0,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianA.userId,
          notificationId: n1,
          channel: 'PUSH',
          status: 'SENT',
          pm: secret.pm[0],
        },
        {
          at: 0,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianA.userId,
          notificationId: n1,
          channel: 'WHATSAPP',
          status: 'SENT',
          pm: secret.pm[1],
          flowId: secret.flow[0],
        },
        {
          at: 10,
          type: 'FEE_OVERDUE',
          recipient: guardianA.userId,
          notificationId: n2,
          channel: 'SMS',
          status: 'SENT',
          pm: secret.pm[2],
        },
        {
          at: 11,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianA.userId,
          notificationId: n1,
          channel: 'WHATSAPP',
          status: 'DELIVERED',
          pm: secret.pm[1],
          flowId: secret.flow[0],
        },
        {
          at: 12,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianA.userId,
          notificationId: n1,
          channel: 'WHATSAPP',
          status: 'READ',
          pm: secret.pm[1],
          flowId: secret.flow[0],
        },
        {
          at: 13,
          type: 'FEE_OVERDUE',
          recipient: guardianA.userId,
          notificationId: n2,
          channel: 'SMS',
          status: 'FAILED',
          pm: secret.pm[2],
          errorCode: 'SMS_UNDELIVERED',
        },
        // A flow with no in-app copy: a failed attempt, then a sent one.
        {
          at: 20,
          type: 'AUTH_NEW_DEVICE',
          recipient: guardianA.userId,
          flowId: secret.flow[1],
          channel: 'EMAIL',
          status: 'FAILED',
          errorCode: 'EAUTH',
        },
        {
          at: 21,
          type: 'AUTH_NEW_DEVICE',
          recipient: guardianA.userId,
          flowId: secret.flow[1],
          channel: 'EMAIL',
          status: 'SENT',
          attempt: 2,
          pm: secret.pm[3],
        },
        {
          at: 30,
          type: 'LEAVE_DECIDED',
          recipient: guardianA.userId,
          notificationId: n3,
          flowId: secret.flow[2],
          channel: 'WHATSAPP',
          status: 'DEFERRED',
          skipReason: 'quiet_hours',
        },
        {
          at: 31,
          type: 'LEAVE_DECIDED',
          recipient: guardianA.userId,
          notificationId: n3,
          flowId: secret.flow[2],
          channel: 'WHATSAPP',
          status: 'SENT',
          pm: secret.pm[4],
        },
        {
          at: 40,
          type: 'APPROVAL_REQUESTED',
          recipient: principal.userId,
          notificationId: n4,
          channel: 'WHATSAPP',
          status: 'DEFERRED',
          skipReason: 'sender_cap',
        },
        {
          at: 50,
          type: 'FEE_REMINDER',
          recipient: guardianA.userId,
          notificationId: n5,
          channel: 'SMS',
          status: 'SKIPPED',
          skipReason: 'no_consent',
        },
        // No in-app copy and no flow: keyed by the provider's message id, then by the row.
        {
          at: 60,
          type: 'USER_WELCOME',
          recipient: guardianA2.userId,
          channel: 'EMAIL',
          status: 'SENT',
          pm: secret.pm[5],
        },
        {
          at: 70,
          type: 'EMAIL_VERIFICATION',
          recipient: guardianA2.userId,
          channel: 'EMAIL',
          status: 'SKIPPED',
          skipReason: 'no_address',
        },
        {
          at: 80,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianA2.userId,
          notificationId: n6,
          channel: 'SMS',
          status: 'SENT',
        },
        {
          at: 81,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianA2.userId,
          notificationId: n6,
          channel: 'SMS',
          status: 'DELIVERED',
        },
        // Other scopes about the same person, and another institute.
        {
          at: 90,
          type: 'AUTH_LOGIN',
          recipient: guardianA.userId,
          channel: 'EMAIL',
          status: 'SENT',
          scope: 'platform',
        },
        {
          at: 91,
          type: 'AUTH_LOGIN',
          recipient: guardianA.userId,
          channel: 'EMAIL',
          status: 'SENT',
          scope: 'reseller',
        },
        {
          at: 95,
          type: 'ATTENDANCE_ABSENT',
          recipient: guardianB.userId,
          notificationId: nB,
          channel: 'WHATSAPP',
          status: 'SENT',
          tenantId: instB.tenantId,
        },
      ];
      for (const row of rows) {
        const scope = row.scope ?? 'institute';
        await tx.insert(notificationDeliveries).values({
          scope,
          tenantId: scope === 'institute' ? (row.tenantId ?? instA.tenantId) : null,
          resellerId: scope === 'reseller' ? SEED_IDS.RESELLER_DIRECT : null,
          notificationId: row.notificationId ?? null,
          recipientUserId: row.recipient,
          type: row.type,
          channel: row.channel,
          provider: row.status === 'SKIPPED' || row.status === 'DEFERRED' ? null : 'log',
          status: row.status,
          skipReason: row.skipReason ?? null,
          errorCode: row.errorCode ?? null,
          providerMessageId: row.pm ?? null,
          flowId: row.flowId ?? null,
          attempt: row.attempt ?? 1,
          createdAt: minute(row.at),
        });
      }
    });
  }, 60_000);

  afterAll(async () => {
    try {
      const userIds = people.map((p) => p.userId);
      const tenantIds = [instA?.tenantId, instB?.tenantId].filter((id) => id !== undefined);
      if (superPool) {
        // Append-only for every application role: removed as the owner.
        await superPool.query(
          'DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)',
          [userIds],
        );
        await superPool.query('DELETE FROM notifications WHERE recipient_user_id = ANY($1)', [
          userIds,
        ]);
        for (const table of [
          'student_guardian_links',
          'guardian_profiles',
          'student_profiles',
          'tenant_user_profiles',
        ]) {
          await superPool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [tenantIds]);
        }
      }
      if (app) {
        for (const p of people) await cleanupTestTeacher(app.db, p);
        if (instA) await cleanupTestInstitute(app.db, instA);
        if (instB) await cleanupTestInstitute(app.db, instB);
      }
    } finally {
      await superPool?.end();
      await app?.close();
    }
  });

  describe('entries and their state per channel', () => {
    it('should list one entry per message and recipient, newest activity first', async () => {
      const page = await log(principalToken);

      expect(labels(page)).toEqual(ALL_A);
      expect(page.totalCount).toBe(ALL_A.length);
      expect(page.pageInfo.hasNextPage).toBe(false);
    });

    it('should derive each channel state from the sequence of its rows', async () => {
      const page = await log(principalToken);
      const byLabel = new Map(page.edges.map((e) => [label(e.node), e.node]));
      const channelsOf = (key: string) => byLabel.get(key)?.channels;

      // sent → delivered → read; another channel only sent
      expect(channelsOf(E.read)).toEqual([
        { channel: 'PUSH', state: 'SENT', reason: null, at: iso(0) },
        { channel: 'WHATSAPP', state: 'READ', reason: null, at: iso(12) },
      ]);
      // sent → failed report
      expect(channelsOf(E.failed)).toEqual([
        { channel: 'SMS', state: 'FAILED', reason: 'SMS_UNDELIVERED', at: iso(13) },
      ]);
      // failed attempt → sent
      expect(channelsOf(E.retry)).toEqual([
        { channel: 'EMAIL', state: 'SENT', reason: null, at: iso(21) },
      ]);
      // deferred → sent
      expect(channelsOf(E.deferSent)).toEqual([
        { channel: 'WHATSAPP', state: 'SENT', reason: null, at: iso(31) },
      ]);
      // deferred alone
      expect(channelsOf(E.waiting)).toEqual([
        { channel: 'WHATSAPP', state: 'WAITING', reason: 'sender_cap', at: iso(40) },
      ]);
      expect(channelsOf(E.skipped)).toEqual([
        { channel: 'SMS', state: 'SKIPPED', reason: 'no_consent', at: iso(50) },
      ]);
      expect(channelsOf(E.pm)).toEqual([
        { channel: 'EMAIL', state: 'SENT', reason: null, at: iso(60) },
      ]);
      expect(channelsOf(E.row)).toEqual([
        { channel: 'EMAIL', state: 'SKIPPED', reason: 'no_address', at: iso(70) },
      ]);
      expect(channelsOf(E.second)).toEqual([
        { channel: 'SMS', state: 'DELIVERED', reason: null, at: iso(81) },
      ]);
    });

    it('should carry the module, criticality, student, recipient names and relationship', async () => {
      const page = await log(adminAToken, { filter: { recipientUserId: guardianA.userId } });
      const read = page.edges.find((e) => label(e.node) === E.read)?.node;
      const retry = page.edges.find((e) => label(e.node) === E.retry)?.node;
      assert(read && retry);

      const { id, channels: _channels, ...rest } = read;
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(rest).toEqual({
        type: 'ATTENDANCE_ABSENT',
        module: 'ATTENDANCE',
        critical: false,
        at: iso(0),
        studentMembershipId: studentA.membershipId,
        studentFirstName: { en: 'Aarav' },
        studentLastName: { en: 'Sharma' },
        recipientUserId: guardianA.userId,
        recipientFirstName: { en: 'Meera' },
        recipientLastName: null,
        relationship: 'MOTHER',
      });
      const { id: _retryId, channels: _retryChannels, ...retryRest } = retry;
      expect(retryRest).toEqual({
        type: 'AUTH_NEW_DEVICE',
        module: 'ACCOUNT_SECURITY',
        critical: true,
        at: iso(20),
        studentMembershipId: null,
        studentFirstName: null,
        studentLastName: null,
        recipientUserId: guardianA.userId,
        recipientFirstName: { en: 'Meera' },
        recipientLastName: null,
        relationship: null,
      });
    });

    it("should give the second guardian of the same student that guardian's relationship", async () => {
      const page = await log(principalToken, { filter: { recipientUserId: guardianA2.userId } });
      const second = page.edges.find((e) => label(e.node) === E.second)?.node;

      expect(second?.relationship).toBe('FATHER');
      expect(second?.recipientFirstName).toEqual({ en: 'Rohan' });
    });

    it('should leave names empty for a recipient the institute holds no profile of', async () => {
      const page = await log(principalToken, { filter: { recipientUserId: principal.userId } });

      expect(page.edges.map((e) => [e.node.recipientFirstName, e.node.relationship])).toEqual([
        [null, null],
      ]);
    });

    it('should keep the id of an entry stable between requests', async () => {
      const first = await log(principalToken);
      const again = await log(adminAToken);

      expect(again.edges.map((e) => e.node.id)).toEqual(first.edges.map((e) => e.node.id));
      expect(new Set(first.edges.map((e) => e.node.id)).size).toBe(ALL_A.length);
    });
  });

  describe('what a response never carries', () => {
    it('should return no provider message id, flow id, address or provider', async () => {
      const page = await log(adminAToken);
      const json = JSON.stringify(page);

      for (const value of [...secret.pm, ...secret.flow]) expect(json).not.toContain(value);
      for (const p of people) expect(json).not.toContain(p.username);
      expect(json).not.toContain('@test.local');
      expect(json).not.toContain('"log"');
      expect(Object.keys(page.edges[0]?.node ?? {}).sort()).toEqual([
        'at',
        'channels',
        'critical',
        'id',
        'module',
        'recipientFirstName',
        'recipientLastName',
        'recipientUserId',
        'relationship',
        'studentFirstName',
        'studentLastName',
        'studentMembershipId',
        'type',
      ]);
    });
  });

  describe('filters', () => {
    it.each([
      ['module', { module: 'FEE' }, [E.skipped, E.failed]],
      ['type', { type: 'ATTENDANCE_ABSENT' }, [E.second, E.read]],
      ['channel', { channel: 'EMAIL' }, [E.row, E.pm, E.retry]],
      ['state', { state: 'WAITING' }, [E.waiting]],
      ['state on any channel', { state: 'SENT' }, [E.pm, E.deferSent, E.retry, E.read]],
      ['state on one channel', { channel: 'WHATSAPP', state: 'SENT' }, [E.deferSent]],
      ['critical types', { criticalOnly: true }, [E.row, E.pm, E.retry]],
      [
        'not delivered',
        { notDeliveredOnly: true },
        [E.row, E.pm, E.skipped, E.waiting, E.deferSent, E.retry, E.failed],
      ],
      [
        'first attempt in a range',
        { from: iso(30), to: iso(60) },
        [E.pm, E.skipped, E.waiting, E.deferSent],
      ],
      ['module and critical together', { module: 'FEE', criticalOnly: true }, []],
    ])('should filter by %s', async (_name, filter, expected) => {
      const page = await log(principalToken, { filter });

      expect(labels(page)).toEqual(expected);
      expect(page.totalCount).toBe(expected.length);
    });

    it('should filter by student, session and recipient', async () => {
      expect(
        labels(await log(principalToken, { filter: { studentId: studentA.membershipId } })),
      ).toEqual([E.second, E.skipped, E.failed, E.read]);
      expect(labels(await log(principalToken, { filter: { sessionId: sessionA } }))).toEqual([
        E.second,
        E.read,
      ]);
      expect(
        labels(await log(principalToken, { filter: { recipientUserId: guardianA2.userId } })),
      ).toEqual([E.second, E.row, E.pm]);
    });

    it('should refuse a type that does not exist', async () => {
      const response = await gqlRequest<LogData>(app.httpServer, {
        query: LOG,
        variables: { filter: { type: 'NOT_A_TYPE' } },
        token: principalToken,
      });

      expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('pagination', () => {
    it('should page through every entry with a stable total', async () => {
      const one = await log(principalToken, { first: 4 });
      assert(one.pageInfo.endCursor);
      const two = await log(principalToken, { first: 4, after: one.pageInfo.endCursor });
      assert(two.pageInfo.endCursor);
      const three = await log(principalToken, { first: 4, after: two.pageInfo.endCursor });

      expect(
        [one, two, three].map((p) => [p.edges.length, p.pageInfo.hasNextPage, p.totalCount]),
      ).toEqual([
        [4, true, ALL_A.length],
        [4, true, ALL_A.length],
        [1, false, ALL_A.length],
      ]);
      expect([...labels(one), ...labels(two), ...labels(three)]).toEqual(ALL_A);
    });

    it('should cap a page at 100 entries and refuse a cursor it did not issue', async () => {
      expect((await log(principalToken, { first: 1000 })).edges).toHaveLength(ALL_A.length);

      const response = await gqlRequest<LogData>(app.httpServer, {
        query: LOG,
        variables: { after: Buffer.from('{"id":"nope"}').toString('base64url') },
        token: principalToken,
      });
      expect(response.errors?.[0]?.extensions?.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('isolation', () => {
    it('should show another institute only its own entries', async () => {
      const page = await log(adminBToken);

      expect(labels(page)).toEqual(['ATTENDANCE_ABSENT/gB']);
      expect(page.edges[0]?.node.studentFirstName).toEqual({ en: 'Kabir' });
    });

    it.each([
      ['student', () => ({ studentId: studentB.membershipId })],
      ['session', () => ({ sessionId: sessionB })],
      ['recipient', () => ({ recipientUserId: guardianB.userId })],
    ])("should match nothing for another institute's %s", async (_name, filter) => {
      const page = await log(principalToken, { filter: filter() });

      expect(page).toEqual({
        totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [],
      });
    });

    it("should match nothing when institute B passes institute A's ids", async () => {
      for (const filter of [
        { studentId: studentA.membershipId },
        { sessionId: sessionA },
        { recipientUserId: guardianA.userId },
      ]) {
        expect((await log(adminBToken, { filter })).totalCount).toBe(0);
      }
    });

    it('should never show platform or reseller rows, even about a member of the institute', async () => {
      const page = await log(principalToken, { filter: { type: 'AUTH_LOGIN' } });

      expect(page.totalCount).toBe(0);
    });
  });

  describe('who may read it', () => {
    it('should refuse a role without read NotificationDelivery', async () => {
      const response = await gqlRequest<LogData>(app.httpServer, {
        query: LOG,
        token: tokenOf(teacher, instA.tenantId),
      });

      expect(response.errors?.map((e) => e.extensions?.code)).toEqual(['FORBIDDEN']);
      expect(response.data).toBeNull();
    });

    it('should refuse a platform token', async () => {
      const response = await gqlRequest<LogData>(app.httpServer, {
        query: LOG,
        token: createPlatformToken({
          sub: SEED_IDS.USER_ADMIN,
          membershipId: randomUUID(),
          roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
        }),
      });

      expect(response.errors?.map((e) => e.extensions?.code)).toEqual(['FORBIDDEN']);
    });
  });
});
