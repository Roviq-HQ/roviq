/**
 * In-app notifications end to end (ROV-314): marking a student absent travels
 * api-gateway → NATS → notification-service → `notifications` row → NATS → api-gateway
 * → the guardian's `notificationReceived` subscription.
 *
 * Per-person isolation (other institute, other membership, other scope), wrong-scope and
 * unauthenticated refusals and the device-token rules are proven in
 * `apps/api-gateway/src/notification-inbox/__tests__/notification-inbox.integration.spec.ts`.
 */
import assert from 'node:assert';
import { isDeepStrictEqual } from 'node:util';
import { AttendanceStatus } from '@roviq/common-types';
import { print } from 'graphql';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED, SEED_IDS } from '../../shared/seed-fixtures';
import {
  E2eAdminNotificationDeliveriesDocument,
  E2eMarkNotificationReadDocument,
  E2eMyNotificationsDocument,
  E2eMyUnreadNotificationCountDocument,
  E2eNotificationAttendanceSessionDocument,
  E2eNotificationEndImpersonationDocument,
  E2eNotificationExchangeImpersonationCodeDocument,
  E2eNotificationMarkAttendanceDocument,
  E2eNotificationOpenAttendanceSessionDocument,
  E2eNotificationReceivedDocument,
  type E2eNotificationReceivedSubscription,
  E2eNotificationStartImpersonationDocument,
} from './__generated__/graphql';
import {
  loginAsInstituteAdmin,
  loginAsMultiChildGuardian,
  loginAsPlatformAdmin,
  loginAsTeacher,
} from './helpers/auth';
import { gql } from './helpers/gql-client';
import { subscribeUntil } from './helpers/ws-client';

// The pipeline crosses two services and NATS twice.
const DELIVERY_TIMEOUT_MS = 20_000;
// The API's page cap; a fresh alert sits near the top of the newest-first list.
const UNREAD_PAGE = 50;
const OVERRIDE_REASON = 'ROV-314 notification e2e: absence on a fresh session';
// guardian4: password-change.api-e2e.spec.ts rotates guardian1's password, which ends every
// guardian1 session mid-run. No spec changes guardian4's password.
const GUARDIAN = SEED.MULTI_CHILD_GUARDIAN_USER;
const CHILD_ID = SEED_IDS.MEMBERSHIP_STUDENT_6;

function claimsOf(token: string): { impersonationSessionId: string } {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
}

async function unreadCount(token: string): Promise<number> {
  const res = await gql(E2eMyUnreadNotificationCountDocument, undefined, token);
  expect(res.errors).toBeUndefined();
  assert(res.data);
  return res.data.myUnreadNotificationCount;
}

// Other specs log in as the same guardian in parallel and each login adds an unread alert,
// so assertions name this notification instead of comparing totals.
async function unreadEntry(token: string, id: string) {
  const res = await gql(
    E2eMyNotificationsDocument,
    { first: UNREAD_PAGE, unreadOnly: true },
    token,
  );
  expect(res.errors).toBeUndefined();
  assert(res.data);
  return res.data.myNotifications.edges.find(({ node }) => node.id === id)?.node ?? null;
}

