import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import type { MessagingSenderRepository } from '../../../repositories/messaging-sender.repository';
import type {
  MessagingTemplateRecord,
  MessagingTemplateRepository,
} from '../../../repositories/messaging-template.repository';
import type { MessagingSenderRecord } from '../../../repositories/types';
import { LOCALES } from '../../../types/notification-type';
import { ChannelAdapterError } from '../../adapters/channel-adapter';
import type { ProviderBreaker } from '../../rate/provider-breaker';
import { parseTemplateEvents } from '../template-events';
import { TemplateSendability } from '../template-sendability';
import {
  contentHashOf,
  publicPortalUrl,
  registeredTemplates,
  registrySubmissions,
  TemplatePortalUrlError,
} from '../template-submission';
import { TemplateSync, TemplateSyncPausedError } from '../template-sync';
import { placeholdersOf } from '../whatsapp-template';
import { templateStatusOf, type WhatsAppTemplateClient } from '../whatsapp-template.client';

const HASHES: Record<string, string> = JSON.parse(
  readFileSync(path.join(__dirname, '../whatsapp-template-hashes.json'), 'utf8'),
);
const PORTAL = 'https://app.roviq.example.com';
const PUBLIC_PORTAL = 'https://app.roviq.in';

describe('publicPortalUrl', () => {
  it.each([
    [undefined, 'it is not set'],
    ['not a url', 'it is not an address'],
    ['http://app.roviq.in', 'it is not https'],
    ['https://localhost:4200', 'not a public host'],
    ['https://app.localhost', 'not a public host'],
    ['https://192.168.1.100', 'not a public host'],
    ['https://app.lab.test', 'not a public host'],
    ['https://intranet', 'not a public host'],
    ['https://app.roviq.in/?x=1', 'a query or a fragment'],
  ])('should refuse %s before anything is submitted', (value, reason) => {
    expect(() => publicPortalUrl(value)).toThrow(TemplatePortalUrlError);
    expect(() => publicPortalUrl(value)).toThrow(reason);
  });

  it('should accept a public https address without its trailing slash', () => {
    expect(publicPortalUrl('https://app.roviq.in/')).toBe('https://app.roviq.in');
  });
});

describe('registry submissions', () => {
  const submissions = registrySubmissions(PUBLIC_PORTAL);

  it('should submit every template in both languages, each name once', () => {
    const names = registeredTemplates().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('delivery_canary_v2');
    expect(submissions).toHaveLength(names.length * LOCALES.length);
  });

  it('should give one example per variable and a button the provider accepts', () => {
    for (const s of submissions) {
      expect(s.bodyExamples, s.name).toHaveLength(placeholdersOf(s.body).length);
      expect(
        s.bodyExamples.every((v) => v.trim() !== ''),
        s.name,
      ).toBe(true);
      expect(s.buttonLabel.length, s.name).toBeLessThanOrEqual(25);
      expect(s.buttonLabel, s.name).not.toMatch(/\{\{/);
      expect(s.buttonUrl).toBe(`${PUBLIC_PORTAL}/{{1}}`);
      expect(s.buttonExample.startsWith(`${PUBLIC_PORTAL}/`), s.name).toBe(true);
    }
  });

  it('should hash only what the provider approves, not the portal address', () => {
    const elsewhere = registrySubmissions(PORTAL);
    expect(elsewhere.map((s) => s.contentHash)).toEqual(submissions.map((s) => s.contentHash));
    const base = { category: 'UTILITY' as const, body: 'Body {{1}} text.', buttonLabel: 'Open' };
    expect(contentHashOf(base)).toBe(contentHashOf({ ...base }));
    expect(contentHashOf({ ...base, body: 'Body {{1}} text!' })).not.toBe(contentHashOf(base));
    expect(contentHashOf({ ...base, category: 'MARKETING' })).not.toBe(contentHashOf(base));
    expect(contentHashOf({ ...base, buttonLabel: 'Go' })).not.toBe(contentHashOf(base));
  });

  // An approved template cannot be edited freely: a changed text needs a new name (`…_v2`).
  // Add the new name's hashes to whatsapp-template-hashes.json together with the new name.
  it('should keep every template name on the content it was approved with', () => {
    const current = Object.fromEntries(
      submissions.map((s) => [`${s.name}:${s.language}`, s.contentHash]),
    );
    const committed = HASHES;
    for (const [key, hash] of Object.entries(current)) {
      if (key in committed) expect(hash, `${key} changed: give it a new name`).toBe(committed[key]);
    }
    expect(Object.keys(current).filter((k) => !(k in committed))).toEqual([]);
  });
});

describe('templateStatusOf', () => {
  it.each([
    ['APPROVED', 'APPROVED'],
    ['IN_APPEAL', 'PENDING'],
    ['LIMIT_EXCEEDED', 'REJECTED'],
    ['PAUSED', 'PAUSED'],
    ['PENDING_DELETION', 'DISABLED'],
    ['SOMETHING_NEW', 'DISABLED'],
  ])('should map %s to %s', (raw, status) => {
    expect(templateStatusOf(raw)).toBe(status);
  });
});

describe('parseTemplateEvents', () => {
  const body = (field: string, value: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'acct-1', changes: [{ field, value }] }],
  });
  const ids = { message_template_name: 'attendance_absent_v1', message_template_language: 'hi' };

  it('should read a rejection with its reason, for the entry account', () => {
    expect(
      parseTemplateEvents(
        body('message_template_status_update', {
          ...ids,
          event: 'REJECTED',
          reason: 'INVALID_FORMAT',
        }),
      ),
    ).toEqual([
      {
        providerAccountId: 'acct-1',
        name: 'attendance_absent_v1',
        language: 'hi',
        field: 'message_template_status_update',
        change: { status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' },
      },
    ]);
  });

  it('should read a category change, a quality change, an edit and a suggested category', () => {
    const changes = [
      body('template_category_update', { ...ids, new_category: 'MARKETING' }),
      body('message_template_quality_update', { ...ids, new_quality_score: 'RED' }),
      body('message_template_components_update', { ...ids }),
      body('template_correct_category_detection', { ...ids, correct_category: 'MARKETING' }),
    ].flatMap(parseTemplateEvents);

    expect(changes.map((c) => c.change)).toEqual([
      { approvedCategory: 'MARKETING' },
      { quality: 'RED' },
      { outOfStep: true },
      { suggestedCategory: 'MARKETING' },
    ]);
  });

  it('should ignore delivery fields and anything it does not understand', () => {
    expect(parseTemplateEvents(body('messages', { ...ids }))).toEqual([]);
    expect(parseTemplateEvents(body('message_template_status_update', {}))).toEqual([]);
    expect(parseTemplateEvents('not json')).toEqual([]);
  });
});

