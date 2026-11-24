/**
 * ROV-330 against the real test database and a real Redis: the per-sender rate, the provider's
 * throttle, the sender and provider breakers, and a blocked sender. The provider is a local HTTP
 * server that records when each request arrived; the workflow's deferral loop is run by hand.
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
  phoneNumbers,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { NOTIFICATION_REDIS_KEYS, senderBreakerName } from '@roviq/redis';
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
import { ApplicationFailure } from '@temporalio/activity';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChannelAdapter, ChannelAdapterError } from '../delivery/adapters/channel-adapter';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { WhatsAppCloudAdapter } from '../delivery/adapters/whatsapp-cloud.adapter';
import { ChannelSender } from '../delivery/channel-sender';
import { GuardianConsentGate } from '../delivery/consent-gate';
import { type BreakerOptions, ProviderBreaker } from '../delivery/rate/provider-breaker';
import { SenderRateLimiter, type SenderRateOptions } from '../delivery/rate/sender-rate-limiter';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { WHATSAPP_CLOUD_PROVIDER } from '../delivery/whatsapp/whatsapp-cloud.client';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { ConsentReadDrizzleRepository } from '../repositories/consent-read.drizzle-repository';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import type { RegularPayload } from '../types/registry';
import { createNotificationActivities } from '../workflows/notification.activities';
import type { SendChannelInput } from '../workflows/notification-workflow.types';
import { testRedis } from './delivery-limits';

const CTX = 'test:delivery-limits';
const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
/** 12:00 in India: outside quiet hours. */
const NOON = new Date('2026-11-23T06:30:00.000Z');
/**
 * A request leaves the service just after Redis grants it; on a local socket the two clocks
 * differ by a few milliseconds at most.
 */
const NETWORK_JITTER_MS = 25;

class NoonClock extends Clock {
  override now(): Date {
    return NOON;
  }
}

interface ProviderAnswer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** Stands in for the provider's send endpoint and records when each request arrived. */
class FakeProvider {
  readonly requests: Array<{ numberId: string; at: number }> = [];
  readonly answers: ProviderAnswer[] = [];
  private server: Server | null = null;
  private count = 0;

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      const at = Date.now();
      req.on('data', () => undefined);
      req.on('end', () => {
        this.count += 1;
        this.requests.push({ numberId: (req.url ?? '').split('/')[1] ?? '', at });
        const answer = this.answers.shift() ?? {
          status: 200,
          body: { messages: [{ id: `wamid.limits.${this.count}` }] },
        };
        res.writeHead(answer.status, {
          'content-type': 'application/json',
          ...(answer.headers ?? {}),
        });
        res.end(JSON.stringify(answer.body));
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** An email provider that records each call and fails while `down` is set. */
class StubEmail implements ChannelAdapter {
  readonly channel = 'EMAIL';
  calls = 0;
  down = false;

  constructor(readonly provider: string) {}

  async send() {
    this.calls += 1;
    if (this.down) throw new ChannelAdapterError('ECONNECTION', 'connection refused');
    return { providerMessageId: `${this.provider}-${this.calls}` };
  }
}

const sleepUntil = (at: Date) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, at.getTime() - Date.now())));

/** True when no `limit + 1` requests arrived within one second. */
function withinRate(arrivals: readonly number[], limit: number): boolean {
  const sorted = [...arrivals].sort((a, b) => a - b);
  return sorted.every((at, i) => {
    const later = sorted[i + limit];
    return later === undefined || later - at >= 1000 - NETWORK_JITTER_MS;
  });
}

