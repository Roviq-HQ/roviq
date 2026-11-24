/**
 * ROV-329 against the real test database: the delivery canary goes through the real
 * `ChannelSender` and adapters and writes only a platform delivery row, and the gauge's start
 * value comes from the latest SENT canary of each channel. The SMS and WhatsApp providers are a
 * local HTTP server that records every request.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import {
  createDrizzleDb,
  type DrizzleDB,
  messagingSenderSecrets,
  messagingSenders,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createTestInstitute,
  createTestTeacher,
  holdPlatformSenderLock,
  PLATFORM_SENDER_LOCK_WAIT_MS,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { LogChannelAdapter } from '../delivery/adapters/log.adapter';
import { SmsHttpAdapter } from '../delivery/adapters/sms-http.adapter';
import { WhatsAppCloudAdapter } from '../delivery/adapters/whatsapp-cloud.adapter';
import { ChannelSender } from '../delivery/channel-sender';
import { GuardianConsentGate } from '../delivery/consent-gate';
import { SmsHttp } from '../delivery/sms/sms-http';
import { SMS_HTTP_PROVIDER } from '../delivery/sms/sms-http.client';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { WHATSAPP_CLOUD_PROVIDER } from '../delivery/whatsapp/whatsapp-cloud.client';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { CanaryReadDrizzleRepository } from '../repositories/canary-read.drizzle-repository';
import { ConsentReadDrizzleRepository } from '../repositories/consent-read.drizzle-repository';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { DeliveryCanary } from '../services/delivery-canary.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { noDeliveryLimits } from './delivery-limits';

const CTX = 'test:delivery-canary';
const AT = '2026-11-24T10:15:00.000Z';
const CHECK_TIME = '24 Nov 2026, 15:45 IST';
const PHONE = '+919800000001';
const SMS_KEY = `spec-key-${randomUUID()}`;
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

interface ProviderRequest {
  path: string;
  body: Record<string, unknown>;
}

/** Stands in for both providers: SMS under `/sms`, WhatsApp everywhere else. */
class FakeProviders {
  readonly requests: ProviderRequest[] = [];
  private server: Server | null = null;
  private count = 0;
  readonly run = randomUUID().slice(0, 8);

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        this.count += 1;
        const path = req.url ?? '';
        this.requests.push({ path, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        const body = path.startsWith('/sms')
          ? { type: 'success', message: this.lastId() }
          : { messages: [{ id: this.lastId() }] };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${(address satisfies AddressInfo).port}`;
  }

  lastId(): string {
    return `msg-${this.run}-${this.count}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
// Far in the future and on channels the gateway's canary spec does not use, so neither spec
// sees the other's rows as the latest.
const LATEST_SMS = new Date('2098-05-06T07:08:09.000Z');

describe('delivery canary (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let user: TestTeacher;
  let canary: DeliveryCanary;
  let metrics: NotificationMetrics;
  let releaseLock: (() => Promise<void>) | null = null;
  let platformSenderId: string | null = null;
  const providers = new FakeProviders();

  function senderWith(adapters: ConstructorParameters<typeof ChannelAdapters>[0]): ChannelSender {
    return new ChannelSender(
      new ChannelAdapters(adapters),
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
  }

  async function rowsOf(table: 'notification_deliveries' | 'notifications') {
    const { rows } = await superPool.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [user.userId],
    );
    return rows;
  }

  async function insertCanary(channel: string, status: string, at: Date): Promise<void> {
    await superPool.query(
      `INSERT INTO notification_deliveries
         (scope, tenant_id, recipient_user_id, type, channel, provider, status, error_code,
          created_at)
       VALUES ('platform', NULL, $1, 'DELIVERY_CANARY', $2, 'log', $3, $4, $5)`,
      [user.userId, channel, status, status === 'FAILED' ? 'SMS_REJECTED' : null, at],
    );
  }

  beforeAll(async () => {
    const poolerUrl =
      process.env.DATABASE_URL_TEST ??
      'postgresql://roviq_pooler:roviq_pooler_dev@localhost:5434/roviq_test';
    const superUrl =
      process.env.DATABASE_URL_TEST_MIGRATE ??
      'postgresql://roviq:roviq_dev@localhost:5434/roviq_test';
    releaseLock = await holdPlatformSenderLock(superUrl);
    pool = new pg.Pool({ connectionString: poolerUrl });
    superPool = new pg.Pool({ connectionString: superUrl });
    db = createDrizzleDb(pool);
    const leftover = await superPool.query(
      `SELECT id FROM messaging_senders WHERE scope = 'platform' AND deleted_at IS NULL`,
    );
    assert.equal(leftover.rowCount, 0, 'a live platform sender was left in the test database');

    institute = await createTestInstitute(db);
    user = await createTestTeacher(db, institute.tenantId);

    const base = await providers.start();
    const cloud = new WhatsAppCloud(
      new ConfigService({
        NOTIFICATION_WHATSAPP_PROVIDER: 'cloud',
        WHATSAPP_API_BASE_URL: base,
        WHATSAPP_APP_SECRET: 'spec-app-secret',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'spec-verify-token',
        MESSAGING_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      }),
    );
    const sms = new SmsHttp(
      new ConfigService({
        NOTIFICATION_SMS_PROVIDER: 'http',
        SMS_API_BASE_URL: `${base}/sms`,
        SMS_API_KEY: SMS_KEY,
        SMS_TEMPLATE_IDS: JSON.stringify({
          'DELIVERY_CANARY:en': 'reg-canary-en',
          'DELIVERY_CANARY:hi': 'reg-canary-hi',
        }),
        SMS_WEBHOOK_SECRET: randomUUID() + randomUUID(),
      }),
    );
    platformSenderId = await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [row] = await tx
        .insert(messagingSenders)
        .values({
          ...by,
          scope: 'platform',
          tenantId: null,
          channel: 'WHATSAPP',
          provider: WHATSAPP_CLOUD_PROVIDER,
          providerNumberId: `canary-spec-${providers.run}`,
          displayNumber: '+910000000000',
          status: 'ACTIVE',
          dailyCap: 1000,
        })
        .returning({ id: messagingSenders.id });
      assert(row);
      await tx.insert(messagingSenderSecrets).values({
        ...by,
        senderId: row.id,
        accessTokenEncrypted: cloud.cipher.encrypt(`token-${randomUUID()}`),
      });
      return row.id;
    });

    metrics = new NotificationMetrics();
    canary = new DeliveryCanary(
      new ConfigService({
        NOTIFICATION_CANARY_CHANNELS: 'EMAIL,SMS,WHATSAPP',
        NOTIFICATION_CANARY_USER_ID: user.userId,
        NOTIFICATION_CANARY_EMAIL: 'canary@roviq.test',
        NOTIFICATION_CANARY_PHONE: PHONE,
      }),
      senderWith([
        new LogChannelAdapter('EMAIL'),
        new SmsHttpAdapter(sms),
        new WhatsAppCloudAdapter(cloud),
      ]),
      new CanaryReadDrizzleRepository(db),
      metrics,
    );
  }, PLATFORM_SENDER_LOCK_WAIT_MS);

  beforeEach(async () => {
    providers.requests.length = 0;
    // Append-only for every application role: removed as the owner.
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = $1', [
      user.userId,
    ]);
  });

  afterAll(async () => {
    try {
      if (superPool && user) {
        await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = $1', [
          user.userId,
        ]);
      }
      if (superPool && platformSenderId) {
        await superPool.query('DELETE FROM messaging_senders WHERE id = $1', [platformSenderId]);
      }
      if (db && user) await cleanupTestTeacher(db, user);
      if (db && institute) await cleanupTestInstitute(db, institute);
      await providers.stop();
      await pool?.end();
      await superPool?.end();
    } finally {
      await releaseLock?.();
    }
  });

  it('should write one platform DELIVERY_CANARY row and no in-app notification', async () => {
    const outcome = await canary.send('EMAIL', AT);

    expect(outcome?.status).toBe('SENT');
    const deliveries = await rowsOf('notification_deliveries');
    expect(
      deliveries.map((d) => ({
        scope: d.scope,
        tenant_id: d.tenant_id,
        reseller_id: d.reseller_id,
        notification_id: d.notification_id,
        type: d.type,
        channel: d.channel,
        provider: d.provider,
        status: d.status,
      })),
    ).toEqual([
      {
        scope: 'platform',
        tenant_id: null,
        reseller_id: null,
        notification_id: null,
        type: 'DELIVERY_CANARY',
        channel: 'EMAIL',
        provider: 'log',
        status: 'SENT',
      },
    ]);
    expect(await rowsOf('notifications')).toEqual([]);
  });

  it('should send the registered SMS template for DELIVERY_CANARY and move the gauge', async () => {
    const before = Math.floor(Date.now() / 1000);

    const outcome = await canary.send('SMS', AT);

    expect(outcome?.status).toBe('SENT');
    expect(providers.requests).toEqual([
      {
        path: '/sms/flow',
        body: {
          template_id: 'reg-canary-en',
          short_url: '0',
          recipients: [{ mobiles: PHONE.replace('+', ''), var1: CHECK_TIME }],
        },
      },
    ]);
    const deliveries = await rowsOf('notification_deliveries');
    expect(
      deliveries.map((d) => [d.scope, d.tenant_id, d.type, d.channel, d.provider, d.status]),
    ).toEqual([['platform', null, 'DELIVERY_CANARY', 'SMS', SMS_HTTP_PROVIDER, 'SENT']]);
    expect(metrics.canaryLastSuccess('SMS')).toBeGreaterThanOrEqual(before);
  });

  it("should send the WhatsApp canary template through the platform's sender", async () => {
    const outcome = await canary.send('WHATSAPP', AT);

    expect(outcome?.status).toBe('SENT');
    expect(providers.requests).toHaveLength(1);
    const [request] = providers.requests;
    assert(request);
    expect(request.path).toBe(`/canary-spec-${providers.run}/messages`);
    expect(request.body.to).toBe(PHONE.replace('+', ''));
    expect(request.body.type).toBe('template');
    expect(request.body.template).toEqual({
      name: 'delivery_canary_v2',
      language: { code: 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: CHECK_TIME }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: 'login' }],
        },
      ],
    });
    const deliveries = await rowsOf('notification_deliveries');
    expect(
      deliveries.map((d) => [
        d.scope,
        d.tenant_id,
        d.type,
        d.channel,
        d.provider,
        d.status,
        d.sender_id,
        d.template_category,
      ]),
    ).toEqual([
      [
        'platform',
        null,
        'DELIVERY_CANARY',
        'WHATSAPP',
        WHATSAPP_CLOUD_PROVIDER,
        'SENT',
        platformSenderId,
        'UTILITY',
      ],
    ]);
    expect(metrics.canaryLastSuccess('WHATSAPP')).toBeDefined();
  });

  it('should leave the gauge alone and record the skip when the channel has no provider', async () => {
    const gauge = new NotificationMetrics();
    const bare = new DeliveryCanary(
      new ConfigService({
        NOTIFICATION_CANARY_CHANNELS: 'SMS',
        NOTIFICATION_CANARY_USER_ID: user.userId,
        NOTIFICATION_CANARY_PHONE: PHONE,
      }),
      senderWith([]),
      new CanaryReadDrizzleRepository(db),
      gauge,
    );

    const outcome = await bare.send('SMS', AT);

    expect(outcome).toEqual({ status: 'SKIPPED', provider: null, skipReason: 'no_provider' });
    expect(gauge.canaryLastSuccess('SMS')).toBeUndefined();
    const deliveries = await rowsOf('notification_deliveries');
    expect(deliveries.map((d) => [d.scope, d.type, d.channel, d.status, d.skip_reason])).toEqual([
      ['platform', 'DELIVERY_CANARY', 'SMS', 'SKIPPED', 'no_provider'],
    ]);
  });

  it('should seed the gauge from the latest SENT canary of each channel', async () => {
    const hour = 60 * 60 * 1000;
    await insertCanary('SMS', 'SENT', new Date(LATEST_SMS.getTime() - hour));
    await insertCanary('SMS', 'SENT', LATEST_SMS);
    await insertCanary('SMS', 'FAILED', new Date(LATEST_SMS.getTime() + hour));

    const rows = await new CanaryReadDrizzleRepository(db).latestSentPerChannel();

    expect(rows.find((r) => r.channel === 'SMS')?.sentAt.toISOString()).toBe(
      LATEST_SMS.toISOString(),
    );
    const seeded = new NotificationMetrics();
    await new DeliveryCanary(
      new ConfigService({
        NOTIFICATION_CANARY_CHANNELS: 'SMS',
        NOTIFICATION_CANARY_USER_ID: user.userId,
        NOTIFICATION_CANARY_PHONE: PHONE,
      }),
      senderWith([]),
      new CanaryReadDrizzleRepository(db),
      seeded,
    ).onApplicationBootstrap();
    expect(seeded.canaryLastSuccess('SMS')).toBe(LATEST_SMS.getTime() / 1000);
  });
});
