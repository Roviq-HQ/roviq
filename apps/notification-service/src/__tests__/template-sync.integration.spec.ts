/**
 * ROV-333 against the real test database and Redis: the template sync with a local stand-in for
 * the provider's template endpoints, the provider's status events, and what a send may use.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDrizzleDb, type DrizzleDB } from '@roviq/database';
import { NOTIFICATION_REDIS_KEYS, senderBreakerName } from '@roviq/redis';
import {
  cleanupTestInstitute,
  createTestInstitute,
  type TestInstitute,
} from '@roviq/testing/integration';
import type Redis from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderBreaker } from '../delivery/rate/provider-breaker';
import { parseTemplateEvents } from '../delivery/whatsapp/template-events';
import { TemplateSendability } from '../delivery/whatsapp/template-sendability';
import { registrySubmissions } from '../delivery/whatsapp/template-submission';
import { TemplateSync } from '../delivery/whatsapp/template-sync';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { WhatsAppTemplateClient } from '../delivery/whatsapp/whatsapp-template.client';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { MessagingTemplateDrizzleRepository } from '../repositories/messaging-template.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { testRedis } from './delivery-limits';

const PORTAL = 'https://app.roviq.in';
const SYSTEM = '00000000-0000-0000-0000-000000000000';

interface Held {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: unknown[];
}

/** Stands in for the provider's template endpoints of any account. */
class FakeTemplateProvider {
  readonly held = new Map<string, Held[]>();
  readonly created: string[] = [];
  private server: Server | null = null;