describe('sender rate and breakers (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let redis: Redis;
  let releaseLock: (() => Promise<void>) | null = null;
  let instituteA: TestInstitute;
  let userA: TestTeacher;
  let cloud: WhatsAppCloud;
  let senders: MessagingSenderDrizzleRepository;
  const provider = new FakeProvider();
  const senderIds: string[] = [];
  const redisKeys: string[] = [];
  const phone = `+919${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`;

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

  function senderWith(
    adapters: readonly ChannelAdapter[],
    rate: Partial<SenderRateOptions> = {},
    breaker: Partial<BreakerOptions> = {},
    connection: Redis = redis,
    metrics = new NotificationMetrics(),
  ): ChannelSender {
    return new ChannelSender(
      new ChannelAdapters(adapters),
      new GuardianConsentGate(new ConsentReadDrizzleRepository(db)),
      new ContactReadDrizzleRepository(db),
      new NotificationWriteDrizzleRepository(db),
      new WhatsAppRoute(senders, new RecipientReadDrizzleRepository(db), new NoonClock()),
      metrics,
      new SenderRateLimiter(connection, { recipientGapMs: 0, ...rate }),
      new ProviderBreaker(connection, breaker),
    );
  }

  const whatsappSender = (
    rate: Partial<SenderRateOptions> = {},
    breaker: Partial<BreakerOptions> = {},
    connection: Redis = redis,
    metrics = new NotificationMetrics(),
  ) => senderWith([new WhatsAppCloudAdapter(cloud)], rate, breaker, connection, metrics);

  /** One activity execution, as the workflow would run it. */
  function send(
    sender: ChannelSender,
    content: SendChannelInput['content'],
    flowId: string,
    deferrable = true,
  ) {
    return createNotificationActivities(
      {
        sender,
        recipients: new RecipientReadDrizzleRepository(db),
        writes: new NotificationWriteDrizzleRepository(db),
      },
      () => 1,
    ).sendChannel({
      audience: { scope: 'institute', tenantId: instituteA.tenantId, resellerId: null },
      recipientUserId: userA.userId,
      channel: 'WHATSAPP',
      enabled: true,
      content,
      data: {},
      deferrable,
      flowId,
      recipientsRef: null,
    });
  }

  const single = (message: RegularPayload = approval): SendChannelInput['content'] => ({
    kind: 'single',
    message,
    notificationId: null,
  });
  const absence = {
    studentId: randomUUID(),
    studentName: 'Aarav Sharma',
    markedAt: '09:05',
    sessionDate: '2026-11-23',
    sectionName: 'A',
    standardName: 'Class 5',
  };
  const digest = (): SendChannelInput['content'] => ({
    kind: 'digest',
    digest: {
      type: 'ATTENDANCE_ABSENT',
      items: [
        { ...absence, sessionId: 's1', status: 'ABSENT' },
        { ...absence, sessionId: 's2', status: 'LATE', markedAt: '09:40' },
      ],
    },
  });

  /** The workflow's loop: sleep through each deferral and try again. */
  async function sendUntilDone(
    sender: ChannelSender,
    content: SendChannelInput['content'] = single(),
  ) {
    const flowId = `spec-flow:${randomUUID()}`;
    for (;;) {
      const result = await send(sender, content, flowId);
      if (typeof result === 'string') return result;
      await sleepUntil(new Date(result.deferUntil));
    }
  }

  async function addSender(
    scope: 'institute' | 'platform',
    messagesPerSecond: number,
  ): Promise<{ id: string; numberId: string }> {
    const numberId = `limits-${randomUUID().slice(0, 12)}`;
    const id = await withAdmin(db, mkAdminCtx(CTX), async (tx) => {
      const [row] = await tx
        .insert(messagingSenders)
        .values({
          ...by,
          scope,
          tenantId: scope === 'institute' ? instituteA.tenantId : null,
          channel: 'WHATSAPP',
          provider: WHATSAPP_CLOUD_PROVIDER,
          providerNumberId: numberId,
          displayNumber: '+910000000000',
          status: 'ACTIVE',
          dailyCap: 10_000,
          messagesPerSecond,
        })
        .returning({ id: messagingSenders.id });
      assert(row);
      await tx.insert(messagingSenderSecrets).values({
        ...by,
        senderId: row.id,
        accessTokenEncrypted: cloud.cipher.encrypt(`token-${randomBytes(8).toString('hex')}`),
      });
      return row.id;
    });
    senderIds.push(id);
    redisKeys.push(
      `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${id}`,
      `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_RATE}${id}:queue`,
      `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_SENDER_THROTTLE}${id}`,
      `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}${senderBreakerName(id)}`,
    );
    return { id, numberId };
  }

  async function removeSenders(): Promise<void> {
    if (senderIds.length === 0) return;
    await superPool.query('DELETE FROM notification_deliveries WHERE sender_id = ANY($1)', [
      senderIds,
    ]);
    await superPool.query('DELETE FROM messaging_senders WHERE id = ANY($1)', [senderIds]);
    senderIds.length = 0;
  }

  async function deliveries() {
    const { rows } = await superPool.query<{
      status: string;
      skip_reason: string | null;
      error_code: string | null;
      provider: string | null;
      sender_id: string | null;
    }>(
      `SELECT status, skip_reason, error_code, provider, sender_id
         FROM notification_deliveries WHERE recipient_user_id = $1 ORDER BY created_at, id`,
      [userA.userId],
    );
    return rows;
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
    redis = testRedis();
    senders = new MessagingSenderDrizzleRepository(db);

    instituteA = await createTestInstitute(db);
    userA = await createTestTeacher(db, instituteA.tenantId);
    await withAdmin(db, mkAdminCtx(CTX), (tx) =>
      tx.insert(phoneNumbers).values({
        ...by,
        userId: userA.userId,
        isPrimary: true,
        countryCode: '+91',
        number: phone.slice(3),
      }),
    );

    cloud = new WhatsAppCloud(
      new ConfigService({
        NOTIFICATION_WHATSAPP_PROVIDER: 'cloud',
        WHATSAPP_API_BASE_URL: await provider.start(),
        WHATSAPP_APP_SECRET: 'spec-app-secret',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'spec-verify-token',
        MESSAGING_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      }),
    );
  }, PLATFORM_SENDER_LOCK_WAIT_MS);

  beforeEach(async () => {
    await removeSenders();
    await superPool.query('DELETE FROM notification_deliveries WHERE recipient_user_id = $1', [
      userA.userId,
    ]);
    provider.requests.length = 0;
    provider.answers.length = 0;
  });

  afterAll(async () => {
    try {
      if (db) {
        await removeSenders();
        if (userA) {
          await superPool.query(
            'DELETE FROM notification_deliveries WHERE recipient_user_id = $1',
            [userA.userId],
          );
          await withAdmin(db, mkAdminCtx(CTX), (tx) =>
            tx.delete(phoneNumbers).where(eq(phoneNumbers.userId, userA.userId)),
          );
          await cleanupTestTeacher(db, userA);
        }
        if (instituteA) await cleanupTestInstitute(db, instituteA);
      }
      if (redis) {
        if (redisKeys.length > 0) await redis.del(...redisKeys);
        await redis.quit();
      }
      await provider.stop();
      await pool?.end();
      await superPool?.end();
    } finally {
      await releaseLock?.();
    }
  });

  describe('the per-sender rate', () => {
    it('should hand the provider at most 2 in any second at 2 per second, and deliver all 10', async () => {
      await addSender('platform', 2);
      const sender = whatsappSender();

      const results = await Promise.all(Array.from({ length: 10 }, () => sendUntilDone(sender)));

      expect(results).toEqual(Array.from({ length: 10 }, () => 'SENT'));
      expect(provider.requests).toHaveLength(10);
      expect(
        withinRate(
          provider.requests.map((r) => r.at),
          2,
        ),
      ).toBe(true);
      const rows = await deliveries();
      expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(10);
      expect(rows.filter((r) => r.status === 'FAILED')).toEqual([]);
      expect(
        new Set(rows.filter((r) => r.status === 'DEFERRED').map((r) => r.skip_reason)),
      ).toEqual(new Set(['rate_limited']));
    });

    it('should keep two service instances together under the limit', async () => {
      await addSender('platform', 2);
      const second = testRedis();
      try {
        const one = whatsappSender();
        const two = whatsappSender({}, {}, second);

        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => sendUntilDone(i % 2 === 0 ? one : two)),
        );

        expect(results).toEqual(Array.from({ length: 8 }, () => 'SENT'));
        expect(provider.requests).toHaveLength(8);
        expect(
          withinRate(
            provider.requests.map((r) => r.at),
            2,
          ),
        ).toBe(true);
      } finally {
        await second.quit();
      }
    });

    it('should send a critical message while a digest run of the same sender waits', async () => {
      await addSender('platform', 5);
      const sender = whatsappSender();
      let digestsDone = 0;

      const digests = Array.from({ length: 8 }, () =>
        sendUntilDone(sender, digest()).then((r) => {
          digestsDone += 1;
          return r;
        }),
      );
      await vi.waitFor(() => expect(provider.requests.length).toBeGreaterThanOrEqual(3));
      const critical = await send(sender, single(newDevice), `spec-flow:${randomUUID()}`);
      const waitingWhenCriticalWent = 8 - digestsDone;

      expect(critical).toBe('SENT');
      expect(waitingWhenCriticalWent).toBeGreaterThan(0);
      expect(await Promise.all(digests)).toEqual(Array.from({ length: 8 }, () => 'SENT'));
    });
  });

  describe("the provider's throttle", () => {
    it('should wait out Retry-After as a rate_limited deferral, with no FAILED row', async () => {
      const platform = await addSender('platform', 10);
      const sender = whatsappSender();
      const flowId = `spec-flow:${randomUUID()}`;
      provider.answers.push({
        status: 429,
        body: { error: { code: 130429, message: 'too many' } },
        headers: { 'retry-after': '2' },
      });

      const before = Date.now();
      const first = await send(sender, single(), flowId);
      assert(typeof first === 'object');
      const waited = Date.parse(first.deferUntil) - before;
      const again = await send(sender, single(), flowId);

      expect(first.reason).toBe('rate_limited');
      expect(waited).toBeGreaterThanOrEqual(1_900);
      expect(waited).toBeLessThan(3_000);
      expect(again).toEqual({ deferUntil: first.deferUntil, reason: 'rate_limited' });
      expect(provider.requests).toHaveLength(1);
      expect(await deliveries()).toEqual([
        {
          status: 'DEFERRED',
          skip_reason: 'rate_limited',
          error_code: null,
          provider: null,
          sender_id: null,
        },
      ]);

      await sleepUntil(new Date(first.deferUntil));
      await expect(send(sender, single(), flowId)).resolves.toBe('SENT');
      expect((await deliveries()).map((d) => [d.status, d.sender_id])).toEqual([
        ['DEFERRED', null],
        ['SENT', platform.id],
      ]);
    });
  });

  describe('the sender breaker', () => {
    it('should open after unreachable answers, send nothing while open, and close on a probe', async () => {
      await addSender('platform', 10);
      const metrics = new NotificationMetrics();
      const opened = vi.spyOn(metrics, 'breakerOpened');
      const sender = whatsappSender({}, { failures: 3, cooldownMs: 1_000 }, redis, metrics);
      const unreachable = { status: 503, body: { error: { message: 'unavailable' } } };
      provider.answers.push(unreachable, unreachable, unreachable);
      const flows = Array.from({ length: 4 }, () => `spec-flow:${randomUUID()}`);

      const failures = [];
      for (const flowId of flows.slice(0, 3)) {
        failures.push(await send(sender, single(), flowId).catch((e: unknown) => e));
      }
      const held = await send(sender, single(), flows[3] ?? '');

      expect(failures.every((f) => f instanceof ApplicationFailure)).toBe(true);
      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened).toHaveBeenCalledWith('WHATSAPP', WHATSAPP_CLOUD_PROVIDER, 'WA_UNREACHABLE');
      assert(typeof held === 'object');
      expect(held.reason).toBe('provider_paused');
      expect(provider.requests).toHaveLength(3);

      // The workflow retries each one after the cool-down: the first is the probe.
      await sleepUntil(new Date(held.deferUntil));
      const retried = [];
      for (const flowId of flows) retried.push(await send(sender, single(), flowId));

      expect(retried).toEqual(['SENT', 'SENT', 'SENT', 'SENT']);
      expect(provider.requests).toHaveLength(7);
      expect((await deliveries()).filter((d) => d.status === 'SENT')).toHaveLength(4);
    });

    it("should block an institute's own sender the provider blocked and use the platform's next", async () => {
      const own = await addSender('institute', 10);
      const platform = await addSender('platform', 10);
      const sender = whatsappSender();
      provider.answers.push({ status: 400, body: { error: { code: 368, message: 'blocked' } } });

      await expect(sendUntilDone(sender)).resolves.toBe('SENT');
      await expect(sendUntilDone(sender)).resolves.toBe('SENT');

      expect(provider.requests.map((r) => r.numberId)).toEqual([
        own.numberId,
        platform.numberId,
        platform.numberId,
      ]);
      const { rows } = await superPool.query<{ status: string; updated_by: string }>(
        'SELECT status, updated_by FROM messaging_senders WHERE id = $1',
        [own.id],
      );
      expect(rows).toEqual([{ status: 'BLOCKED', updated_by: SYSTEM_USER_ID }]);
      expect(
        await redis.hget(
          `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}${senderBreakerName(own.id)}`,
          'state',
        ),
      ).toBe('open');
      expect((await deliveries()).map((d) => [d.status, d.error_code, d.sender_id])).toEqual([
        ['SENT', null, platform.id],
        ['SENT', null, platform.id],
      ]);
    });
  });

  describe('a provider breaker on a channel without senders', () => {
    it('should open on the email provider and let the next provider take the attempt', async () => {
      const run = randomUUID().slice(0, 8);
      const first = new StubEmail(`smtp-${run}`);
      const second = new StubEmail(`backup-${run}`);
      first.down = true;
      redisKeys.push(
        `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}adapter:EMAIL:${first.provider}`,
        `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}adapter:EMAIL:${second.provider}`,
      );
      const sender = senderWith([first, second], {}, { failures: 3 });
      const email = () =>
        sender.attempt({
          type: 'APPROVAL_REQUESTED',
          channel: 'EMAIL',
          audience: { scope: 'institute', tenantId: instituteA.tenantId, resellerId: null },
          recipientUserId: userA.userId,
          notificationId: null,
          flowId: null,
          channelEnabled: true,
          critical: false,
          digest: false,
          deferrable: true,
          attempt: 1,
          address: { given: 'staff@example.in' },
          data: {},
          compose: () => ({ subject: 'Approval', body: 'A leave request waits.' }),
        });

      const outcomes = [];
      for (let i = 0; i < 5; i += 1) outcomes.push(await email());

      expect(outcomes.map((o) => (o.status === 'SENT' ? o.provider : o.status))).toEqual(
        Array.from({ length: 5 }, () => second.provider),
      );
      // Three failures opened the first provider's breaker; the last two never reached it.
      expect(first.calls).toBe(3);
      expect(second.calls).toBe(5);
    });
  });
});
