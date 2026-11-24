/**
 * ROV-318 against the real test database: a registered SMS template goes through the real
 * `ChannelSender` and `SmsHttpAdapter` to a local HTTP server that stands in for the provider.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { createDrizzleDb, type DrizzleDB } from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createTestInstitute,
  createTestTeacher,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildChannelAdapters, ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { SmsHttpAdapter } from '../delivery/adapters/sms-http.adapter';
import { type ChannelAttempt, ChannelSender } from '../delivery/channel-sender';
import { GuardianConsentGate } from '../delivery/consent-gate';
import { SmsHttp } from '../delivery/sms/sms-http';
import { SMS_HTTP_PROVIDER } from '../delivery/sms/sms-http.client';
import { type SmsDraft, SmsVariableError } from '../delivery/sms/sms-template';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { ConsentReadDrizzleRepository } from '../repositories/consent-read.drizzle-repository';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { NotificationMetrics } from '../telemetry/notification-metrics';

const AUTH_KEY = `spec-key-${randomUUID()}`;
const CODE = '739155';
const PHONE = '+919000000001';
const REGISTERED: SmsDraft = { registrationKey: 'SPEC_OTP:en', variables: [CODE], unicode: false };

interface ProviderRequest {
  path: string;
  authkey: string | undefined;
  body: unknown;
}

/** Stands in for the provider's send endpoint and records every request. */
class FakeProvider {
  readonly requests: ProviderRequest[] = [];
  /** Answers for the next requests, in order; when empty every request is accepted. */
  readonly answers: Array<{ status: number; body: unknown }> = [];
  private server: Server | null = null;
  private count = 0;
  readonly run = randomUUID().slice(0, 8);

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        this.count += 1;
        const header = req.headers.authkey;
        this.requests.push({
          path: req.url ?? '',
          authkey: typeof header === 'string' ? header : undefined,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
        const answer = this.answers.shift() ?? {
          status: 200,
          body: { type: 'success', message: `req-${this.run}-${this.count}` },
        };
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${(address satisfies AddressInfo).port}/api`;
  }

  lastRequestId(): string {
    return `req-${this.run}-${this.count}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('SMS delivery through the provider adapter (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let institute: TestInstitute;
  let user: TestTeacher;
  let sender: ChannelSender;
  /** `NOTIFICATION_SMS_PROVIDER=http,log`: the provider first, the log stand-in second. */
  let failover: ChannelSender;
  const provider = new FakeProvider();

  function attempt(sms: ChannelAttempt['sms']): ChannelAttempt {
    return {
      type: 'IMPERSONATION_OTP',
      channel: 'SMS',
      audience: { scope: 'institute', tenantId: institute.tenantId, resellerId: null },
      recipientUserId: user.userId,
      notificationId: null,
      flowId: null,
      channelEnabled: true,
      critical: true,
      deferrable: false,
      attempt: 1,
      address: { given: PHONE },
      data: {},
      compose: () => ({ subject: 'Your code', body: `Your code is ${CODE}` }),
      sms,
    };
  }

  async function deliveries() {
    const { rows } = await superPool.query<{
      status: string;
      skip_reason: string | null;
      error_code: string | null;
      provider: string | null;
      provider_message_id: string | null;
      channel: string;
      tenant_id: string | null;
      json: string;
    }>(
      `SELECT status, skip_reason, error_code, provider, provider_message_id, channel, tenant_id,
              row_to_json(d)::text AS json
         FROM notification_deliveries d WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [user.userId],
    );
    return rows;
  }

  async function expectNoCodeStored() {
    const rows = await deliveries();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.json).not.toContain(CODE);
      expect(row.json).not.toContain(AUTH_KEY);
    }
  }

  function senderWith(adapters: ChannelAdapters): ChannelSender {
    return new ChannelSender(
      adapters,
      new GuardianConsentGate(new ConsentReadDrizzleRepository(db)),
      new ContactReadDrizzleRepository(db),
      new NotificationWriteDrizzleRepository(db),
      new WhatsAppRoute(
        new MessagingSenderDrizzleRepository(db),
        new RecipientReadDrizzleRepository(db),
        new Clock(),
      ),
      new NotificationMetrics(),
    );
  }

  beforeAll(async () => {
    const poolerUrl =
      process.env.DATABASE_URL_TEST ??
      'postgresql://roviq_pooler:roviq_pooler_dev@localhost:5434/roviq_test';
    const superUrl =
      process.env.DATABASE_URL_TEST_MIGRATE ??
      'postgresql://roviq:roviq_dev@localhost:5434/roviq_test';
    pool = new pg.Pool({ connectionString: poolerUrl });
    superPool = new pg.Pool({ connectionString: superUrl });
    db = createDrizzleDb(pool);

    institute = await createTestInstitute(db);
    user = await createTestTeacher(db, institute.tenantId);

    const sms = new SmsHttp(
      new ConfigService({
        NOTIFICATION_SMS_PROVIDER: 'http',
        SMS_API_BASE_URL: await provider.start(),
        SMS_API_KEY: AUTH_KEY,
        SMS_TEMPLATE_IDS: JSON.stringify({ 'SPEC_OTP:en': 'reg-spec-1' }),
        SMS_WEBHOOK_SECRET: randomUUID() + randomUUID(),
      }),
    );
    sender = senderWith(new ChannelAdapters([new SmsHttpAdapter(sms)]));
    failover = senderWith(
      buildChannelAdapters(
        { NOTIFICATION_SMS_PROVIDER: 'http,log' },
        new ContactReadDrizzleRepository(db),
        new WhatsAppCloud(new ConfigService({})),
        sms,
      ),
    );
  });

  beforeEach(async () => {
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = $1', [
      user.userId,
    ]);
    provider.requests.length = 0;
    provider.answers.length = 0;
  });

  afterAll(async () => {
    if (superPool && user) {
      await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = $1', [
        user.userId,
      ]);
    }
    if (db && user) await cleanupTestTeacher(db, user);
    if (db && institute) await cleanupTestInstitute(db, institute);
    await provider.stop();
    await pool?.end();
    await superPool?.end();
  });

  it('should send a registered template once and record SENT with the request id', async () => {
    await sender.attempt(attempt(() => REGISTERED));

    expect(provider.requests).toEqual([
      {
        path: '/api/flow',
        authkey: AUTH_KEY,
        body: {
          template_id: 'reg-spec-1',
          short_url: '0',
          recipients: [{ mobiles: '919000000001', var1: CODE }],
        },
      },
    ]);
    const rows = await deliveries();
    expect(rows.map(({ json: _json, ...fields }) => fields)).toEqual([
      {
        status: 'SENT',
        skip_reason: null,
        error_code: null,
        provider: SMS_HTTP_PROVIDER,
        provider_message_id: provider.lastRequestId(),
        channel: 'SMS',
        tenant_id: institute.tenantId,
      },
    ]);
    await expectNoCodeStored();
  });

  it('should skip a draft whose key has no registration without calling the provider', async () => {
    await sender.attempt(attempt(() => ({ ...REGISTERED, registrationKey: 'SPEC_OTP:hi' })));

    expect(provider.requests).toEqual([]);
    const rows = await deliveries();
    expect(rows.map((r) => [r.status, r.skip_reason, r.provider])).toEqual([
      ['SKIPPED', 'no_template', null],
    ]);
    await expectNoCodeStored();
  });

  it('should record a provider refusal as FAILED with the classified code', async () => {
    provider.answers.push({
      status: 200,
      body: { type: 'error', message: `Invalid mobile ${PHONE} for ${CODE}` },
    });

    await sender.attempt(attempt(() => REGISTERED));

    expect(provider.requests).toHaveLength(1);
    const rows = await deliveries();
    expect(rows.map((r) => [r.status, r.error_code, r.provider, r.provider_message_id])).toEqual([
      ['FAILED', 'SMS_INVALID_NUMBER', SMS_HTTP_PROVIDER, null],
    ]);
    await expectNoCodeStored();
  });

  it('should record a value that does not fit as FAILED without calling the provider', async () => {
    await sender.attempt(
      attempt(() => {
        throw new SmsVariableError(1);
      }),
    );

    expect(provider.requests).toEqual([]);
    const rows = await deliveries();
    expect(rows.map((r) => [r.status, r.error_code, r.provider])).toEqual([
      ['FAILED', 'SMS_VARIABLE_TOO_LONG', SMS_HTTP_PROVIDER],
    ]);
    await expectNoCodeStored();
  });

  describe('with a second provider configured (ROV-332)', () => {
    it('should send the same attempt through the second provider when the first is unreachable', async () => {
      provider.answers.push({ status: 503, body: { type: 'error', message: 'down' } });

      await failover.attempt(attempt(() => REGISTERED));

      expect(provider.requests).toHaveLength(1);
      const rows = await deliveries();
      expect(rows.map((r) => [r.status, r.error_code, r.provider])).toEqual([
        ['SENT', null, 'log'],
      ]);
      expect(rows[0]?.provider_message_id).toMatch(/^log-/);
      await expectNoCodeStored();
    });

    it('should not fail over a refusal of the message and store one FAILED row', async () => {
      provider.answers.push({
        status: 200,
        body: { type: 'error', message: `Invalid mobile ${PHONE}` },
      });

      await failover.attempt(attempt(() => REGISTERED));

      expect(provider.requests).toHaveLength(1);
      const rows = await deliveries();
      expect(rows.map((r) => [r.status, r.error_code, r.provider, r.provider_message_id])).toEqual([
        ['FAILED', 'SMS_INVALID_NUMBER', SMS_HTTP_PROVIDER, null],
      ]);
    });

    it('should send through the first provider alone when it takes the message', async () => {
      await failover.attempt(attempt(() => REGISTERED));

      expect(provider.requests).toHaveLength(1);
      expect(
        (await deliveries()).map((r) => [r.status, r.provider, r.provider_message_id]),
      ).toEqual([['SENT', SMS_HTTP_PROVIDER, provider.lastRequestId()]]);
    });
  });
});