const row = (over: Partial<MessagingTemplateRecord> = {}): MessagingTemplateRecord => ({
  providerAccountId: 'acct-1',
  name: 'attendance_absent_v1',
  language: 'en',
  declaredCategory: 'UTILITY',
  approvedCategory: 'UTILITY',
  contentHash: 'h',
  providerTemplateId: 't-1',
  status: 'APPROVED',
  rejectedReason: null,
  quality: null,
  suggestedCategory: null,
  outOfStep: false,
  ...over,
});

describe('TemplateSendability', () => {
  it.each([
    [row(), true],
    [row({ status: 'PENDING', approvedCategory: null }), false],
    [row({ status: 'REJECTED' }), false],
    [row({ approvedCategory: 'MARKETING' }), false],
    [null, false],
  ])('should send only an approved template under its declared category', async (r, sendable) => {
    const repo = createMock<MessagingTemplateRepository>({ find: vi.fn().mockResolvedValue(r) });

    const answer = await new TemplateSendability(repo).check('acct-1', 'n', 'en');

    expect(answer.sendable).toBe(sendable);
  });

  it('should keep an answer for a short time and drop it when an event arrives', async () => {
    let now = 0;
    const repo = createMock<MessagingTemplateRepository>({
      find: vi.fn().mockResolvedValue(row()),
    });
    const check = new TemplateSendability(repo, 30_000, () => now);

    await check.check('acct-1', 'n', 'en');
    await check.check('acct-1', 'n', 'en');
    expect(repo.find).toHaveBeenCalledTimes(1);
    check.forget('acct-1', 'n', 'en');
    await check.check('acct-1', 'n', 'en');
    now = 31_000;
    await check.check('acct-1', 'n', 'en');
    expect(repo.find).toHaveBeenCalledTimes(3);
  });
});

