/**
 * ROV-319 against the real test database: sender choice, the opt-out, quiet-hours and cap
 * rules, and the provider's webhook. The provider is a local HTTP server that records every
 * request; the workflow's deferral loop is run by hand (there is no Temporal test server here).
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NotFoundException, type RawBodyRequest, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDrizzleDb,
  type DrizzleDB,
  messagingSenderSecrets,
  messagingSenders,
  mkAdminCtx,
  phoneNumbers,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { TemporalClientService } from '@roviq/temporal';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createMock,
  createTestInstitute,
  createTestTeacher,
  holdPlatformSenderLock,
  PLATFORM_SENDER_LOCK_WAIT_MS,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { ApplicationFailure } from '@temporalio/activity';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppWebhookController } from '../controllers/whatsapp-webhook.controller';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { WhatsAppCloudAdapter } from '../delivery/adapters/whatsapp-cloud.adapter';
import { ChannelSender } from '../delivery/channel-sender';
import { GuardianConsentGate } from '../delivery/consent-gate';
import { TemplateSendability } from '../delivery/whatsapp/template-sendability';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { WHATSAPP_CLOUD_PROVIDER } from '../delivery/whatsapp/whatsapp-cloud.client';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { ConsentReadDrizzleRepository } from '../repositories/consent-read.drizzle-repository';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { MessagingInboundDrizzleRepository } from '../repositories/messaging-inbound.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { MessagingTemplateDrizzleRepository } from '../repositories/messaging-template.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import type { Audience } from '../repositories/types';
import { FlowArrivals } from '../services/flow-arrivals.service';
import {
  AUTO_REPLY,
  START_CONFIRMATION,
  STOP_CONFIRMATION,
  WhatsAppWebhookService,
} from '../services/whatsapp-webhook.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import type { RegularPayload } from '../types/registry';
import { createNotificationActivities } from '../workflows/notification.activities';
import { noDeliveryLimits } from './delivery-limits';
import { approveRegistryTemplates, SPEC_PROVIDER_ACCOUNT } from './template-fixtures';

const CTX = 'test:whatsapp-delivery';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const APP_SECRET = 'spec-app-secret';
const VERIFY_TOKEN = 'spec-verify-token';
/** 12:00 in India: outside quiet hours. */
const NOON = new Date('2026-11-23T06:30:00.000Z');
/** 22:00 in India: inside quiet hours, which end at 01:30 UTC. */
const NIGHT = new Date('2026-11-23T16:30:00.000Z');
const NEXT_MORNING = new Date('2026-11-24T01:30:00.000Z');

class SetClock extends Clock {
  at = NOON;
  override now(): Date {
    return this.at;
  }
}

interface ProviderRequest {
  numberId: string;
  authorization: string | undefined;
  body: {
    to: string;
    type: string;
    template?: { name: string; language: { code: string }; components: unknown[] };
    text?: { body: string };
  };
}

