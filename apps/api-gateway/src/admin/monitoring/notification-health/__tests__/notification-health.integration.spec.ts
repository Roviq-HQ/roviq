/**
 * adminNotificationHealth (ROV-329) through resolver, service and withAdmin. OpenObserve is stubbed
 * so the test never reaches another instance's observability stack.
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
  createMock,
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../../app/app.module';
import { OpenObserveClient, OpenObserveUnavailableError } from '../../openobserve.client';
import { NotificationHealthRepository } from '../repositories/notification-health.repository';

const CTX = 'test:notification-health';
const SUPERUSER_URL =
  process.env.DATABASE_URL_TEST_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5434/roviq_test';

const QUERY = `query {
  adminNotificationHealth {
    metricsAvailable
    checkedAt
    channels { channel sent24h failed24h }
    canary { channel lastSuccessAt }
  }
}`;

interface HealthData {
  adminNotificationHealth: {
    metricsAvailable: boolean;
    checkedAt: string;
    channels: Array<{ channel: string; sent24h: number | null; failed24h: number | null }>;
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

  const openObserve = createMock<OpenObserveClient>({
    query: vi.fn().mockResolvedValue([]),
    queryRange: vi.fn().mockResolvedValue([]),
  });

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
  }): Promise<void> {
    const { rows } = await superPool.query<{ id: string }>(
      `INSERT INTO notification_deliveries
         (scope, tenant_id, recipient_user_id, type, channel, provider, status, error_code,
          created_at)
       VALUES ('platform', NULL, $1, $2, $3, 'log', $4, $5, $6)
       RETURNING id`,
      [
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
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: OpenObserveClient, useValue: openObserve }],
    });
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

  it('should return sends and failures per channel from OpenObserve and the canary per channel', async () => {
    vi.mocked(openObserve.query).mockResolvedValueOnce([
      { metric: { channel: 'EMAIL', status: 'SENT' }, value: 120.4 },
      { metric: { channel: 'EMAIL', status: 'FAILED' }, value: 3 },
      { metric: { channel: 'SMS', status: 'SENT' }, value: 7 },
      { metric: { channel: 'NOT_A_CHANNEL', status: 'SENT' }, value: 9 },
    ]);

    const { data, errors } = await gql();

    expect(errors).toBeUndefined();
    const health = data?.adminNotificationHealth;
    assert(health);
    expect(health.metricsAvailable).toBe(true);
    expect(health.channels).toEqual(
      NOTIFICATION_CHANNEL_VALUES.map((channel) => ({
        channel,
        sent24h: { EMAIL: 120, SMS: 7 }[channel as 'EMAIL' | 'SMS'] ?? 0,
        failed24h: channel === 'EMAIL' ? 3 : 0,
      })),
    );
    expect(health.canary.map((c) => c.channel)).toEqual([...NOTIFICATION_CHANNEL_VALUES]);
    expect(health.canary.find((c) => c.channel === 'EMAIL')?.lastSuccessAt).toBe(
      LATEST.toISOString(),
    );
  });

  it('should report the counts as unavailable when OpenObserve does not answer', async () => {
    vi.mocked(openObserve.query).mockRejectedValueOnce(
      new OpenObserveUnavailableError('connection refused'),
    );

    const { data, errors } = await gql();

    expect(errors).toBeUndefined();
    const health = data?.adminNotificationHealth;
    assert(health);
    expect(health.metricsAvailable).toBe(false);
    expect(health.channels.every((c) => c.sent24h === null && c.failed24h === null)).toBe(true);
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