describe('In-app notifications (E2E)', () => {
  let adminToken: string;
  let guardianToken: string;
  let guardianUserId: string;
  let teacherToken: string;
  let platformToken: string;

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsInstituteAdmin());
    ({ accessToken: guardianToken, userId: guardianUserId } = await loginAsMultiChildGuardian());
    expect(guardianUserId).toBe(GUARDIAN.id);
    ({ accessToken: teacherToken } = await loginAsTeacher());
    ({ accessToken: platformToken } = await loginAsPlatformAdmin());
  });

  it('delivers an absence to the guardian live, and only the guardian may mark it read', async () => {
    // A fresh session per run: the pipeline sends one alert per session, student and status.
    const seeded = await gql(
      E2eNotificationAttendanceSessionDocument,
      { id: SEED_IDS.ATTENDANCE_SESSION_1 },
      adminToken,
    );
    expect(seeded.errors).toBeUndefined();
    assert(seeded.data);
    const opened = await gql(
      E2eNotificationOpenAttendanceSessionDocument,
      {
        input: {
          sectionId: seeded.data.attendanceSession.sectionId,
          academicYearId: seeded.data.attendanceSession.academicYearId,
          date: new Date().toISOString().slice(0, 10),
          period: 100 + Math.floor(Math.random() * 30_000),
          lecturerId: SEED_IDS.MEMBERSHIP_TEACHER_INST1,
        },
      },
      adminToken,
    );
    expect(opened.errors).toBeUndefined();
    assert(opened.data);

    const sessionId = opened.data.openAttendanceSession.id;
    const received = subscribeUntil<E2eNotificationReceivedSubscription>(
      print(E2eNotificationReceivedDocument),
      {},
      guardianToken,
      ({ notificationReceived: n }) =>
        n.type === 'ATTENDANCE_ABSENT' &&
        isDeepStrictEqual(n.data, {
          sessionId,
          studentId: CHILD_ID,
          path: '/institute/attendance',
        }),
      DELIVERY_TIMEOUT_MS,
    );
    await new Promise((r) => setTimeout(r, 200)); // connection_init warm-up

    const marked = await gql(
      E2eNotificationMarkAttendanceDocument,
      {
        input: {
          sessionId,
          studentId: CHILD_ID,
          status: AttendanceStatus.ABSENT,
        },
        overridePastDay: true,
        overrideReason: OVERRIDE_REASON,
      },
      adminToken,
    );
    expect(marked.errors).toBeUndefined();

    const { notificationReceived: notification } = await received;
    expect(notification.type).toBe('ATTENDANCE_ABSENT');
    expect(notification.readAt).toBeNull();
    expect(notification.archivedAt).toBeNull();
    expect(notification.title.en).toBe('Absence recorded');
    expect(notification.data).toEqual({
      sessionId,
      studentId: CHILD_ID,
      path: '/institute/attendance',
    });
    expect(await unreadEntry(guardianToken, notification.id)).toEqual({
      id: notification.id,
      type: 'ATTENDANCE_ABSENT',
      readAt: null,
    });
    // A count equal to a list total would race other logins; this one cannot.
    expect(await unreadCount(guardianToken)).toBeGreaterThanOrEqual(1);

    // Another person's token, in the same institute, cannot see the id exists.
    const asTeacher = await gql(
      E2eMarkNotificationReadDocument,
      { id: notification.id },
      teacherToken,
    );
    expect(asTeacher.errors?.[0]?.extensions?.code).toBe('NOTIFICATION_NOT_FOUND');

    // Support acting as the guardian may look but not clear the guardian's alert.
    const start = await gql(
      E2eNotificationStartImpersonationDocument,
      {
        targetUserId: guardianUserId,
        targetTenantId: SEED_IDS.INSTITUTE_1,
        reason: 'ROV-314 notification e2e: impersonated mark-read refusal',
      },
      platformToken,
    );
    expect(start.errors).toBeUndefined();
    const code = start.data?.adminStartImpersonation.code;
    assert(code);
    const exchange = await gql(E2eNotificationExchangeImpersonationCodeDocument, { code });
    expect(exchange.errors).toBeUndefined();
    const impersonationToken = exchange.data?.exchangeImpersonationCode.accessToken;
    assert(impersonationToken);

    expect((await unreadEntry(impersonationToken, notification.id))?.readAt).toBeNull();
    const asSupport = await gql(
      E2eMarkNotificationReadDocument,
      { id: notification.id },
      impersonationToken,
    );
    expect(asSupport.errors?.[0]?.extensions?.code).toBe('IMPERSONATION_OWN_ACCOUNT');
    const ended = await gql(
      E2eNotificationEndImpersonationDocument,
      { sessionId: claimsOf(impersonationToken).impersonationSessionId },
      impersonationToken,
    );
    expect(ended.errors).toBeUndefined();
    expect((await unreadEntry(guardianToken, notification.id))?.readAt).toBeNull();

    const read = await gql(E2eMarkNotificationReadDocument, { id: notification.id }, guardianToken);
    expect(read.errors).toBeUndefined();
    expect(read.data?.markNotificationRead.id).toBe(notification.id);
    expect(read.data?.markNotificationRead.readAt).not.toBeNull();
    expect(await unreadEntry(guardianToken, notification.id)).toBeNull();

    // Support can trace what happened on the other channels.
    await vi.waitFor(
      async () => {
        const deliveries = await gql(
          E2eAdminNotificationDeliveriesDocument,
          { filter: { recipientUserId: guardianUserId, type: 'ATTENDANCE_ABSENT' }, first: 100 },
          platformToken,
        );
        expect(deliveries.errors).toBeUndefined();
        const forThis = (deliveries.data?.adminNotificationDeliveries.edges ?? [])
          .map((edge) => edge.node)
          .filter((node) => node.notificationId === notification.id);
        // A guardian's flow is app, then WhatsApp, then SMS; every channel leaves a row, also
        // when it was not needed. A failed attempt is retried as a new row, so compare channels.
        expect([...new Set(forThis.map((node) => node.channel))].sort()).toEqual([
          'PUSH',
          'SMS',
          'WHATSAPP',
        ]);
        for (const node of forThis) {
          expect(node.recipientUserId).toBe(guardianUserId);
          expect(node.tenantId).toBe(SEED_IDS.INSTITUTE_1);
        }
      },
      { timeout: DELIVERY_TIMEOUT_MS, interval: 500 },
    );
  });
});