describe('TemplateSync', () => {
  const sender: MessagingSenderRecord = {
    id: 'sender-1',
    scope: 'platform',
    tenantId: null,
    status: 'ACTIVE',
    providerNumberId: 'number-1',
    providerAccountId: 'acct-1',
    dailyCap: 1000,
    instituteDailyCap: null,
    messagesPerSecond: 10,
    accessTokenEncrypted: Buffer.from('x'),
  };

  function setup(held: Awaited<ReturnType<WhatsAppTemplateClient['list']>> = []) {
    const senders = createMock<MessagingSenderRepository>({
      findForAccount: vi.fn().mockResolvedValue(sender),
    });
    const templates = createMock<MessagingTemplateRepository>({
      upsert: vi.fn().mockResolvedValue(undefined),
    });
    const client = createMock<WhatsAppTemplateClient>({
      list: vi.fn().mockResolvedValue(held),
      create: vi.fn().mockImplementation(async (_a, _t, s) => ({
        id: `id-${s.name}-${s.language}`,
        status: 'PENDING',
        category: s.category,
      })),
    });
    const breaker = createMock<ProviderBreaker>({
      allow: vi.fn().mockResolvedValue({ ok: true }),
      succeeded: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(false),
    });
    const sync = new TemplateSync(
      senders,
      templates,
      new TemplateSendability(templates),
      client,
      () => ({ providerNumberId: 'n', accessToken: 'token' }),
      breaker,
      PUBLIC_PORTAL,
    );
    return { sync, senders, templates, client, breaker };
  }

  it('should submit every template the provider lacks, once, and store each as pending', async () => {
    const { sync, client, templates } = setup();

    const result = await sync.sync('acct-1');

    const expected = registrySubmissions(PUBLIC_PORTAL).length;
    expect(result).toEqual({ created: expected, known: 0, refused: 0, noSender: false });
    expect(client.create).toHaveBeenCalledTimes(expected);
    const stored = templates.upsert.mock.calls[0]?.[0] ?? [];
    expect(stored).toHaveLength(expected);
    expect(stored.every((r) => r.status === 'PENDING' && r.approvedCategory === null)).toBe(true);
  });

  it('should submit nothing for templates the provider already holds, and record their state', async () => {
    const held = registrySubmissions(PUBLIC_PORTAL).map((s, i) => ({
      id: `t-${i}`,
      name: s.name,
      language: s.language,
      status: 'APPROVED' as const,
      category: i === 0 ? ('MARKETING' as const) : s.category,
      rejectedReason: null,
      quality: 'GREEN',
      body: i === 1 ? 'edited at the provider' : s.body,
      buttonLabel: s.buttonLabel,
    }));
    const { sync, client, templates } = setup(held);

    const result = await sync.sync('acct-1');

    expect(client.create).not.toHaveBeenCalled();
    expect(result.known).toBe(held.length);
    const stored = templates.upsert.mock.calls[0]?.[0] ?? [];
    expect(stored[0]?.approvedCategory).toBe('MARKETING');
    expect(stored[1]?.outOfStep).toBe(true);
    expect(stored.filter((r) => r.outOfStep)).toHaveLength(1);
  });

  it('should store a refused submission as rejected and go on with the rest', async () => {
    const { sync, client, templates } = setup();
    client.create.mockRejectedValueOnce(
      new ChannelAdapterError('WA_TEMPLATE_INVALID', 'provider code 100', false),
    );

    const result = await sync.sync('acct-1');

    expect(result.refused).toBe(1);
    const stored = templates.upsert.mock.calls[0]?.[0] ?? [];
    expect(stored[0]).toMatchObject({
      status: 'REJECTED',
      rejectedReason: 'WA_TEMPLATE_INVALID',
      providerTemplateId: null,
    });
  });

  it('should submit nothing when the portal address is not public', async () => {
    const { client } = setup();
    const sync = new TemplateSync(
      createMock<MessagingSenderRepository>(),
      createMock<MessagingTemplateRepository>(),
      new TemplateSendability(createMock<MessagingTemplateRepository>()),
      client,
      () => ({ providerNumberId: 'n', accessToken: 'token' }),
      createMock<ProviderBreaker>(),
      'http://localhost:4200',
    );

    await expect(sync.sync('acct-1')).rejects.toThrow(TemplatePortalUrlError);
    expect(client.list).not.toHaveBeenCalled();
  });

  it('should wait out an open breaker and do nothing for an account without a sender', async () => {
    const paused = setup();
    paused.breaker.allow.mockResolvedValue({ ok: false, retryAt: new Date(Date.now() + 60_000) });
    await expect(paused.sync.sync('acct-1')).rejects.toThrow(TemplateSyncPausedError);
    expect(paused.client.list).not.toHaveBeenCalled();

    const none = setup();
    none.senders.findForAccount.mockResolvedValue(null);
    await expect(none.sync.sync('acct-1')).resolves.toMatchObject({ noSender: true });
    expect(none.client.list).not.toHaveBeenCalled();
  });

  it('should count an unreachable provider against the breaker and keep what it learned', async () => {
    const { sync, client, breaker, templates } = setup();
    client.create
      .mockResolvedValueOnce({ id: 'x', status: 'PENDING', category: 'UTILITY' })
      .mockRejectedValueOnce(new ChannelAdapterError('WA_UNREACHABLE', 'down'));

    await expect(sync.sync('acct-1')).rejects.toThrow('down');

    expect(breaker.failed).toHaveBeenCalledWith('sender:sender-1');
    expect(templates.upsert.mock.calls[0]?.[0]).toHaveLength(1);
  });
});