  async start(): Promise<string> {
    const server = createServer((req, res) => {
      const [, account = ''] = (req.url ?? '').split('?')[0]?.split('/') ?? [];
      const list = this.held.get(account) ?? [];
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') {
          res.end(JSON.stringify({ data: list }));
          return;
        }
        const body = JSON.parse(raw) as {
          name: string;
          language: string;
          category: string;
          components: unknown[];
        };
        const id = `tpl-${randomUUID()}`;
        list.push({ id, ...body, status: 'PENDING' });
        this.held.set(account, list);
        this.created.push(`${body.name}:${body.language}`);
        res.end(JSON.stringify({ id, status: 'PENDING', category: body.category }));
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('WhatsApp template sync (integration)', () => {
  let pool: pg.Pool;
  let superPool: pg.Pool;
  let db: DrizzleDB;
  let redis: Redis;
  let institute: TestInstitute;
  let senderId: string;
  let account: string;
  const accounts: string[] = [];
  const provider = new FakeTemplateProvider();
  let sync: TemplateSync;
  let templates: MessagingTemplateDrizzleRepository;
  let sendability: TemplateSendability;

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
    redis = testRedis();
    institute = await createTestInstitute(db);
    templates = new MessagingTemplateDrizzleRepository(db);
    sendability = new TemplateSendability(templates, 0);
    const baseUrl = await provider.start();
    sync = new TemplateSync(
      new MessagingSenderDrizzleRepository(db),
      templates,
      sendability,
      new WhatsAppTemplateClient(baseUrl),
      () => ({ providerNumberId: 'n', accessToken: 'spec-token' }),
      new ProviderBreaker(redis),
      PORTAL,
    );
  });

  beforeEach(async () => {
    account = `9${Date.now()}${Math.floor(Math.random() * 1000)}`;
    accounts.push(account);
    provider.created.length = 0;
    // One live sender per institute and channel: each test starts with its own.
    await superPool.query('DELETE FROM messaging_senders WHERE tenant_id = $1', [
      institute.tenantId,
    ]);
    const { rows } = await superPool.query<{ id: string }>(
      `INSERT INTO messaging_senders
         (scope, tenant_id, channel, provider, provider_number_id, provider_account_id,
          display_number, daily_cap, created_by, updated_by)
       VALUES ('institute', $1, 'WHATSAPP', 'whatsapp_cloud', $2, $3, '+910000000000', 100, $4, $4)
       RETURNING id`,
      [institute.tenantId, `sync-${randomUUID().slice(0, 12)}`, account, SYSTEM],
    );
    const [row] = rows;
    assert(row);
    senderId = row.id;
    await superPool.query(
      `INSERT INTO messaging_sender_secrets (sender_id, access_token_encrypted, created_by, updated_by)
       VALUES ($1, '\\x00', $2, $2)`,
      [senderId, SYSTEM],
    );
  });

  afterAll(async () => {
    await superPool.query('DELETE FROM messaging_templates WHERE provider_account_id = ANY($1)', [
      accounts,
    ]);
    await superPool.query('DELETE FROM messaging_senders WHERE tenant_id = $1', [
      institute.tenantId,
    ]);
    await cleanupTestInstitute(db, institute);
    await redis.del(
      `${NOTIFICATION_REDIS_KEYS.NOTIFICATION_BREAKER}${senderBreakerName(senderId)}`,
    );
    await redis.quit();
    await provider.stop();
    await pool.end();
    await superPool.end();
  });

  const statuses = async () =>
    (await templates.listForAccount(account))
      .map((r) => `${r.name}:${r.language}:${r.status}`)
      .sort();

  it('should create every registry template in en and hi once, and nothing on a second sync', async () => {
    const all = registrySubmissions(PORTAL)
      .map((s) => `${s.name}:${s.language}`)
      .sort();

    const first = await sync.sync(account);
    const second = await sync.sync(account);

    expect(first.created).toBe(all.length);
    expect([...provider.created].sort()).toEqual(all);
    expect(second).toMatchObject({ created: 0, known: all.length });
    expect(await statuses()).toEqual(all.map((k) => `${k}:PENDING`));
  });

  it('should register a new name and leave the rows of the others as they were', async () => {
    const [missing, ...rest] = registrySubmissions(PORTAL);
    assert(missing);
    provider.held.set(
      account,
      rest.map((s, i) => ({
        id: `held-${i}`,
        name: s.name,
        language: s.language,
        status: 'APPROVED',
        category: s.category,
        components: [{ type: 'BODY', text: s.body }],
      })),
    );

    const result = await sync.sync(account);

    expect(provider.created).toEqual([`${missing.name}:${missing.language}`]);
    expect(result).toMatchObject({ created: 1, known: rest.length });
    const rows = await templates.listForAccount(account);
    const old = rows.find((r) => r.name === rest[0]?.name && r.language === rest[0]?.language);
    expect(old).toMatchObject({
      providerTemplateId: 'held-0',
      status: 'APPROVED',
      outOfStep: false,
    });
  });

  it('should make a template sendable on approval and stop it on rejection, before any send', async () => {
    await sync.sync(account);
    const name = 'attendance_absent_v1';
    const event = (value: Record<string, unknown>) => ({
      entry: [
        {
          id: account,
          changes: [
            {
              field: 'message_template_status_update',
              value: { message_template_name: name, message_template_language: 'en', ...value },
            },
          ],
        },
      ],
    });
    const route = new WhatsAppRoute(
      new MessagingSenderDrizzleRepository(db),
      new RecipientReadDrizzleRepository(db),
      new Clock(),
      sendability,
    );
    const sender = await new MessagingSenderDrizzleRepository(db).findForAccount(account);
    assert(sender);
    const send = {
      name,
      languageCode: 'en' as const,
      category: 'UTILITY' as const,
      bodyVariables: [],
      buttonPath: 'x',
    };
    const apply = async (body: unknown) => {
      for (const e of parseTemplateEvents(body)) {
        await templates.applyEvent(e.providerAccountId, e.name, e.language, e.change);
      }
    };

    expect(await route.approvedTemplate(sender, send)).toBeNull();
    await apply(event({ event: 'APPROVED' }));
    expect(await route.approvedTemplate(sender, send)).toEqual(send);
    await apply(event({ event: 'REJECTED', reason: 'INVALID_FORMAT' }));
    expect(await route.approvedTemplate(sender, send)).toBeNull();
    const [row] = (await templates.listForAccount(account)).filter(
      (r) => r.name === name && r.language === 'en',
    );
    expect(row).toMatchObject({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' });
  });

  it('should not send a template the provider approved under another category', async () => {
    await sync.sync(account);
    const name = 'fee_reminder_v1';
    for (const [field, value] of [
      ['message_template_status_update', { event: 'APPROVED' }],
      ['template_category_update', { new_category: 'MARKETING' }],
    ] as const) {
      for (const e of parseTemplateEvents({
        entry: [
          {
            id: account,
            changes: [
              {
                field,
                value: { message_template_name: name, message_template_language: 'hi', ...value },
              },
            ],
          },
        ],
      })) {
        await templates.applyEvent(e.providerAccountId, e.name, e.language, e.change);
      }
    }

    expect(await sendability.check(account, name, 'hi')).toEqual({ sendable: false });
    expect(
      (await templates.countProblems()).find((p) => p.problem === 'CATEGORY_CHANGED')?.count,
    ).toBeGreaterThan(0);
  });

  it('should change nothing for an event about a template it never registered', async () => {
    const applied = await templates.applyEvent(
      account,
      'sample_template_from_the_dashboard',
      'en',
      {
        status: 'APPROVED',
      },
    );

    expect(applied).toBe(false);
  });
});