/** Stands in for the provider's send endpoint. */
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
        this.requests.push({
          numberId: (req.url ?? '').split('/')[1] ?? '',
          authorization: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
        const answer = this.answers.shift() ?? {
          status: 200,
          body: { messages: [{ id: `wamid.${this.run}.${this.count}` }] },
        };
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  lastMessageId(): string {
    return `wamid.${this.run}.${this.count}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function randomPhone(): { countryCode: string; number: string; full: string } {
  const number = `9${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`;
  return { countryCode: '+91', number, full: `+91${number}` };
}

describe('WhatsApp delivery and webhook (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let releaseLock: (() => Promise<void>) | null = null;
  let instituteA: TestInstitute;
  let instituteB: TestInstitute;
  let userA: TestTeacher;
  let userB: TestTeacher;
  let cloud: WhatsAppCloud;
  let sender: ChannelSender;
  let controller: WhatsAppWebhookController;
  const provider = new FakeProvider();
  const clock = new SetClock();
  const temporal = createMock<TemporalClientService>({ signal: vi.fn().mockResolvedValue(true) });
  const phoneA = randomPhone();
  const phoneB = randomPhone();
  const senderIds: string[] = [];
  let numberSeq = 0;

  const audienceOf = (institute: TestInstitute): Audience => ({
    scope: 'institute',
    tenantId: institute.tenantId,
    resellerId: null,
  });

  const approval: RegularPayload = {
    type: 'APPROVAL_REQUESTED',
    params: {
      approvalType: 'leave',
      requesterName: 'Meera Nair',
      summary: 'Two days of leave',
      entityId: randomUUID(),
    },
  };
  const newDevice: RegularPayload = {
    type: 'AUTH_NEW_DEVICE',
    params: {
      ip: '203.0.113.9',
      at: '2026-11-23T06:00:00.000Z',
      accountPath: '/institute/account',
    },
  };

  /** One activity execution, as the workflow would run it. */
  function send(
    institute: TestInstitute,
    user: TestTeacher,
    message: RegularPayload = approval,
    deferrable = true,
    flowId: string | null = null,
  ) {
    return createNotificationActivities(
      {
        sender,
        recipients: new RecipientReadDrizzleRepository(db),
        writes: new NotificationWriteDrizzleRepository(db),
      },
      () => 1,
    ).sendChannel({
      audience: audienceOf(institute),
      recipientUserId: user.userId,
      channel: 'WHATSAPP',
      enabled: true,
      content: { kind: 'single', message, notificationId: null },
      data: {},
      deferrable,
      flowId,
      recipientsRef: null,
    });
  }

  interface SenderOptions {
    scope: 'institute' | 'platform';
    tenantId?: string;
    status?: 'ACTIVE' | 'PAUSED' | 'BLOCKED';
    dailyCap?: number;
    instituteDailyCap?: number | null;
    /** Register under a provider number an earlier sender of the spec used. */
    numberId?: string;
  }

  async function addSender(options: SenderOptions) {
    numberSeq += 1;
    const numberId = options.numberId ?? `spec-${provider.run}-${numberSeq}`;
    const token = `token-${randomBytes(8).toString('hex')}`;
    const id = await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [row] = await tx
        .insert(messagingSenders)
        .values({
          ...by,
          scope: options.scope,
          tenantId: options.tenantId ?? null,
          channel: 'WHATSAPP',
          provider: WHATSAPP_CLOUD_PROVIDER,
          providerNumberId: numberId,
          providerAccountId: SPEC_PROVIDER_ACCOUNT,
          displayNumber: '+910000000000',
          status: options.status ?? 'ACTIVE',
          dailyCap: options.dailyCap ?? 1000,
          instituteDailyCap: options.instituteDailyCap ?? null,
        })
        .returning({ id: messagingSenders.id });
      assert(row);
      await tx
        .insert(messagingSenderSecrets)
        .values({ ...by, senderId: row.id, accessTokenEncrypted: cloud.cipher.encrypt(token) });
      return row.id;
    });
    senderIds.push(id);
    return { id, numberId, token };
  }

  /** Removes every sender of this spec with what references it, so each test starts clean. */
  async function removeSenders(): Promise<void> {
    if (senderIds.length === 0) return;
    for (const table of [
      'notification_deliveries',
      'messaging_opt_outs',
      'messaging_inbound_events',
    ]) {
      await superPool.query(`DELETE FROM ${table} WHERE sender_id = ANY($1)`, [senderIds]);
    }
    await superPool.query('DELETE FROM messaging_senders WHERE id = ANY($1)', [senderIds]);
    senderIds.length = 0;
  }

  async function deliveries(userId: string) {
    const { rows } = await superPool.query<{
      status: string;
      skip_reason: string | null;
      error_code: string | null;
      provider: string | null;
      provider_message_id: string | null;
      sender_id: string | null;
      template_category: string | null;
      tenant_id: string | null;
    }>(
      `SELECT status, skip_reason, error_code, provider, provider_message_id, sender_id,
              template_category, tenant_id
         FROM notification_deliveries WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return rows;
  }

  async function count(table: string, senderId: string): Promise<number> {
    const { rows } = await superPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE sender_id = $1`,
      [senderId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Calls the controller as the provider would: the exact bytes and their signature. */
  function post(payload: unknown, secret = APP_SECRET) {
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    return controller.receive(createMock<RawBodyRequest<Request>>({ rawBody }), signature);
  }

  const envelope = (numberId: string, value: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'account',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '910000000000', phone_number_id: numberId },
              ...value,
            },
          },
        ],
      },
    ],
  });

  const report = (
    numberId: string,
    messageId: string,
    status: string,
    phone: string,
    extra: Record<string, unknown> = {},
  ) =>
    envelope(numberId, {
      statuses: [{ id: messageId, status, recipient_id: phone.replace('+', ''), ...extra }],
    });

  const inbound = (numberId: string, phone: string, text: string, id = `in.${randomUUID()}`) =>
    envelope(numberId, {
      contacts: [{ wa_id: phone.replace('+', ''), profile: { name: 'Sender Name' } }],
      messages: [{ id, from: phone.replace('+', ''), type: 'text', text: { body: text } }],
    });

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
    await approveRegistryTemplates(superPool);
    db = createDrizzleDb(pool);

    const leftover = await superPool.query(
      `SELECT id FROM messaging_senders WHERE scope = 'platform' AND deleted_at IS NULL`,
    );
    assert.equal(leftover.rowCount, 0, 'a live platform sender was left in the test database');

    instituteA = await createTestInstitute(db);
    instituteB = await createTestInstitute(db);
    userA = await createTestTeacher(db, instituteA.tenantId);
    userB = await createTestTeacher(db, instituteB.tenantId);
    await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx.insert(phoneNumbers).values([
        { ...by, userId: userA.userId, isPrimary: true, ...pick(phoneA) },
        { ...by, userId: userB.userId, isPrimary: true, ...pick(phoneB) },
      ]),
    );

    const baseUrl = await provider.start();
    cloud = new WhatsAppCloud(
      new ConfigService({
        NOTIFICATION_WHATSAPP_PROVIDER: 'cloud',
        WHATSAPP_API_BASE_URL: baseUrl,
        WHATSAPP_APP_SECRET: APP_SECRET,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
        MESSAGING_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      }),
    );
    const senders = new MessagingSenderDrizzleRepository(db);
    sender = new ChannelSender(
      new ChannelAdapters([new WhatsAppCloudAdapter(cloud)]),
      new GuardianConsentGate(new ConsentReadDrizzleRepository(db)),
      new ContactReadDrizzleRepository(db),
      new NotificationWriteDrizzleRepository(db),
      new WhatsAppRoute(
        senders,
        new RecipientReadDrizzleRepository(db),
        clock,
        new TemplateSendability(new MessagingTemplateDrizzleRepository(db)),
      ),
      new NotificationMetrics(),
      ...noDeliveryLimits(),
    );
    controller = new WhatsAppWebhookController(
      cloud,
      new WhatsAppWebhookService(
        senders,
        new MessagingInboundDrizzleRepository(db),
        cloud,
        clock,
        new FlowArrivals(temporal),
        new NotificationMetrics(),
      ),
    );
  }, PLATFORM_SENDER_LOCK_WAIT_MS);

  beforeEach(async () => {
    await removeSenders();
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)', [
      [userA.userId, userB.userId],
    ]);
    provider.requests.length = 0;
    provider.answers.length = 0;
    clock.at = NOON;
    temporal.signal.mockClear();
  });

  afterAll(async () => {
    try {
      if (db) {
        await removeSenders();
        await superPool.query(
          'DELETE FROM notification_deliveries WHERE recipient_user_id = ANY($1)',
          [[userA?.userId, userB?.userId].filter(Boolean)],
        );
        await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
          if (userA) await tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, userA.userId));
          if (userB) await tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, userB.userId));
        });
        if (userA) await cleanupTestTeacher(db, userA);
        if (userB) await cleanupTestTeacher(db, userB);
        if (instituteA) await cleanupTestInstitute(db, instituteA);
        if (instituteB) await cleanupTestInstitute(db, instituteB);
      }
      await provider.stop();
      await pool?.end();
      await superPool?.end();
    } finally {
      await releaseLock?.();
    }
  });

  describe('which sender a message goes through', () => {
    it("should use the institute's own active sender, with its token, and store it on the row", async () => {
      const own = await addSender({ scope: 'institute', tenantId: instituteA.tenantId });
      await addSender({ scope: 'platform' });

      await expect(send(instituteA, userA)).resolves.toBe('SENT');

      expect(provider.requests).toHaveLength(1);
      const [request] = provider.requests;
      assert(request);
      expect(request.numberId).toBe(own.numberId);
      expect(request.authorization).toBe(`Bearer ${own.token}`);
      expect(request.body).toMatchObject({
        to: phoneA.full.replace('+', ''),
        type: 'template',
        template: { name: 'approval_requested_v1', language: { code: 'en' } },
      });
      expect(await deliveries(userA.userId)).toEqual([
        {
          status: 'SENT',
          skip_reason: null,
          error_code: null,
          provider: WHATSAPP_CLOUD_PROVIDER,
          provider_message_id: provider.lastMessageId(),
          sender_id: own.id,
          template_category: 'UTILITY',
          tenant_id: instituteA.tenantId,
        },
      ]);
    });

    it("should use the platform's sender for an institute without one, or whose own is not active", async () => {
      const platform = await addSender({ scope: 'platform' });
      await addSender({ scope: 'institute', tenantId: instituteA.tenantId, status: 'PAUSED' });

      await expect(send(instituteA, userA)).resolves.toBe('SENT');
      await expect(send(instituteB, userB)).resolves.toBe('SENT');

      expect(provider.requests.map((r) => r.numberId)).toEqual([
        platform.numberId,
        platform.numberId,
      ]);
      expect((await deliveries(userB.userId)).map((d) => d.sender_id)).toEqual([platform.id]);
    });

    it("should never use another institute's sender: with no sender of its own and no platform sender it is skipped", async () => {
      await addSender({ scope: 'institute', tenantId: instituteB.tenantId });
      await addSender({ scope: 'platform', status: 'BLOCKED' });

      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');

      expect(provider.requests).toHaveLength(0);
      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'SKIPPED', skip_reason: 'no_provider', sender_id: null },
      ]);
    });

    it('should skip a type that has no approved template without calling the provider', async () => {
      await addSender({ scope: 'platform' });
      // The activity accepts any regular type; this one has no WhatsApp template.
      const signIn: RegularPayload = {
        type: 'AUTH_LOGIN',
        params: { ip: null, at: '2026-11-23T06:00:00.000Z', accountPath: '/institute/account' },
      };

      await expect(send(instituteA, userA, signIn)).resolves.toBe('SKIPPED');

      expect(provider.requests).toHaveLength(0);
      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'SKIPPED', skip_reason: 'no_template' },
      ]);
    });

    it('should record a refusal with a stable code and not retry one that would be refused again', async () => {
      const platform = await addSender({ scope: 'platform' });
      provider.answers.push({
        status: 404,
        body: { error: { code: 132001, message: `no template for ${phoneA.full}` } },
      });

      const failure = await send(instituteA, userA).catch((e: unknown) => e);

      assert(failure instanceof ApplicationFailure);
      expect(failure.nonRetryable).toBe(true);
      expect(failure.type).toBe('WA_TEMPLATE_REJECTED');
      expect(failure.message).not.toContain(phoneA.number);
      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'FAILED', error_code: 'WA_TEMPLATE_REJECTED', sender_id: platform.id },
      ]);
    });
  });

  describe("failover from an institute's own sender to the platform's (ROV-332)", () => {
    const blocked = { status: 400, body: { error: { code: 368, message: 'temporarily blocked' } } };

    it("should send the same attempt through the platform's sender when the institute's own is blocked", async () => {
      const own = await addSender({ scope: 'institute', tenantId: instituteA.tenantId });
      const platform = await addSender({ scope: 'platform' });
      provider.answers.push(blocked);

      await expect(send(instituteA, userA)).resolves.toBe('SENT');

      expect(provider.requests.map((r) => [r.numberId, r.authorization])).toEqual([
        [own.numberId, `Bearer ${own.token}`],
        [platform.numberId, `Bearer ${platform.token}`],
      ]);
      expect(await deliveries(userA.userId)).toEqual([
        {
          status: 'SENT',
          skip_reason: null,
          error_code: null,
          provider: WHATSAPP_CLOUD_PROVIDER,
          provider_message_id: provider.lastMessageId(),
          sender_id: platform.id,
          template_category: 'UTILITY',
          tenant_id: instituteA.tenantId,
        },
      ]);
    });

    it("should not send through the platform's sender to a person who opted out of it", async () => {
      const platform = await addSender({ scope: 'platform' });
      await post(inbound(platform.numberId, phoneA.full, 'STOP'));
      const own = await addSender({ scope: 'institute', tenantId: instituteA.tenantId });
      provider.requests.length = 0;
      provider.answers.push(blocked);

      const failure = await send(instituteA, userA).catch((e: unknown) => e);

      assert(failure instanceof ApplicationFailure);
      expect(failure.type).toBe('WA_SENDER_BLOCKED');
      expect(provider.requests.map((r) => r.numberId)).toEqual([own.numberId]);
      expect(await deliveries(userA.userId)).toEqual([
        {
          status: 'FAILED',
          skip_reason: null,
          error_code: 'WA_SENDER_BLOCKED',
          provider: WHATSAPP_CLOUD_PROVIDER,
          provider_message_id: null,
          sender_id: own.id,
          template_category: 'UTILITY',
          tenant_id: instituteA.tenantId,
        },
      ]);
    });

    it("should not fail over a refusal of the message to the platform's sender", async () => {
      const own = await addSender({ scope: 'institute', tenantId: instituteA.tenantId });
      await addSender({ scope: 'platform' });
      provider.answers.push({ status: 400, body: { error: { code: 131026, message: 'x' } } });

      await send(instituteA, userA).catch((e: unknown) => e);

      expect(provider.requests.map((r) => r.numberId)).toEqual([own.numberId]);
      expect((await deliveries(userA.userId)).map((d) => [d.error_code, d.sender_id])).toEqual([
        ['WA_NOT_ON_WHATSAPP', own.id],
      ]);
    });
  });

  describe('quiet hours', () => {
    it('should hold a non-critical message at night as one DEFERRED row, and send it once they end', async () => {
      await addSender({ scope: 'platform' });
      const flowId = `notification-flow:quiet-${provider.run}`;
      clock.at = NIGHT;

      await expect(send(instituteA, userA, approval, true, flowId)).resolves.toEqual({
        deferUntil: NEXT_MORNING.toISOString(),
        reason: 'quiet_hours',
      });
      // The workflow retries a deferral; a second one of the same flow adds no row.
      await expect(send(instituteA, userA, approval, true, flowId)).resolves.toEqual({
        deferUntil: NEXT_MORNING.toISOString(),
        reason: 'quiet_hours',
      });
      expect(provider.requests).toHaveLength(0);
      expect(
        (await deliveries(userA.userId)).map((d) => [d.status, d.skip_reason, d.provider]),
      ).toEqual([['DEFERRED', 'quiet_hours', null]]);

      clock.at = NEXT_MORNING;
      await expect(send(instituteA, userA, approval, true, flowId)).resolves.toBe('SENT');
      expect(provider.requests).toHaveLength(1);
      expect((await deliveries(userA.userId)).map((d) => d.status)).toEqual(['DEFERRED', 'SENT']);
    });

    it('should send a critical message at night', async () => {
      await addSender({ scope: 'platform' });
      clock.at = NIGHT;

      await expect(send(instituteA, userA, newDevice)).resolves.toBe('SENT');

      expect(provider.requests[0]?.body.template?.name).toBe('auth_new_device_v1');
    });
  });

  describe('daily cap', () => {
    it("should skip a non-critical message over the sender's cap, and make a critical one wait until there is room", async () => {
      await addSender({ scope: 'platform', dailyCap: 2 });
      await send(instituteA, userA);
      await send(instituteB, userB);

      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
      const waiting = await send(instituteA, userA, newDevice);

      expect(waiting).toEqual({
        deferUntil: new Date(NOON.getTime() + 3_600_000).toISOString(),
        reason: 'sender_cap',
      });
      expect(provider.requests).toHaveLength(2);
      expect((await deliveries(userA.userId)).map((d) => [d.status, d.skip_reason])).toEqual([
        ['SENT', null],
        ['SKIPPED', 'sender_cap'],
        ['DEFERRED', 'sender_cap'],
      ]);

      // On the workflow's last try the wait ends as a recorded skip, never as a silent loss.
      await expect(send(instituteA, userA, newDevice, false)).resolves.toBe('SKIPPED');
      expect((await deliveries(userA.userId)).at(-1)).toMatchObject({
        status: 'SKIPPED',
        skip_reason: 'sender_cap',
      });

      // The cap counts the last 24 hours of stored rows, which were written just now.
      clock.at = new Date(Date.now() + 25 * 3_600_000);
      await expect(send(instituteA, userA, newDevice)).resolves.toBe('SENT');
    });

    it("should stop one institute at its share of the platform's sender while another still sends", async () => {
      await addSender({ scope: 'platform', dailyCap: 100, instituteDailyCap: 1 });

      await expect(send(instituteA, userA)).resolves.toBe('SENT');
      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
      await expect(send(instituteB, userB)).resolves.toBe('SENT');

      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'SENT' },
        { status: 'SKIPPED', skip_reason: 'sender_cap' },
      ]);
    });

    it("should not apply the share to an institute's own sender", async () => {
      await addSender({ scope: 'institute', tenantId: instituteA.tenantId, dailyCap: 5 });

      await expect(send(instituteA, userA)).resolves.toBe('SENT');
      await expect(send(instituteA, userA)).resolves.toBe('SENT');
    });
  });

  describe('webhook: who may call it', () => {
    it('should refuse a body that the app secret did not sign, and write nothing', async () => {
      const platform = await addSender({ scope: 'platform' });
      await send(instituteA, userA);
      const body = report(platform.numberId, provider.lastMessageId(), 'delivered', phoneA.full);

      await expect(post(body, 'another-secret')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        controller.receive(
          createMock<RawBodyRequest<Request>>({ rawBody: Buffer.from(JSON.stringify(body)) }),
          undefined,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(await count('messaging_inbound_events', platform.id)).toBe(0);
      expect(await deliveries(userA.userId)).toHaveLength(1);
    });

    it('should answer the one-time address check only with the right token', () => {
      expect(controller.verify('subscribe', VERIFY_TOKEN, 'challenge-123')).toBe('challenge-123');
      expect(() => controller.verify('subscribe', 'wrong', 'challenge-123')).toThrow();
    });

    it('should not exist when the provider is not configured', async () => {
      const off = new WhatsAppWebhookController(
        new WhatsAppCloud(new ConfigService({ NOTIFICATION_WHATSAPP_PROVIDER: 'log' })),
        createMock<WhatsAppWebhookService>(),
      );
      await expect(
        off.receive(createMock<RawBodyRequest<Request>>({ rawBody: Buffer.from('{}') }), 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('webhook: delivery reports', () => {
    it('should append one DELIVERED and one READ row, once however often each is repeated', async () => {
      const platform = await addSender({ scope: 'platform' });
      await send(instituteA, userA);
      const messageId = provider.lastMessageId();
      const delivered = report(platform.numberId, messageId, 'delivered', phoneA.full);
      const read = report(platform.numberId, messageId, 'read', phoneA.full);

      await expect(post(delivered)).resolves.toBe('ok');
      await post(delivered);
      await post(read);
      await post(read);
      await post(report(platform.numberId, messageId, 'sent', phoneA.full));

      const copied = {
        provider_message_id: messageId,
        sender_id: platform.id,
        tenant_id: instituteA.tenantId,
        template_category: 'UTILITY',
      };
      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'SENT', provider_message_id: messageId },
        { status: 'DELIVERED', ...copied },
        { status: 'READ', ...copied },
      ]);
    });

    it('should copy the flow id and tell the flow once its WhatsApp is delivered (ROV-332)', async () => {
      const platform = await addSender({ scope: 'platform' });
      const flowId = `notification-flow:spec-${provider.run}`;
      await send(instituteA, userA, approval, true, flowId);
      const messageId = provider.lastMessageId();

      await post(report(platform.numberId, messageId, 'delivered', phoneA.full));
      await post(report(platform.numberId, messageId, 'delivered', phoneA.full));
      await post(report(platform.numberId, messageId, 'read', phoneA.full));

      const { rows } = await superPool.query<{ status: string; flow_id: string | null }>(
        `SELECT status, flow_id FROM notification_deliveries
          WHERE recipient_user_id = $1 ORDER BY created_at, id`,
        [userA.userId],
      );
      expect(rows).toEqual([
        { status: 'SENT', flow_id: flowId },
        { status: 'DELIVERED', flow_id: flowId },
        { status: 'READ', flow_id: flowId },
      ]);
      expect(temporal.signal.mock.calls).toEqual([
        [flowId, 'flowArrival', [{ recipientUserId: userA.userId, via: 'WHATSAPP' }]],
      ]);
    });

    it('should tell no flow about a report of a message sent outside a flow', async () => {
      const platform = await addSender({ scope: 'platform' });
      await send(instituteA, userA);

      await post(report(platform.numberId, provider.lastMessageId(), 'delivered', phoneA.full));

      expect((await deliveries(userA.userId)).map((d) => d.status)).toEqual(['SENT', 'DELIVERED']);
      expect(temporal.signal).not.toHaveBeenCalled();
    });

    it('should append DELIVERED then READ for a read report without a delivery report, and tell the flow once', async () => {
      const platform = await addSender({ scope: 'platform' });
      const flowId = `notification-flow:read-${provider.run}`;
      await send(instituteA, userA, approval, true, flowId);
      const read = report(platform.numberId, provider.lastMessageId(), 'read', phoneA.full);

      await post(read);
      await post(read);
      await post(report(platform.numberId, provider.lastMessageId(), 'delivered', phoneA.full));

      expect((await deliveries(userA.userId)).map((d) => d.status)).toEqual([
        'SENT',
        'DELIVERED',
        'READ',
      ]);
      expect(temporal.signal.mock.calls).toEqual([
        [flowId, 'flowArrival', [{ recipientUserId: userA.userId, via: 'WHATSAPP' }]],
      ]);
    });

    it('should append FAILED with a stable code for a failed report', async () => {
      const platform = await addSender({ scope: 'platform' });
      await send(instituteA, userA);

      await post(
        report(platform.numberId, provider.lastMessageId(), 'failed', phoneA.full, {
          errors: [{ code: 131026, title: 'Message undeliverable' }],
        }),
      );

      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'SENT' },
        { status: 'FAILED', error_code: 'WA_NOT_ON_WHATSAPP' },
      ]);
    });

    it("should write nothing for a report about one institute's message that arrives on another institute's number", async () => {
      const ownA = await addSender({ scope: 'institute', tenantId: instituteA.tenantId });
      const ownB = await addSender({ scope: 'institute', tenantId: instituteB.tenantId });
      await send(instituteA, userA);
      const messageId = provider.lastMessageId();

      await expect(
        post({
          ...report(ownB.numberId, messageId, 'delivered', phoneA.full),
          tenant_id: instituteA.tenantId,
        }),
      ).resolves.toBe('ok');

      expect(await deliveries(userA.userId)).toHaveLength(1);
      expect(await count('messaging_inbound_events', ownB.id)).toBe(0);
      expect(await count('notification_deliveries', ownB.id)).toBe(0);

      // The same report on the right number is still accepted afterwards.
      await post(report(ownA.numberId, messageId, 'delivered', phoneA.full));
      expect((await deliveries(userA.userId)).map((d) => d.status)).toEqual(['SENT', 'DELIVERED']);
    });

    it('should ignore events for a number that is no sender here', async () => {
      await expect(
        post(report('not-a-sender', 'wamid.unknown', 'delivered', phoneA.full)),
      ).resolves.toBe('ok');
      expect(provider.requests).toHaveLength(0);
    });
  });

  describe('webhook: inbound messages', () => {
    it('should record an opt-out for STOP, confirm once, and skip later messages to that person', async () => {
      const platform = await addSender({ scope: 'platform' });
      const stop = inbound(platform.numberId, phoneA.full, ' Stop! ');

      await post(stop);
      await post(stop);
      await post(inbound(platform.numberId, phoneA.full, 'बंद करें'));

      const optOuts = await superPool.query<{ recipient_phone: string; channel: string }>(
        'SELECT recipient_phone, channel FROM messaging_opt_outs WHERE sender_id = $1',
        [platform.id],
      );
      expect(optOuts.rows).toEqual([{ recipient_phone: phoneA.full, channel: 'WHATSAPP' }]);
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.body).toMatchObject({
        to: phoneA.full.replace('+', ''),
        type: 'text',
        text: { body: STOP_CONFIRMATION },
      });

      provider.requests.length = 0;
      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
      await expect(send(instituteA, userA, newDevice)).resolves.toBe('SKIPPED');
      await expect(send(instituteB, userB)).resolves.toBe('SENT');
      expect(provider.requests).toHaveLength(1);
      expect(await deliveries(userA.userId)).toMatchObject([
        { status: 'SKIPPED', skip_reason: 'opted_out' },
        { status: 'SKIPPED', skip_reason: 'opted_out' },
      ]);
    });

    it("should keep an opt-out to the sender it was sent to: the institute's own number still reaches the person", async () => {
      const platform = await addSender({ scope: 'platform' });
      await post(inbound(platform.numberId, phoneA.full, 'STOP'));
      await addSender({ scope: 'institute', tenantId: instituteA.tenantId });
      provider.requests.length = 0;

      await expect(send(instituteA, userA)).resolves.toBe('SENT');
    });

    it('should send again after START, confirm it once, and treat START from a person who never stopped as an ordinary message', async () => {
      const platform = await addSender({ scope: 'platform' });
      await post(inbound(platform.numberId, phoneA.full, 'STOP'));
      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
      provider.requests.length = 0;

      const start = inbound(platform.numberId, phoneA.full, ' start ');
      await post(start);
      await post(start);
      await post(inbound(platform.numberId, phoneA.full, 'शुरू करें'));

      // One confirmation however often the event repeats; a later START changes nothing and
      // gets the day's one fixed reply.
      expect(provider.requests.map((r) => r.body.text?.body)).toEqual([
        START_CONFIRMATION,
        AUTO_REPLY,
      ]);
      const rows = await superPool.query<{ action: string }>(
        'SELECT action FROM messaging_opt_outs WHERE sender_id = $1 ORDER BY created_at, id',
        [platform.id],
      );
      expect(rows.rows.map((r) => r.action)).toEqual(['STOP', 'START']);
      await expect(send(instituteA, userA)).resolves.toBe('SENT');

      // A person who never stopped: START is not a preference change.
      provider.requests.length = 0;
      await post(inbound(platform.numberId, phoneB.full, 'START'));
      expect(provider.requests.map((r) => r.body.text?.body)).toEqual([AUTO_REPLY]);
      expect(await count('messaging_opt_outs', platform.id)).toBe(2);

      // And STOP again after START stops again.
      await post(inbound(platform.numberId, phoneA.full, 'stop'));
      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
    });

    it('should tell the person in the stop confirmation that security alerts stop too and how to start again', () => {
      for (const part of ['security alerts', 'START', 'सुरक्षा', 'email']) {
        expect(STOP_CONFIRMATION).toContain(part);
      }
    });

    it('should keep an opt-out when the number is removed and registered again', async () => {
      const first = await addSender({ scope: 'platform' });
      await post(inbound(first.numberId, phoneA.full, 'STOP'));
      await superPool.query(
        'UPDATE messaging_senders SET deleted_at = now(), deleted_by = $2 WHERE id = $1',
        [first.id, SYSTEM_USER_ID],
      );
      const again = await addSender({ scope: 'platform', numberId: first.numberId });
      provider.requests.length = 0;

      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
      await post(inbound(again.numberId, phoneA.full, 'are you there?'));
      await post(inbound(again.numberId, phoneA.full, 'stop'));

      expect(provider.requests).toHaveLength(0);
      expect(await count('messaging_opt_outs', again.id)).toBe(0);
      expect((await deliveries(userA.userId)).at(-1)).toMatchObject({ skip_reason: 'opted_out' });
    });

    it('should send one fixed reply per person and day to anything else, and store no text', async () => {
      const platform = await addSender({ scope: 'platform' });
      const secret = `private words ${randomUUID()}`;

      await post(inbound(platform.numberId, phoneA.full, secret));
      await post(inbound(platform.numberId, phoneA.full, `again ${secret}`));
      await post(inbound(platform.numberId, phoneB.full, 'hello'));

      expect(provider.requests.map((r) => [r.body.to, r.body.text?.body])).toEqual([
        [phoneA.full.replace('+', ''), AUTO_REPLY],
        [phoneB.full.replace('+', ''), AUTO_REPLY],
      ]);

      clock.at = new Date(NOON.getTime() + 24 * 3_600_000);
      await post(inbound(platform.numberId, phoneA.full, 'next day'));
      expect(provider.requests).toHaveLength(3);

      const stored = await superPool.query<{ json: string }>(
        `SELECT row_to_json(e)::text AS json FROM messaging_inbound_events e WHERE sender_id = $1
         UNION ALL
         SELECT row_to_json(o)::text FROM messaging_opt_outs o WHERE sender_id = $1
         UNION ALL
         SELECT row_to_json(d)::text FROM notification_deliveries d WHERE sender_id = $1`,
        [platform.id],
      );
      expect(stored.rows).toHaveLength(4);
      const everything = stored.rows.map((r) => r.json).join('\n');
      for (const text of [secret, 'private words', 'hello', 'next day', 'Sender Name']) {
        expect(everything).not.toContain(text);
      }
    });

    it('should not reply to a person who opted out', async () => {
      const platform = await addSender({ scope: 'platform' });
      await post(inbound(platform.numberId, phoneA.full, 'stop'));
      provider.requests.length = 0;

      await post(inbound(platform.numberId, phoneA.full, 'why did it stop?'));

      expect(provider.requests).toHaveLength(0);
    });

    it('should honour a stop request that came without a phone as soon as a report ties the person to one', async () => {
      const platform = await addSender({ scope: 'platform' });
      await post(
        envelope(platform.numberId, {
          contacts: [{ user_id: 'provider-user-late' }],
          messages: [
            {
              id: 'in.stop-first',
              from_user_id: 'provider-user-late',
              type: 'text',
              text: { body: 'STOP' },
            },
          ],
        }),
      );
      const optOuts = await superPool.query(
        'SELECT recipient_phone, provider_user_id FROM messaging_opt_outs WHERE sender_id = $1',
        [platform.id],
      );
      expect(optOuts.rows).toEqual([
        { recipient_phone: null, provider_user_id: 'provider-user-late' },
      ]);

      // Nothing ties the person to a phone yet, so this one cannot be stopped.
      await expect(send(instituteA, userA)).resolves.toBe('SENT');
      await post(
        report(platform.numberId, provider.lastMessageId(), 'delivered', phoneA.full, {
          recipient_user_id: 'provider-user-late',
        }),
      );

      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
      await expect(send(instituteB, userB)).resolves.toBe('SENT');
      expect((await deliveries(userA.userId)).at(-1)).toMatchObject({ skip_reason: 'opted_out' });
    });

    it('should find the phone of a person who writes without one from an earlier delivery report', async () => {
      const platform = await addSender({ scope: 'platform' });
      await send(instituteA, userA);
      await post(
        report(platform.numberId, provider.lastMessageId(), 'delivered', phoneA.full, {
          recipient_user_id: 'provider-user-a',
        }),
      );
      provider.requests.length = 0;

      await post(
        envelope(platform.numberId, {
          contacts: [{ user_id: 'provider-user-a' }],
          messages: [
            {
              id: 'in.no-phone',
              from_user_id: 'provider-user-a',
              type: 'text',
              text: { body: 'STOP' },
            },
          ],
        }),
      );

      const optOuts = await superPool.query(
        'SELECT recipient_phone, provider_user_id FROM messaging_opt_outs WHERE sender_id = $1',
        [platform.id],
      );
      expect(optOuts.rows).toEqual([
        { recipient_phone: phoneA.full, provider_user_id: 'provider-user-a' },
      ]);
      await expect(send(instituteA, userA)).resolves.toBe('SKIPPED');
    });
  });
});

function pick(phone: { countryCode: string; number: string }) {
  return { countryCode: phone.countryCode, number: phone.number };
}
