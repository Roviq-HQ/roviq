/**
 * ROV-318 delivery reports against the real test database: who may post one, what one report
 * can write, and that it writes once.
 */
import { randomUUID } from 'node:crypto';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createDrizzleDb, type DrizzleDB } from '@roviq/database';
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
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmsWebhookController } from '../controllers/sms-webhook.controller';
import type { SmsHttp } from '../delivery/sms/sms-http';
import { SMS_HTTP_PROVIDER } from '../delivery/sms/sms-http.client';
import { DeliveryReceiptDrizzleRepository } from '../repositories/delivery-receipt.drizzle-repository';
import { FlowArrivals } from '../services/flow-arrivals.service';
import { SmsWebhookService } from '../services/sms-webhook.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';

const SECRET = `spec-secret-${randomUUID()}`;

describe('SMS delivery reports (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let instituteA: TestInstitute;
  let instituteB: TestInstitute;
  let userA: TestTeacher;
  let userB: TestTeacher;
  let controller: SmsWebhookController;
  const temporal = createMock<TemporalClientService>({ signal: vi.fn().mockResolvedValue(true) });
  const run = randomUUID().slice(0, 8);
  let seq = 0;

  /** A SENT row as the adapter leaves it; returns the provider's request id. */
  async function sentMessage(
    institute: TestInstitute,
    user: TestTeacher,
    provider = SMS_HTTP_PROVIDER,
    flowId: string | null = null,
  ): Promise<string> {
    seq += 1;
    const requestId = `req-${run}-${seq}`;
    await superPool.query(
      `INSERT INTO notification_deliveries
         (scope, tenant_id, recipient_user_id, type, channel, provider, status, provider_message_id,
          flow_id)
       VALUES ('institute', $1, $2, 'USER_WELCOME', 'SMS', $3, 'SENT', $4, $5)`,
      [institute.tenantId, user.userId, provider, requestId, flowId],
    );
    return requestId;
  }

  async function rows(userId: string) {
    const { rows: found } = await superPool.query<{
      status: string;
      error_code: string | null;
      tenant_id: string;
      provider_message_id: string;
      type: string;
    }>(
      `SELECT status, error_code, tenant_id, provider_message_id, type
         FROM notification_deliveries WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return found;
  }

  const report = (requestId: string, status: string, extra: Record<string, unknown> = {}) => [
    { requestId, userId: '1', report: [{ status, number: '919000000001', desc: 'x' }], ...extra },
  ];

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
    instituteA = await createTestInstitute(db);
    instituteB = await createTestInstitute(db);
    userA = await createTestTeacher(db, instituteA.tenantId);
    userB = await createTestTeacher(db, instituteB.tenantId);
    controller = new SmsWebhookController(
      createMock<SmsHttp>({ enabled: true, webhookSecret: SECRET }),
      new SmsWebhookService(
        new DeliveryReceiptDrizzleRepository(db),
        new FlowArrivals(temporal),
        new NotificationMetrics(),
      ),
    );
  });

  beforeEach(async () => {
    temporal.signal.mockClear();
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)', [
      [userA.userId, userB.userId],
    ]);
  });

  afterAll(async () => {
    if (db) {
      await superPool.query(
        'DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)',
        [[userA?.userId, userB?.userId].filter(Boolean)],
      );
      if (userA) await cleanupTestTeacher(db, userA);
      if (userB) await cleanupTestTeacher(db, userB);
      if (instituteA) await cleanupTestInstitute(db, instituteA);
      if (instituteB) await cleanupTestInstitute(db, instituteB);
    }
    await pool?.end();
    await superPool?.end();
  });

  it('should refuse a call without the secret and write nothing', async () => {
    const requestId = await sentMessage(instituteA, userA);

    for (const wrong of ['', 'wrong', `${SECRET}x`, SECRET.slice(0, -1)]) {
      await expect(controller.receive(wrong, report(requestId, '1'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    expect(await rows(userA.userId)).toHaveLength(1);
  });

  it('should not exist when the SMS provider is not configured', async () => {
    const off = new SmsWebhookController(
      createMock<SmsHttp>({ enabled: false }),
      createMock<SmsWebhookService>(),
    );
    await expect(off.receive(SECRET, [])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should append one DELIVERED row, once however often the report is repeated', async () => {
    const requestId = await sentMessage(instituteA, userA);

    await expect(controller.receive(SECRET, report(requestId, '1'))).resolves.toBe('ok');
    await controller.receive(SECRET, { data: JSON.stringify(report(requestId, '1')) });
    await Promise.all([
      controller.receive(SECRET, report(requestId, '1')),
      controller.receive(SECRET, report(requestId, '1')),
    ]);

    expect(await rows(userA.userId)).toEqual([
      expect.objectContaining({ status: 'SENT', provider_message_id: requestId }),
      {
        status: 'DELIVERED',
        error_code: null,
        tenant_id: instituteA.tenantId,
        provider_message_id: requestId,
        type: 'USER_WELCOME',
      },
    ]);
  });

  it('should append FAILED with a stable code for a failed report', async () => {
    const requestId = await sentMessage(instituteA, userA);

    await controller.receive(SECRET, report(requestId, '16'));

    expect((await rows(userA.userId)).at(-1)).toMatchObject({
      status: 'FAILED',
      error_code: 'SMS_REJECTED',
    });
  });

  it("should take the institute from the stored message, never from the report's body", async () => {
    const requestId = await sentMessage(instituteA, userA);

    await controller.receive(
      SECRET,
      report(requestId, '1', { tenantId: instituteB.tenantId, tenant_id: instituteB.tenantId }),
    );

    expect((await rows(userA.userId)).map((r) => r.tenant_id)).toEqual([
      instituteA.tenantId,
      instituteA.tenantId,
    ]);
    expect(await rows(userB.userId)).toEqual([]);
  });

  it('should ignore a report for a message this service did not send through this provider', async () => {
    const otherProvider = await sentMessage(instituteA, userA, 'log');

    await expect(controller.receive(SECRET, report(otherProvider, '1'))).resolves.toBe('ok');
    await expect(controller.receive(SECRET, report('req-never-sent', '1'))).resolves.toBe('ok');
    await expect(controller.receive(SECRET, 'not a report')).resolves.toBe('ok');

    expect(await rows(userA.userId)).toHaveLength(1);
  });

  it('should copy the flow id and tell the flow once when its SMS is delivered (ROV-332)', async () => {
    const flowId = `notification-flow:spec-${run}`;
    const requestId = await sentMessage(instituteA, userA, SMS_HTTP_PROVIDER, flowId);

    await controller.receive(SECRET, report(requestId, '1'));
    await controller.receive(SECRET, report(requestId, '1'));

    const { rows: flows } = await superPool.query<{ status: string; flow_id: string | null }>(
      `SELECT status, flow_id FROM notification_deliveries
        WHERE provider_message_id = $1 ORDER BY created_at, id`,
      [requestId],
    );
    expect(flows).toEqual([
      { status: 'SENT', flow_id: flowId },
      { status: 'DELIVERED', flow_id: flowId },
    ]);
    expect(temporal.signal.mock.calls).toEqual([
      [flowId, 'flowArrival', [{ recipientUserId: userA.userId, via: 'SMS' }]],
    ]);
  });

  it('should tell no flow about a failed report, or a delivered one of a message with no flow', async () => {
    const failed = await sentMessage(
      instituteA,
      userA,
      SMS_HTTP_PROVIDER,
      `notification-flow:f-${run}`,
    );
    const noFlow = await sentMessage(instituteA, userA);

    await controller.receive(SECRET, report(failed, '16'));
    await controller.receive(SECRET, report(noFlow, '1'));

    expect(temporal.signal).not.toHaveBeenCalled();
  });
});
