/**
 * Notification inbox and device tokens through the real resolver → service → repository →
 * RLS pipeline (ROV-314). The database isolates by institute or reseller only; these tests
 * prove the repository adds the person and membership, and that every way of naming a row
 * that is not the caller's answers exactly like a missing id.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import type { InstituteContext } from '@roviq/common-types';
import {
  deviceTokens,
  impersonationSessions,
  mkAdminCtx,
  notificationDeliveries,
  notifications,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { pubSub } from '@roviq/pubsub';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  cleanupTestTeacher,
  createImpersonationToken,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  type GqlResponse,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';
import { notificationFeedTopic } from '../notification-feed';
import { NotificationInboxResolver } from '../notification-inbox.resolver';
import { NotificationInboxService } from '../notification-inbox.service';
import { MAX_DEVICE_TOKENS_PER_USER } from '../repositories/device-token.drizzle-repository';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const FIELDS = 'id type title body data readAt archivedAt createdAt';

const LIST = `query($first: Int, $after: String, $unreadOnly: Boolean) {
  myNotifications(first: $first, after: $after, unreadOnly: $unreadOnly) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges { cursor node { ${FIELDS} } }
  }
}`;
const COUNT = 'query { myUnreadNotificationCount }';
const MARK = `mutation($id: ID!) { markNotificationRead(id: $id) { ${FIELDS} } }`;
const MARK_ALL = 'mutation { markAllNotificationsRead }';
const ARCHIVE = `mutation($id: ID!) { archiveNotification(id: $id) { ${FIELDS} } }`;
const ACK = 'mutation($id: ID!) { acknowledgeNotificationDelivery(notificationId: $id) }';
const REGISTER = `mutation($token: String!, $platform: DevicePlatform!) {
  registerDeviceToken(token: $token, platform: $platform)
}`;
const UNREGISTER = 'mutation($token: String!) { unregisterDeviceToken(token: $token) }';
const DELIVERIES = `query($filter: NotificationDeliveryFilterInput, $first: Int) {
  adminNotificationDeliveries(filter: $filter, first: $first) {
    totalCount
    edges { node { id scope tenantId recipientUserId type channel provider status attempt } }
  }
}`;

interface NotificationNode {
  id: string;
  type: string;
  title: Record<string, string>;
  body: Record<string, string>;
  data: Record<string, unknown> | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

interface ListData {
  myNotifications: {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { cursor: string; node: NotificationNode }[];
  };
}

type Row = typeof notifications.$inferSelect;

interface RowTarget {
  recipientUserId: string;
  scope?: 'institute' | 'reseller' | 'platform';
  tenantId?: string | null;
  resellerId?: string | null;
  recipientMembershipId?: string | null;
  readAt?: Date | null;
  archivedAt?: Date | null;
  flowId?: string;
}

describe('Notification inbox (integration)', () => {
  let result: IntegrationAppResult;
  let instituteA: TestInstitute;
  let instituteB: TestInstitute;
  let memberY: TestTeacher;
  let reseller: TestReseller;
  const teachers: TestTeacher[] = [];
  const rowIds: string[] = [];
  const sessionIds: string[] = [];

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:notification-inbox'), fn);

  const gql = <T>(query: string, token?: string, variables?: Record<string, unknown>) =>
    gqlRequest<T>(result.httpServer, { query, token, variables });

  const code = (response: GqlResponse) => response.errors?.[0]?.extensions?.code;

  async function insertRow(target: RowTarget): Promise<Row> {
    const scope = target.scope ?? 'institute';
    const [row] = await admin((tx) =>
      tx
        .insert(notifications)
        .values({
          scope,
          tenantId: scope === 'institute' ? (target.tenantId ?? instituteA.tenantId) : null,
          resellerId: scope === 'reseller' ? (target.resellerId ?? reseller.resellerId) : null,
          recipientUserId: target.recipientUserId,
          recipientMembershipId: target.recipientMembershipId ?? null,
          type: 'LEAVE_DECIDED',
          title: { en: 'Leave approved', hi: 'छुट्टी स्वीकृत' },
          body: { en: 'Your leave was approved.' },
          data: { leaveId: randomUUID() },
          readAt: target.readAt ?? null,
          flowId: target.flowId ?? null,
          archivedAt: target.archivedAt ?? null,
          createdBy: SYSTEM,
          updatedBy: SYSTEM,
        })
        .returning(),
    );
    assert(row);
    rowIds.push(row.id);
    return row;
  }

  async function stored(id: string): Promise<Row> {
    const [row] = await admin((tx) =>
      tx.select().from(notifications).where(eq(notifications.id, id)),
    );
    assert(row);
    return row;
  }

  const nodeOf = (row: Row): NotificationNode => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });

  const instituteToken = (
    member: { userId: string; membershipId: string; roleId: string },
    tenantId: string,
  ) =>
    createInstituteToken({
      sub: member.userId,
      tenantId,
      membershipId: member.membershipId,
      roleId: member.roleId,
    });

  const instituteUser = (
    member: { userId: string; membershipId: string; roleId: string },
    tenantId: string,
  ): InstituteContext => ({
    _scope: 'institute',
    scope: 'institute',
    type: 'access',
    userId: member.userId,
    membershipId: member.membershipId,
    roleId: member.roleId,
    tenantId,
  });

  const platformToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  let tokenX: string;
  let tokenY: string;
  let tokenReseller: string;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instituteA = await createTestInstitute(result.db);
    instituteB = await createTestInstitute(result.db);
    memberY = await createTestTeacher(result.db, instituteA.tenantId);
    teachers.push(memberY);
    reseller = await createTestReseller(result.db);
    tokenX = instituteToken(instituteA, instituteA.tenantId);
    tokenY = instituteToken(memberY, instituteA.tenantId);
    tokenReseller = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
  });

  afterAll(async () => {
    if (result) {
      const userIds = [
        instituteA?.userId,
        instituteB?.userId,
        reseller?.userId,
        ...teachers.map((t) => t.userId),
      ].filter((id): id is string => typeof id === 'string');
      await admin(async (tx) => {
        if (rowIds.length > 0)
          await tx.delete(notifications).where(inArray(notifications.id, rowIds));
        if (userIds.length > 0)
          await tx.delete(deviceTokens).where(inArray(deviceTokens.userId, userIds));
        if (sessionIds.length > 0) {
          await tx
            .delete(impersonationSessions)
            .where(inArray(impersonationSessions.id, sessionIds));
        }
      });
      for (const teacher of teachers) await cleanupTestTeacher(result.db, teacher);
      if (instituteA) await cleanupTestInstitute(result.db, instituteA);
      if (instituteB) await cleanupTestInstitute(result.db, instituteB);
      if (reseller) await cleanupTestReseller(result.db, reseller);
    }
    await result?.close();
  });

  describe('institute member', () => {
    let ownShared: Row;
    let ownMembership: Row;
    let otherInstitute: Row;
    let otherInstituteMember: Row;
    let otherMembership: Row;
    let otherMember: Row;
    let ownPlatform: Row;

    beforeAll(async () => {
      ownShared = await insertRow({ recipientUserId: instituteA.userId });
      ownMembership = await insertRow({
        recipientUserId: instituteA.userId,
        recipientMembershipId: instituteA.membershipId,
      });
      await insertRow({ recipientUserId: instituteA.userId, archivedAt: new Date() });
      otherInstitute = await insertRow({
        recipientUserId: instituteA.userId,
        tenantId: instituteB.tenantId,
      });
      otherInstituteMember = await insertRow({
        recipientUserId: instituteB.userId,
        recipientMembershipId: instituteB.membershipId,
        tenantId: instituteB.tenantId,
      });
      otherMembership = await insertRow({
        recipientUserId: instituteA.userId,
        recipientMembershipId: randomUUID(),
      });
      otherMember = await insertRow({ recipientUserId: memberY.userId });
      ownPlatform = await insertRow({ recipientUserId: instituteA.userId, scope: 'platform' });
    });

    it('lists only their own rows of this institute and membership, newest first', async () => {
      const response = await gql<ListData>(LIST, tokenX);

      expect(response.errors).toBeUndefined();
      expect(response.data?.myNotifications.totalCount).toBe(2);
      expect(response.data?.myNotifications.edges.map((e) => e.node)).toEqual([
        nodeOf(ownMembership),
        nodeOf(ownShared),
      ]);
    });

    it('pages with the cursor and reports the next page', async () => {
      const first = await gql<ListData>(LIST, tokenX, { first: 1 });
      const page = first.data?.myNotifications;
      assert(page);
      expect(page.pageInfo.hasNextPage).toBe(true);

      const second = await gql<ListData>(LIST, tokenX, {
        first: 1,
        after: page.pageInfo.endCursor,
      });

      expect(second.data?.myNotifications.edges.map((e) => e.node.id)).toEqual([ownShared.id]);
      expect(second.data?.myNotifications.pageInfo.hasNextPage).toBe(false);
    });

    it('refuses a cursor it did not issue', async () => {
      const response = await gql<ListData>(LIST, tokenX, { after: 'not-a-cursor' });
      expect(code(response)).toBe('VALIDATION_FAILED');
    });

    it('counts only their own unread rows', async () => {
      const response = await gql<{ myUnreadNotificationCount: number }>(COUNT, tokenY);
      expect(response.data?.myUnreadNotificationCount).toBe(1);
    });

    it.each([
      ['another institute', () => otherInstitute.id],
      ['a member of another institute', () => otherInstituteMember.id],
      ['another membership of theirs', () => otherMembership.id],
      ['another member of the same institute', () => otherMember.id],
      ['another scope', () => ownPlatform.id],
      ['nobody (a missing id)', () => randomUUID()],
    ])('answers a row of %s exactly like a missing id', async (_label, pick) => {
      const id = pick();
      const service = result.module.get(NotificationInboxService, { strict: false });

      const found = await service.findOwn(instituteUser(instituteA, instituteA.tenantId), id);
      const mark = await gql(MARK, tokenX, { id });
      const archive = await gql(ARCHIVE, tokenX, { id });
      const ack = await gql(ACK, tokenX, { id });

      expect(found).toBeNull();
      expect([code(ack), ack.errors?.[0]?.message]).toEqual([
        'NOTIFICATION_NOT_FOUND',
        'Notification not found',
      ]);
      expect([code(mark), mark.errors?.[0]?.message]).toEqual([
        'NOTIFICATION_NOT_FOUND',
        'Notification not found',
      ]);
      expect([code(archive), archive.errors?.[0]?.message]).toEqual([
        'NOTIFICATION_NOT_FOUND',
        'Notification not found',
      ]);
    });

    it('leaves rows it refused untouched', async () => {
      for (const row of [
        otherInstitute,
        otherInstituteMember,
        otherMembership,
        otherMember,
        ownPlatform,
      ]) {
        expect(await stored(row.id)).toEqual(row);
      }
    });

    it('marks its own row read once, and marking again succeeds without a change', async () => {
      const first = await gql<{ markNotificationRead: NotificationNode }>(MARK, tokenY, {
        id: otherMember.id,
      });
      expect(first.errors).toBeUndefined();
      const afterFirst = await stored(otherMember.id);
      expect(afterFirst.readAt).toBeInstanceOf(Date);
      expect(afterFirst.updatedBy).toBe(memberY.userId);
      expect(afterFirst.version).toBe(otherMember.version + 1);
      expect(first.data?.markNotificationRead).toEqual(nodeOf(afterFirst));

      const again = await gql<{ markNotificationRead: NotificationNode }>(MARK, tokenY, {
        id: otherMember.id,
      });

      expect(again.data?.markNotificationRead).toEqual(nodeOf(afterFirst));
      expect(await stored(otherMember.id)).toEqual(afterFirst);
    });

    it('archives its own row and drops it from the list', async () => {
      const response = await gql<{ archiveNotification: NotificationNode }>(ARCHIVE, tokenX, {
        id: ownShared.id,
      });
      expect(response.errors).toBeUndefined();
      const archived = await stored(ownShared.id);
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(response.data?.archiveNotification).toEqual(nodeOf(archived));

      const list = await gql<ListData>(LIST, tokenX);
      expect(list.data?.myNotifications.edges.map((e) => e.node.id)).toEqual([ownMembership.id]);
    });
  });

  describe('markAllNotificationsRead', () => {
    it('marks only the caller’s unread rows and returns the exact count', async () => {
      const caller = await createTestTeacher(result.db, instituteA.tenantId);
      const other = await createTestTeacher(result.db, instituteA.tenantId);
      teachers.push(caller, other);
      const unread1 = await insertRow({ recipientUserId: caller.userId });
      const unread2 = await insertRow({
        recipientUserId: caller.userId,
        recipientMembershipId: caller.membershipId,
      });
      const alreadyRead = await insertRow({ recipientUserId: caller.userId, readAt: new Date() });
      const archived = await insertRow({ recipientUserId: caller.userId, archivedAt: new Date() });
      const othersRow = await insertRow({ recipientUserId: other.userId });
      const otherInstitute = await insertRow({
        recipientUserId: caller.userId,
        tenantId: instituteB.tenantId,
      });
      const otherMembership = await insertRow({
        recipientUserId: caller.userId,
        recipientMembershipId: randomUUID(),
      });

      const response = await gql<{ markAllNotificationsRead: number }>(
        MARK_ALL,
        instituteToken(caller, instituteA.tenantId),
      );

      expect(response.data?.markAllNotificationsRead).toBe(2);
      expect((await stored(unread1.id)).readAt).toBeInstanceOf(Date);
      expect((await stored(unread2.id)).readAt).toBeInstanceOf(Date);
      for (const row of [alreadyRead, archived, othersRow, otherInstitute, otherMembership]) {
        expect(await stored(row.id)).toEqual(row);
      }
      const count = await gql<{ myUnreadNotificationCount: number }>(
        COUNT,
        instituteToken(caller, instituteA.tenantId),
      );
      expect(count.data?.myUnreadNotificationCount).toBe(0);
    });
  });

  describe('reseller', () => {
    it('sees and changes only its own reseller rows', async () => {
      const own = await insertRow({ recipientUserId: reseller.userId, scope: 'reseller' });
      const otherReseller = await insertRow({
        recipientUserId: reseller.userId,
        scope: 'reseller',
        resellerId: SEED_IDS.RESELLER_DIRECT,
      });
      const instituteRow = await insertRow({ recipientUserId: reseller.userId });

      const list = await gql<ListData>(LIST, tokenReseller);
      expect(list.data?.myNotifications.edges.map((e) => e.node)).toEqual([nodeOf(own)]);

      for (const row of [otherReseller, instituteRow]) {
        expect(code(await gql(MARK, tokenReseller, { id: row.id }))).toBe('NOTIFICATION_NOT_FOUND');
        expect(code(await gql(ARCHIVE, tokenReseller, { id: row.id }))).toBe(
          'NOTIFICATION_NOT_FOUND',
        );
        expect(await stored(row.id)).toEqual(row);
      }

      const mark = await gql(MARK, tokenReseller, { id: own.id });
      expect(mark.errors).toBeUndefined();
      expect((await stored(own.id)).readAt).toBeInstanceOf(Date);
    });
  });

  describe('platform', () => {
    it('sees only its own platform rows although the admin role reads every row', async () => {
      const own = await insertRow({ recipientUserId: SEED_IDS.USER_ADMIN, scope: 'platform' });
      const otherUser = await insertRow({ recipientUserId: instituteA.userId, scope: 'platform' });
      const instituteRow = await insertRow({ recipientUserId: SEED_IDS.USER_ADMIN });
      const resellerRow = await insertRow({
        recipientUserId: SEED_IDS.USER_ADMIN,
        scope: 'reseller',
      });

      const list = await gql<ListData>(LIST, platformToken, { first: 50 });
      const ids = list.data?.myNotifications.edges.map((e) => e.node.id) ?? [];
      expect(ids).toContain(own.id);
      expect(
        ids.filter((id) => [otherUser.id, instituteRow.id, resellerRow.id].includes(id)),
      ).toEqual([]);

      for (const row of [otherUser, instituteRow, resellerRow]) {
        expect(code(await gql(MARK, platformToken, { id: row.id }))).toBe('NOTIFICATION_NOT_FOUND');
        expect(code(await gql(ARCHIVE, platformToken, { id: row.id }))).toBe(
          'NOTIFICATION_NOT_FOUND',
        );
        expect(await stored(row.id)).toEqual(row);
      }
      const mark = await gql(MARK, platformToken, { id: own.id });
      expect(mark.errors).toBeUndefined();
      expect((await stored(own.id)).readAt).toBeInstanceOf(Date);
    });
  });

  describe('impersonated session', () => {
    let impersonationToken: string;
    let row: Row;
    const token = `impersonation-${randomUUID()}`;

    beforeAll(async () => {
      row = await insertRow({ recipientUserId: instituteA.userId });
      const [session] = await admin((tx) =>
        tx
          .insert(impersonationSessions)
          .values({
            impersonatorId: SEED_IDS.USER_ADMIN,
            impersonatorScope: 'platform',
            targetUserId: instituteA.userId,
            targetTenantId: instituteA.tenantId,
            reason: 'integration test — notification inbox',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          })
          .returning({ id: impersonationSessions.id }),
      );
      assert(session);
      sessionIds.push(session.id);
      impersonationToken = createImpersonationToken({
        sub: instituteA.userId,
        tenantId: instituteA.tenantId,
        membershipId: instituteA.membershipId,
        roleId: instituteA.roleId,
        impersonatorId: SEED_IDS.USER_ADMIN,
        impersonationSessionId: session.id,
      });
    });

    it('may list and count the target’s notifications', async () => {
      const own = await gql<ListData>(LIST, tokenX);
      const asSupport = await gql<ListData>(LIST, impersonationToken);
      const count = await gql<{ myUnreadNotificationCount: number }>(COUNT, impersonationToken);
      const ownCount = await gql<{ myUnreadNotificationCount: number }>(COUNT, tokenX);

      expect(asSupport.errors).toBeUndefined();
      expect(asSupport.data).toEqual(own.data);
      expect(count.data?.myUnreadNotificationCount).toBe(ownCount.data?.myUnreadNotificationCount);
    });

    it.each([
      ['markNotificationRead', MARK, () => ({ id: row.id })],
      ['markAllNotificationsRead', MARK_ALL, () => ({})],
      ['archiveNotification', ARCHIVE, () => ({ id: row.id })],
      ['registerDeviceToken', REGISTER, () => ({ token, platform: 'WEB' })],
      ['unregisterDeviceToken', UNREGISTER, () => ({ token })],
    ])('refuses %s and changes nothing', async (_name, query, variables) => {
      const response = await gql(query, impersonationToken, variables());

      expect([code(response), response.errors?.[0]?.message]).toEqual([
        'FORBIDDEN',
        'Notifications and devices cannot be changed while impersonating',
      ]);
      expect(await stored(row.id)).toEqual(row);
      const devices = await admin((tx) =>
        tx.select().from(deviceTokens).where(eq(deviceTokens.token, token)),
      );
      expect(devices).toEqual([]);
    });
  });

  describe('live feed', () => {
    it('yields the caller’s own row and drops events naming anyone else’s', async () => {
      const own = await insertRow({ recipientUserId: instituteA.userId });
      const otherUser = await insertRow({ recipientUserId: memberY.userId });
      const otherInstitute = await insertRow({
        recipientUserId: instituteA.userId,
        tenantId: instituteB.tenantId,
      });
      const otherMembership = await insertRow({
        recipientUserId: instituteA.userId,
        recipientMembershipId: randomUUID(),
      });
      const resolver = result.module.get(NotificationInboxResolver, { strict: false });
      const feed = resolver.notificationReceived(instituteUser(instituteA, instituteA.tenantId));
      const topic = notificationFeedTopic(instituteA.userId);

      const next = feed.next();
      for (const row of [otherUser, otherInstitute, otherMembership, own]) {
        await pubSub.publish(topic, { notificationId: row.id });
      }
      const received = await next;
      await feed.return?.();

      expect(received).toEqual({
        done: false,
        value: {
          id: own.id,
          type: own.type,
          title: own.title,
          body: own.body,
          data: own.data,
          readAt: own.readAt,
          archivedAt: own.archivedAt,
          createdAt: own.createdAt,
          // Internal to the service; `NotificationModel` has no such field.
          flowId: own.flowId,
        },
      });
    });

    it('yields nothing to a member whose events all name other people', async () => {
      const otherUser = await insertRow({ recipientUserId: instituteA.userId });
      const resolver = result.module.get(NotificationInboxResolver, { strict: false });
      const feed = resolver.notificationReceived(instituteUser(memberY, instituteA.tenantId));
      const topic = notificationFeedTopic(memberY.userId);

      const next = feed.next();
      await pubSub.publish(topic, { notificationId: otherUser.id });
      await pubSub.publish(topic, { notificationId: randomUUID() });
      await feed.return?.();

      expect(await next).toEqual({ done: true, value: undefined });
    });
  });

  describe('device tokens', () => {
    const live = (token: string) =>
      admin((tx) =>
        tx
          .select({ userId: deviceTokens.userId, platform: deviceTokens.platform })
          .from(deviceTokens)
          .where(and(eq(deviceTokens.token, token), isNull(deviceTokens.deletedAt))),
      );

    it('stores the caller as owner and moves a token that changes hands', async () => {
      const token = `fcm-${randomUUID()}`;

      const first = await gql(REGISTER, tokenX, { token, platform: 'WEB' });
      expect(first.errors).toBeUndefined();
      expect(await live(token)).toEqual([{ userId: instituteA.userId, platform: 'WEB' }]);

      const moved = await gql(REGISTER, tokenY, { token, platform: 'ANDROID' });
      expect(moved.errors).toBeUndefined();
      expect(await live(token)).toEqual([{ userId: memberY.userId, platform: 'ANDROID' }]);
      const all = await admin((tx) =>
        tx
          .select({ userId: deviceTokens.userId, deletedBy: deviceTokens.deletedBy })
          .from(deviceTokens)
          .where(eq(deviceTokens.token, token)),
      );
      expect(all).toContainEqual({ userId: instituteA.userId, deletedBy: memberY.userId });
    });

    it('does not let a caller unregister someone else’s token', async () => {
      const token = `fcm-${randomUUID()}`;
      await gql(REGISTER, tokenY, { token, platform: 'IOS' });

      const response = await gql<{ unregisterDeviceToken: boolean }>(UNREGISTER, tokenX, { token });

      expect(response.data?.unregisterDeviceToken).toBe(true);
      expect(await live(token)).toEqual([{ userId: memberY.userId, platform: 'IOS' }]);

      await gql(UNREGISTER, tokenY, { token });
      expect(await live(token)).toEqual([]);
    });

    it(`keeps at most ${MAX_DEVICE_TOKENS_PER_USER} live tokens, retiring the least recently seen`, async () => {
      const owner = await createTestTeacher(result.db, instituteA.tenantId);
      teachers.push(owner);
      const ownerToken = instituteToken(owner, instituteA.tenantId);
      const tokens = Array.from(
        { length: MAX_DEVICE_TOKENS_PER_USER + 1 },
        () => `fcm-${randomUUID()}`,
      );

      for (const token of tokens) {
        const response = await gql(REGISTER, ownerToken, { token, platform: 'WEB' });
        expect(response.errors).toBeUndefined();
      }

      const remaining = await admin((tx) =>
        tx
          .select({ token: deviceTokens.token })
          .from(deviceTokens)
          .where(and(eq(deviceTokens.userId, owner.userId), isNull(deviceTokens.deletedAt))),
      );
      expect(remaining.map((r) => r.token).sort()).toEqual(tokens.slice(1).sort());
    });

    it.each([
      ['an empty token', ''],
      ['a token over 4096 characters', 'x'.repeat(4097)],
    ])('refuses %s', async (_label, token) => {
      const response = await gql(REGISTER, tokenX, { token, platform: 'WEB' });
      expect(code(response)).toBe('VALIDATION_FAILED');
    });
  });

  describe('adminNotificationDeliveries', () => {
    it('shows platform staff the delivery rows, filtered', async () => {
      const [delivery] = await admin((tx) =>
        tx
          .insert(notificationDeliveries)
          .values({
            scope: 'institute',
            tenantId: instituteA.tenantId,
            recipientUserId: instituteA.userId,
            type: 'LEAVE_DECIDED',
            channel: 'EMAIL',
            provider: 'log',
            status: 'SENT',
          })
          .returning(),
      );
      assert(delivery);

      const response = await gql<{
        adminNotificationDeliveries: { totalCount: number; edges: { node: unknown }[] };
      }>(DELIVERIES, platformToken, { filter: { recipientUserId: instituteA.userId } });
      const none = await gql<{ adminNotificationDeliveries: { totalCount: number } }>(
        DELIVERIES,
        platformToken,
        { filter: { recipientUserId: instituteA.userId, channel: 'SMS' } },
      );

      expect(response.data?.adminNotificationDeliveries).toEqual({
        totalCount: 1,
        edges: [
          {
            node: {
              id: delivery.id,
              scope: 'institute',
              tenantId: instituteA.tenantId,
              recipientUserId: instituteA.userId,
              type: 'LEAVE_DECIDED',
              channel: 'EMAIL',
              provider: 'log',
              status: 'SENT',
              attempt: 1,
            },
          },
        ],
      });
      expect(none.data?.adminNotificationDeliveries.totalCount).toBe(0);
    });

    it.each([
      ['an institute', () => tokenX],
      ['a reseller', () => tokenReseller],
    ])('refuses %s token', async (_label, token) => {
      expect(code(await gql(DELIVERIES, token()))).toBe('FORBIDDEN');
    });
  });

  describe('delivery flow (ROV-332)', () => {
    const flowId = `notification-flow:test:${randomUUID()}`;
    let emit: ReturnType<typeof vi.spyOn<EventBusService, 'emit'>>;

    beforeEach(() => {
      emit = vi.spyOn(result.module.get(EventBusService, { strict: false }), 'emit');
    });
    afterEach(() => emit.mockRestore());

    const seen = () =>
      emit.mock.calls.filter(([pattern]) => pattern === EVENT_PATTERNS.NOTIFICATION.INAPP_SEEN);
    const acknowledged = () =>
      emit.mock.calls.filter(
        ([pattern]) => pattern === EVENT_PATTERNS.NOTIFICATION.PUSH_ACKNOWLEDGED,
      );

    it('publishes a pointer when a row of a flow is read, and nothing for a row without one', async () => {
      const inFlow = await insertRow({ recipientUserId: instituteA.userId, flowId });
      const plain = await insertRow({ recipientUserId: instituteA.userId });

      await gql(MARK, tokenX, { id: plain.id });
      expect(seen()).toHaveLength(0);

      await gql(MARK, tokenX, { id: inFlow.id });
      expect(seen()).toEqual([
        [
          EVENT_PATTERNS.NOTIFICATION.INAPP_SEEN,
          { notificationId: inFlow.id, recipientUserId: instituteA.userId },
        ],
      ]);
    });

    it('publishes a pointer when a row of a flow is archived', async () => {
      const inFlow = await insertRow({ recipientUserId: instituteA.userId, flowId });

      await gql(ARCHIVE, tokenX, { id: inFlow.id });

      expect(seen()).toHaveLength(1);
    });

    it('publishes one pointer per flow row marked by mark-all', async () => {
      const inFlow = await insertRow({ recipientUserId: instituteA.userId, flowId });
      await insertRow({ recipientUserId: instituteA.userId });

      await gql(MARK_ALL, tokenX);

      expect(seen().map(([, payload]) => payload)).toEqual([
        { notificationId: inFlow.id, recipientUserId: instituteA.userId },
      ]);
    });

    it('acknowledges the push of the caller’s own row and never exposes the flow', async () => {
      const own = await insertRow({ recipientUserId: instituteA.userId, flowId });

      const response = await gql<{ acknowledgeNotificationDelivery: boolean }>(ACK, tokenX, {
        id: own.id,
      });

      expect(response.errors).toBeUndefined();
      expect(response.data?.acknowledgeNotificationDelivery).toBe(true);
      expect(acknowledged()).toEqual([
        [
          EVENT_PATTERNS.NOTIFICATION.PUSH_ACKNOWLEDGED,
          { notificationId: own.id, recipientUserId: instituteA.userId },
        ],
      ]);
      expect(await stored(own.id)).toEqual(own);
    });

    it('refuses a flow row of a member of another institute, publishing and changing nothing', async () => {
      const foreign = await insertRow({
        recipientUserId: instituteB.userId,
        recipientMembershipId: instituteB.membershipId,
        tenantId: instituteB.tenantId,
        flowId,
      });

      for (const query of [MARK, ARCHIVE, ACK]) {
        const response = await gql(query, tokenX, { id: foreign.id });
        expect(code(response)).toBe('NOTIFICATION_NOT_FOUND');
        expect(response.data).toBeNull();
      }

      expect(seen()).toHaveLength(0);
      expect(acknowledged()).toHaveLength(0);
      expect(await stored(foreign.id)).toEqual(foreign);
    });

    it('refuses to acknowledge another member’s row and publishes nothing', async () => {
      const theirs = await insertRow({ recipientUserId: memberY.userId, flowId });

      const response = await gql(ACK, tokenX, { id: theirs.id });

      expect(code(response)).toBe('NOTIFICATION_NOT_FOUND');
      expect(acknowledged()).toHaveLength(0);
    });
  });

  describe('unauthenticated', () => {
    it.each([
      ['myNotifications', LIST, {}],
      ['myUnreadNotificationCount', COUNT, {}],
      ['markNotificationRead', MARK, { id: randomUUID() }],
      ['markAllNotificationsRead', MARK_ALL, {}],
      ['archiveNotification', ARCHIVE, { id: randomUUID() }],
      ['registerDeviceToken', REGISTER, { token: 'x', platform: 'WEB' }],
      ['unregisterDeviceToken', UNREGISTER, { token: 'x' }],
      ['adminNotificationDeliveries', DELIVERIES, {}],
    ])('refuses %s', async (_name, query, variables) => {
      expect(code(await gql(query, undefined, variables))).toBe('UNAUTHENTICATED');
    });
  });
});
