/**
 * adminNotificationHealth (ROV-329, ROV-336) through resolver, service and withAdmin. The rows sit
 * in 2099, so no row another spec or the dev stack writes falls in the windows counted here.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode, NOTIFICATION_CHANNEL_VALUES } from '@roviq/common-types';
import { mkAdminCtx, roles, SYSTEM_USER_ID, withAdmin } from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../../app/app.module';
import { NotificationHealthRepository } from '../repositories/notification-health.repository';

const CTX = 'test:notification-health';
const SUPERUSER_URL =
  process.env.DATABASE_URL_TEST_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5434/roviq_test';

const QUERY = `query {
  adminNotificationHealth {
    checkedAt
    channels { channel sent24h failed24h }
    canary { channel lastSuccessAt }
  }
}`;

interface HealthData {
  adminNotificationHealth: {
    checkedAt: string;
    channels: Array<{ channel: string; sent24h: number; failed24h: number }>;
    canary: Array<{ channel: string; lastSuccessAt: string | null }>;
  };
}

describe('adminNotificationHealth (integration)', () => {
  let result: IntegrationAppResult;
  let superPool: pg.Pool;
  let institute: TestInstitute;
  let reseller: TestReseller;
  let limitedRoleId: string;
  const deliveryIds: string[] = [];
  // Far in the future, so no canary another spec or the dev stack writes is newer.
  const LATEST = new Date('2099-01-02T03:04:05.000Z');

  const platformToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  const gql = (token = platformToken) =>
    gqlRequest<HealthData>(result.httpServer, { query: QUERY, token });

  async function insertDelivery(row: {
    type: string;
    channel: string;
    status: string;
    at: Date;
    /** An institute's row instead of the platform's. */
    tenantId?: string;
  }): Promise<void> {
    const { rows } = await superPool.query<{ id: string }>(
      `INSERT INTO notification_deliveries
         (scope, tenant_id, recipient_user_id, type, channel, provider, status, error_code,
          created_at)
       VALUES ($1, $2, $3, $4, $5, 'log', $6, $7, $8)
       RETURNING id`,
      [
        row.tenantId ? 'institute' : 'platform',
        row.tenantId ?? null,
        SEED_IDS.USER_ADMIN,
        row.type,
        row.channel,
        row.status,
        row.status === 'FAILED' ? 'EAUTH' : null,
        row.at,
      ],
    );
    const [inserted] = rows;
    assert(inserted);
    deliveryIds.push(inserted.id);
  }

  beforeAll(async () => {
    superPool = new pg.Pool({ connectionString: SUPERUSER_URL, max: 2 });
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);
    const [role] = await withAdmin(result.db, mkAdminCtx(CTX), (tx) =>
      tx
        .insert(roles)
        .values({
          name: { en: `Senders only ${randomUUID().slice(0, 8)}` },
          scope: 'platform',
          abilities: [{ action: 'read', subject: 'MessagingSender' }],
          isDefault: false,
          isSystem: false,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: roles.id }),
    );
    assert(role);
    limitedRoleId = role.id;

    const hour = 60 * 60 * 1000;
    await insertDelivery({
      type: 'DELIVERY_CANARY',
      channel: 'EMAIL',
      status: 'SENT',
      at: new Date(LATEST.getTime() - hour),
    });
    await insertDelivery({ type: 'DELIVERY_CANARY', channel: 'EMAIL', status: 'SENT', at: LATEST });
    // Not a success, and not a canary: neither moves the last success.
    await insertDelivery({
      type: 'DELIVERY_CANARY',
      channel: 'EMAIL',
      status: 'FAILED',
      at: new Date(LATEST.getTime() + hour),
    });
    await insertDelivery({
      type: 'AUTH_LOGIN',
      channel: 'EMAIL',
      status: 'SENT',
      at: new Date(LATEST.getTime() + 2 * hour),
    });
    await insertDelivery({
      type: 'DELIVERY_CANARY',
      channel: 'WHATSAPP',
      status: 'SENT',
      at: new Date(LATEST.getTime() - 2 * hour),
    });
    // Counted as an institute's failure; a later report and an older send are not counted.
    await insertDelivery({
      type: 'AUTH_LOGIN',
      channel: 'SMS',
      status: 'FAILED',
      at: LATEST,
      tenantId: institute.tenantId,
    });
    await insertDelivery({ type: 'AUTH_LOGIN', channel: 'EMAIL', status: 'DELIVERED', at: LATEST });
    await insertDelivery({
      type: 'AUTH_LOGIN',
      channel: 'EMAIL',
      status: 'SENT',
      at: new Date(LATEST.getTime() - 4 * hour),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    try {
      if (superPool && deliveryIds.length > 0) {
        // Append-only for every application role: removed as the owner.
        await superPool.query('DELETE FROM notification_deliveries WHERE id = ANY($1::uuid[])', [
          deliveryIds,
        ]);
      }
      if (result && limitedRoleId) {
        await withAdmin(result.db, mkAdminCtx(CTX), (tx) =>
          tx.delete(roles).where(eq(roles.id, limitedRoleId)),
        );
      }
      if (institute) await cleanupTestInstitute(result.db, institute);
      if (reseller) await cleanupTestReseller(result.db, reseller);
      await result?.close();
    } finally {
      await superPool?.end();
    }
  });

  it('should give the latest SENT canary per channel, ignoring failures and other types', async () => {
    const rows = await result.app
      .get(NotificationHealthRepository)
      .latestCanarySuccess(mkAdminCtx(CTX));

    const byChannel = new Map(rows.map((r) => [r.channel, r.sentAt.toISOString()]));
    expect(byChannel.get('EMAIL')).toBe(LATEST.toISOString());
    expect(byChannel.get('WHATSAPP')).toBe(
      new Date(LATEST.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('should count SENT and FAILED rows of every scope since the given time, per channel', async () => {
    const rows = await result.app
      .get(NotificationHealthRepository)
      .countSendsSince(mkAdminCtx(CTX), new Date(LATEST.getTime() - 3 * 60 * 60 * 1000));

    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      expect.arrayContaining([
        { channel: 'EMAIL', status: 'SENT', count: 3 },
        { channel: 'EMAIL', status: 'FAILED', count: 1 },
        { channel: 'WHATSAPP', status: 'SENT', count: 1 },
        { channel: 'SMS', status: 'FAILED', count: 1 },
      ]),
    );
  });

  it('should return the last 24 hours of sends and failures per channel and the canary per channel', async () => {
    // Only the clock is faked: the 24 hours end 3 hours after the latest row.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(LATEST.getTime() + 3 * 60 * 60 * 1000));

    const { data, errors } = await gql(
      createPlatformToken({
        sub: SEED_IDS.USER_ADMIN,
        membershipId: randomUUID(),
        roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
      }),
    );

    expect(errors).toBeUndefined();
    const health = data?.adminNotificationHealth;
    assert(health);
    expect(health.channels).toEqual([
      { channel: 'EMAIL', sent24h: 4, failed24h: 1 },
      { channel: 'PUSH', sent24h: 0, failed24h: 0 },
      { channel: 'SMS', sent24h: 0, failed24h: 1 },
      { channel: 'WHATSAPP', sent24h: 1, failed24h: 0 },
    ]);
    expect(health.canary.map((c) => c.channel)).toEqual([...NOTIFICATION_CHANNEL_VALUES]);
    expect(health.canary.find((c) => c.channel === 'EMAIL')?.lastSuccessAt).toBe(
      LATEST.toISOString(),
    );
  });

  it('should refuse a platform role without read SystemHealth', async () => {
    const token = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: limitedRoleId,
    });

    const { errors } = await gql(token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should refuse an institute token', async () => {
    const token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });

    const { errors } = await gql(token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should refuse a reseller token', async () => {
    const token = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });

    const { errors } = await gql(token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });
});
