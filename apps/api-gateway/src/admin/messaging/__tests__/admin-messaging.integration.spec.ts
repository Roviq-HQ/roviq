import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { AuditEmitter } from '@roviq/audit';
import { MessagingTokenCipher } from '@roviq/crypto';
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
  holdPlatformSenderLock,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const SUPERUSER_URL =
  process.env.DATABASE_URL_TEST_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5434/roviq_test';

const SENDER_FIELDS =
  'id scope tenantId providerNumberId displayNumber status dailyCap instituteDailyCap createdAt updatedAt';

const LIST = `query { adminMessagingSenders { ${SENDER_FIELDS} } }`;
const REGISTER = `mutation ($input: RegisterMessagingSenderInput!) {
  adminRegisterMessagingSender(input: $input) { ${SENDER_FIELDS} } }`;
const UPDATE = `mutation ($id: ID!, $input: UpdateMessagingSenderInput!) {
  adminUpdateMessagingSender(id: $id, input: $input) { ${SENDER_FIELDS} } }`;
const ROTATE = `mutation ($id: ID!, $accessToken: String!) {
  adminRotateMessagingSenderToken(id: $id, accessToken: $accessToken) { ${SENDER_FIELDS} } }`;
const PAUSE = 'mutation ($id: ID!) { adminPauseMessagingSender(id: $id) { id status } }';
const ACTIVATE = 'mutation ($id: ID!) { adminActivateMessagingSender(id: $id) { id status } }';
const BLOCK = 'mutation ($id: ID!) { adminBlockMessagingSender(id: $id) { id status } }';
const DELETE = 'mutation ($id: ID!) { adminDeleteMessagingSender(id: $id) }';
const USAGE = `query ($month: String!) {
  adminWhatsAppUsage(month: $month) { tenantId templateCategory sentCount } }`;
const SMS_USAGE = `query ($month: String!) {
  adminSmsUsage(month: $month) { tenantId type sentCount } }`;

interface SenderView {
  id: string;
  scope: string;
  tenantId: string | null;
  providerNumberId: string;
  displayNumber: string;
  status: string;
  dailyCap: number;
  instituteDailyCap: number | null;
}

interface SmsUsageRow {
  tenantId: string | null;
  type: string;
  sentCount: number;
}

interface UsageRow {
  tenantId: string | null;
  templateCategory: string | null;
  sentCount: number;
}

describe('admin messaging senders (integration)', () => {
  let result: IntegrationAppResult;
  let superPool: pg.Pool;
  let releaseLock: () => Promise<void>;
  let cipher: MessagingTokenCipher;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let reseller: TestReseller;
  let adminToken: string;
  let supportToken: string;
  let instituteToken: string;
  let resellerToken: string;
  const run = randomUUID().slice(0, 8);
  const createdSenderIds = new Set<string>();
  const createdDeliveryIds: string[] = [];
  let numberSeq = 0;

  const providerNumber = () => {
    numberSeq += 1;
    return `admin-messaging-spec-${run}-${numberSeq}`;
  };
  const newToken = () => `spec-token-${randomUUID()}`;

  const gql = <T>(query: string, token: string, variables?: Record<string, unknown>) =>
    gqlRequest<T>(result.httpServer, { query, token, variables });

  const code = (res: { errors?: { extensions?: Record<string, unknown> }[] }) =>
    res.errors?.[0]?.extensions?.code;

  const register = async (input: Record<string, unknown>, token = adminToken) => {
    const res = await gql<{ adminRegisterMessagingSender: SenderView }>(REGISTER, token, {
      input,
    });
    const id = res.data?.adminRegisterMessagingSender.id;
    if (id) createdSenderIds.add(id);
    return res;
  };

  const registerOk = async (input: Record<string, unknown>) => {
    const res = await register(input);
    expect(res.errors).toBeUndefined();
    const sender = res.data?.adminRegisterMessagingSender;
    assert(sender);
    return sender;
  };

  const counts = async () => {
    const { rows } = await superPool.query<{ senders: number; secrets: number }>(
      `SELECT (SELECT count(*)::int FROM messaging_senders) AS senders,
              (SELECT count(*)::int FROM messaging_sender_secrets) AS secrets`,
    );
    const [row] = rows;
    assert(row);
    return row;
  };

  const storedSecret = async (senderId: string): Promise<Buffer | null> => {
    const { rows } = await superPool.query<{ access_token_encrypted: Buffer }>(
      'SELECT access_token_encrypted FROM messaging_sender_secrets WHERE sender_id = $1',
      [senderId],
    );
    return rows[0]?.access_token_encrypted ?? null;
  };

  const removeSenders = async (ids: string[]) => {
    if (ids.length === 0) return;
    await superPool.query('DELETE FROM messaging_senders WHERE id = ANY($1::uuid[])', [ids]);
    for (const id of ids) createdSenderIds.delete(id);
  };

  beforeAll(async () => {
    releaseLock = await holdPlatformSenderLock(SUPERUSER_URL);
    superPool = new pg.Pool({ connectionString: SUPERUSER_URL, max: 2 });

    const { rows: leftovers } = await superPool.query<{ id: string; provider_number_id: string }>(
      `SELECT id, provider_number_id FROM messaging_senders
       WHERE scope = 'platform' AND deleted_at IS NULL`,
    );
    if (leftovers.length > 0) {
      throw new Error(
        `A live platform messaging sender already exists (${leftovers
          .map((r) => `${r.id} / ${r.provider_number_id}`)
          .join(', ')}); a spec or the seed left it behind. Remove it before running this spec.`,
      );
    }

    result = await createIntegrationApp({ modules: [AppModule] });
    cipher = result.app.get(MessagingTokenCipher);
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);

    adminToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });
    supportToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
    });
    instituteToken = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    resellerToken = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
  });

  afterEach(async () => {
    // Every test starts without a live sender of this spec, so the one-per-scope indexes are free.
    await removeSenders([...createdSenderIds]);
  });

  afterAll(async () => {
    try {
      if (superPool) {
        if (createdDeliveryIds.length > 0) {
          await superPool.query('DELETE FROM notification_deliveries WHERE id = ANY($1::uuid[])', [
            createdDeliveryIds,
          ]);
        }
        await removeSenders([...createdSenderIds]);
      }
      if (instA) await cleanupTestInstitute(result.db, instA);
      if (instB) await cleanupTestInstitute(result.db, instB);
      if (reseller) await cleanupTestReseller(result.db, reseller);
      await result?.close();
      await superPool?.end();
    } finally {
      await releaseLock?.();
    }
  });

  describe('register and list', () => {
    it('should store the token encrypted and never return it', async () => {
      const platformToken = newToken();
      const instituteSecret = newToken();

      const platformRes = await register({
        providerNumberId: providerNumber(),
        displayNumber: '+919800000001',
        accessToken: platformToken,
        dailyCap: 1000,
        instituteDailyCap: 50,
      });
      const instituteRes = await register({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000002',
        accessToken: instituteSecret,
        dailyCap: 200,
      });
      expect(platformRes.errors).toBeUndefined();
      expect(instituteRes.errors).toBeUndefined();
      const platform = platformRes.data?.adminRegisterMessagingSender;
      const own = instituteRes.data?.adminRegisterMessagingSender;
      assert(platform && own);
      expect(platform).toMatchObject({
        scope: 'platform',
        tenantId: null,
        status: 'ACTIVE',
        dailyCap: 1000,
        instituteDailyCap: 50,
      });
      expect(own).toMatchObject({
        scope: 'institute',
        tenantId: instA.tenantId,
        status: 'ACTIVE',
        dailyCap: 200,
        instituteDailyCap: null,
      });

      for (const [senderId, token] of [
        [platform.id, platformToken],
        [own.id, instituteSecret],
      ] as const) {
        const stored = await storedSecret(senderId);
        assert(stored);
        expect(cipher.decrypt(stored)).toBe(token);
        expect(stored.includes(Buffer.from(token, 'utf8'))).toBe(false);
      }

      const { rows: senderRows } = await superPool.query<{
        provider: string;
        channel: string;
        created_by: string;
        updated_by: string;
      }>('SELECT provider, channel, created_by, updated_by FROM messaging_senders WHERE id = $1', [
        own.id,
      ]);
      expect(senderRows).toEqual([
        {
          provider: 'whatsapp_cloud',
          channel: 'WHATSAPP',
          created_by: SEED_IDS.USER_ADMIN,
          updated_by: SEED_IDS.USER_ADMIN,
        },
      ]);

      const list = await gql<{ adminMessagingSenders: SenderView[] }>(LIST, adminToken);
      expect(list.errors).toBeUndefined();
      const senders = list.data?.adminMessagingSenders ?? [];
      expect(senders[0]?.id).toBe(platform.id);
      expect(senders.map((s) => s.id)).toContain(own.id);

      for (const body of [platformRes, instituteRes, list]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain(platformToken);
        expect(text).not.toContain(instituteSecret);
      }
    });

    it('should expose no token field on the sender type', async () => {
      const res = await gql<{ __type: { fields: { name: string }[] } }>(
        '{ __type(name: "AdminMessagingSender") { fields { name } } }',
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      const names = res.data?.__type.fields.map((f) => f.name) ?? [];
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => n.toLowerCase().includes('token'))).toEqual([]);
    });

    it('should keep the token out of every audit event and audit row', async () => {
      const emit = vi.spyOn(result.app.get(AuditEmitter), 'emit');
      const first = newToken();
      const second = newToken();

      const sender = await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000003',
        accessToken: first,
        dailyCap: 10,
      });
      const rotated = await gql(ROTATE, adminToken, { id: sender.id, accessToken: second });
      expect(rotated.errors).toBeUndefined();
      const updated = await gql(UPDATE, adminToken, { id: sender.id, input: { dailyCap: 11 } });
      expect(updated.errors).toBeUndefined();

      await vi.waitFor(() =>
        expect(emit.mock.calls.map(([payload]) => payload.action)).toContain(
          'adminUpdateMessagingSender',
        ),
      );
      // Both token mutations are audited, with the token replaced.
      const inputOf = (action: string) =>
        emit.mock.calls.map(([payload]) => payload).find((p) => p.action === action)?.metadata
          ?.input;
      expect(inputOf('adminRegisterMessagingSender')).toMatchObject({
        input: { accessToken: '[REDACTED]', dailyCap: 10 },
      });
      expect(inputOf('adminRotateMessagingSenderToken')).toEqual({
        id: sender.id,
        accessToken: '[REDACTED]',
      });
      const emitted = JSON.stringify(emit.mock.calls);
      expect(emitted).not.toContain(first);
      expect(emitted).not.toContain(second);

      const { rows } = await superPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE coalesce(metadata::text, '') LIKE '%' || $1 || '%'
            OR coalesce(metadata::text, '') LIKE '%' || $2 || '%'
            OR coalesce(changes::text, '') LIKE '%' || $1 || '%'
            OR coalesce(changes::text, '') LIKE '%' || $2 || '%'`,
        [first, second],
      );
      expect(rows).toEqual([{ n: 0 }]);
    });
  });

  describe('register refusals', () => {
    it('should refuse a second platform sender and write nothing', async () => {
      await registerOk({
        providerNumberId: providerNumber(),
        displayNumber: '+919800000010',
        accessToken: newToken(),
        dailyCap: 10,
      });
      const before = await counts();

      const res = await register({
        providerNumberId: providerNumber(),
        displayNumber: '+919800000011',
        accessToken: newToken(),
        dailyCap: 10,
      });

      expect(code(res)).toBe('MESSAGING_SENDER_EXISTS');
      expect(await counts()).toEqual(before);
    });

    it('should refuse a second sender for the same institute', async () => {
      await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000012',
        accessToken: newToken(),
        dailyCap: 10,
      });
      const before = await counts();

      const res = await register({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000013',
        accessToken: newToken(),
        dailyCap: 10,
      });

      expect(code(res)).toBe('MESSAGING_SENDER_EXISTS');
      expect(await counts()).toEqual(before);
    });

    it('should refuse a provider number already registered for another institute', async () => {
      const shared = providerNumber();
      await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: shared,
        displayNumber: '+919800000014',
        accessToken: newToken(),
        dailyCap: 10,
      });
      const before = await counts();

      const res = await register({
        tenantId: instB.tenantId,
        providerNumberId: shared,
        displayNumber: '+919800000015',
        accessToken: newToken(),
        dailyCap: 10,
      });

      expect(code(res)).toBe('MESSAGING_SENDER_EXISTS');
      expect(await counts()).toEqual(before);
    });

    it('should refuse an unknown institute', async () => {
      const before = await counts();

      const res = await register({
        tenantId: randomUUID(),
        providerNumberId: providerNumber(),
        displayNumber: '+919800000016',
        accessToken: newToken(),
        dailyCap: 10,
      });

      expect(code(res)).toBe('INSTITUTE_NOT_FOUND');
      expect(await counts()).toEqual(before);
    });

    it.each([
      ['instituteDailyCap on an institute sender', { tenantId: 'A', instituteDailyCap: 5 }],
      ['a number without +', { displayNumber: '919800000017' }],
      ['a daily cap of 0', { dailyCap: 0 }],
      ['an empty token', { accessToken: '' }],
    ])('should refuse %s', async (_label, override) => {
      const before = await counts();
      const input: Record<string, unknown> = {
        providerNumberId: providerNumber(),
        displayNumber: '+919800000017',
        accessToken: newToken(),
        dailyCap: 10,
        ...override,
      };
      if (input.tenantId === 'A') input.tenantId = instA.tenantId;

      const res = await register(input);

      expect(code(res)).toBe('VALIDATION_FAILED');
      expect(await counts()).toEqual(before);
    });
  });

  describe('who may call', () => {
    const id = '00000000-0000-7000-a000-00000000dead';
    const registerInput = {
      providerNumberId: 'admin-messaging-spec-refused',
      displayNumber: '+919800000020',
      accessToken: 'refused-token',
      dailyCap: 10,
    };
    const operations: [string, string, Record<string, unknown>][] = [
      ['adminMessagingSenders', LIST, {}],
      ['adminRegisterMessagingSender', REGISTER, { input: registerInput }],
      ['adminUpdateMessagingSender', UPDATE, { id, input: { dailyCap: 5 } }],
      ['adminRotateMessagingSenderToken', ROTATE, { id, accessToken: 'refused-token' }],
      ['adminPauseMessagingSender', PAUSE, { id }],
      ['adminActivateMessagingSender', ACTIVATE, { id }],
      ['adminBlockMessagingSender', BLOCK, { id }],
      ['adminDeleteMessagingSender', DELETE, { id }],
      ['adminWhatsAppUsage', USAGE, { month: '2031-10' }],
      ['adminSmsUsage', SMS_USAGE, { month: '2032-03' }],
    ];

    it.each(operations)('should refuse an institute token on %s', async (_name, query, vars) => {
      const before = await counts();
      expect(code(await gql(query, instituteToken, vars))).toBe('FORBIDDEN');
      expect(await counts()).toEqual(before);
    });

    it.each(operations)('should refuse a reseller token on %s', async (_name, query, vars) => {
      const before = await counts();
      expect(code(await gql(query, resellerToken, vars))).toBe('FORBIDDEN');
      expect(await counts()).toEqual(before);
    });

    it.each(
      operations.slice(1, 8),
    )('should refuse a platform role without the ability on %s', async (_name, query, vars) => {
      const before = await counts();
      expect(code(await gql(query, supportToken, vars))).toBe('FORBIDDEN');
      expect(await counts()).toEqual(before);
    });

    it('should let a read-only platform role list senders and usage', async () => {
      expect((await gql(LIST, supportToken)).errors).toBeUndefined();
      expect((await gql(USAGE, supportToken, { month: '2031-10' })).errors).toBeUndefined();
      expect((await gql(SMS_USAGE, supportToken, { month: '2032-03' })).errors).toBeUndefined();
    });
  });

  describe('update, rotate, status and delete', () => {
    it('should update the number and caps, and refuse a share limit on an institute sender', async () => {
      const own = await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000030',
        accessToken: newToken(),
        dailyCap: 10,
      });

      const res = await gql<{ adminUpdateMessagingSender: SenderView }>(UPDATE, adminToken, {
        id: own.id,
        input: { displayNumber: '+919800000031', dailyCap: 25 },
      });
      expect(res.errors).toBeUndefined();
      expect(res.data?.adminUpdateMessagingSender).toMatchObject({
        displayNumber: '+919800000031',
        dailyCap: 25,
      });

      const refused = await gql(UPDATE, adminToken, {
        id: own.id,
        input: { instituteDailyCap: 3 },
      });
      expect(code(refused)).toBe('VALIDATION_FAILED');
      const { rows } = await superPool.query<{ institute_daily_cap: number | null }>(
        'SELECT institute_daily_cap FROM messaging_senders WHERE id = $1',
        [own.id],
      );
      expect(rows).toEqual([{ institute_daily_cap: null }]);
    });

    it("should set and clear the platform sender's share limit", async () => {
      const platform = await registerOk({
        providerNumberId: providerNumber(),
        displayNumber: '+919800000032',
        accessToken: newToken(),
        dailyCap: 10,
        instituteDailyCap: 4,
      });

      const cleared = await gql<{ adminUpdateMessagingSender: SenderView }>(UPDATE, adminToken, {
        id: platform.id,
        input: { instituteDailyCap: null },
      });

      expect(cleared.errors).toBeUndefined();
      expect(cleared.data?.adminUpdateMessagingSender.instituteDailyCap).toBeNull();
      expect(cleared.data?.adminUpdateMessagingSender.dailyCap).toBe(10);
    });

    it('should answer MESSAGING_SENDER_NOT_FOUND for an unknown id', async () => {
      const unknown = randomUUID();
      for (const [query, vars] of [
        [UPDATE, { id: unknown, input: { dailyCap: 5 } }],
        [ROTATE, { id: unknown, accessToken: newToken() }],
        [PAUSE, { id: unknown }],
        [DELETE, { id: unknown }],
      ] as const) {
        expect(code(await gql(query, adminToken, vars))).toBe('MESSAGING_SENDER_NOT_FOUND');
      }
    });

    it('should replace the ciphertext on rotate', async () => {
      const own = await registerOk({
        tenantId: instB.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000033',
        accessToken: newToken(),
        dailyCap: 10,
      });
      const before = await storedSecret(own.id);
      const replacement = newToken();

      const res = await gql(ROTATE, adminToken, { id: own.id, accessToken: replacement });

      expect(res.errors).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain(replacement);
      const after = await storedSecret(own.id);
      assert(before && after);
      expect(after.equals(before)).toBe(false);
      expect(cipher.decrypt(after)).toBe(replacement);
    });

    it('should allow each named transition and refuse the others', async () => {
      const own = await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000034',
        accessToken: newToken(),
        dailyCap: 10,
      });
      const status = async () => {
        const { rows } = await superPool.query<{ status: string }>(
          'SELECT status FROM messaging_senders WHERE id = $1',
          [own.id],
        );
        return rows[0]?.status;
      };
      const step = async (query: string, expected: string) => {
        const res = await gql<Record<string, { status: string }>>(query, adminToken, {
          id: own.id,
        });
        expect(res.errors).toBeUndefined();
        expect(await status()).toBe(expected);
      };
      const refuse = async (query: string) => {
        const before = await status();
        expect(code(await gql(query, adminToken, { id: own.id }))).toBe('INVALID_STATE_TRANSITION');
        expect(await status()).toBe(before);
      };

      await refuse(ACTIVATE); // ACTIVE → ACTIVE
      await step(PAUSE, 'PAUSED');
      await refuse(PAUSE); // PAUSED → PAUSED
      await step(ACTIVATE, 'ACTIVE');
      await step(BLOCK, 'BLOCKED');
      await refuse(PAUSE); // BLOCKED → PAUSED
      await refuse(BLOCK); // BLOCKED → BLOCKED
      await step(ACTIVATE, 'ACTIVE');
      await step(PAUSE, 'PAUSED');
      await step(BLOCK, 'BLOCKED');
    });

    it('should delete the token with the sender and free the institute for a new one', async () => {
      const own = await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000035',
        accessToken: newToken(),
        dailyCap: 10,
      });

      const res = await gql<{ adminDeleteMessagingSender: boolean }>(DELETE, adminToken, {
        id: own.id,
      });

      expect(res.data?.adminDeleteMessagingSender).toBe(true);
      expect(await storedSecret(own.id)).toBeNull();
      const { rows } = await superPool.query<{ deleted_by: string | null; live: boolean }>(
        'SELECT deleted_by, deleted_at IS NULL AS live FROM messaging_senders WHERE id = $1',
        [own.id],
      );
      expect(rows).toEqual([{ deleted_by: SEED_IDS.USER_ADMIN, live: false }]);
      const list = await gql<{ adminMessagingSenders: SenderView[] }>(LIST, adminToken);
      expect(list.data?.adminMessagingSenders.map((s) => s.id)).not.toContain(own.id);
      expect(code(await gql(DELETE, adminToken, { id: own.id }))).toBe(
        'MESSAGING_SENDER_NOT_FOUND',
      );

      await registerOk({
        tenantId: instA.tenantId,
        providerNumberId: providerNumber(),
        displayNumber: '+919800000036',
        accessToken: newToken(),
        dailyCap: 10,
      });
    });
  });

  describe('adminWhatsAppUsage', () => {
    const insertDelivery = async (row: {
      tenantId: string | null;
      recipient: string;
      channel?: string;
      status?: string;
      category?: string | null;
      at: string;
    }) => {
      const status = row.status ?? 'SENT';
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO notification_deliveries
           (scope, tenant_id, recipient_user_id, type, channel, provider, status,
            skip_reason, error_code, template_category, created_at)
         VALUES ($1, $2, $3, 'ATTENDANCE_ABSENT', $4, 'whatsapp_cloud', $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          row.tenantId ? 'institute' : 'platform',
          row.tenantId,
          row.recipient,
          row.channel ?? 'WHATSAPP',
          status,
          status === 'SKIPPED' ? 'sender_cap' : null,
          status === 'FAILED' ? 'provider_error' : null,
          row.category === undefined ? 'UTILITY' : row.category,
          row.at,
        ],
      );
      const [inserted] = rows;
      assert(inserted);
      createdDeliveryIds.push(inserted.id);
    };

    const mine = (rows: UsageRow[]) =>
      rows
        .filter(
          (r) =>
            r.tenantId === null || r.tenantId === instA.tenantId || r.tenantId === instB.tenantId,
        )
        .sort((x, y) =>
          `${x.tenantId}|${x.templateCategory}`.localeCompare(
            `${y.tenantId}|${y.templateCategory}`,
          ),
        );

    beforeAll(async () => {
      const a = instA.tenantId;
      const b = instB.tenantId;
      const ra = instA.userId;
      const rb = instB.userId;
      // October 2031 in India time runs from 2031-09-30T18:30:00Z to 2031-10-31T18:30:00Z.
      await insertDelivery({ tenantId: a, recipient: ra, at: '2031-09-30T18:30:00Z' });
      await insertDelivery({ tenantId: a, recipient: ra, at: '2031-10-31T18:29:59Z' });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        category: 'MARKETING',
        at: '2031-10-15T06:00:00Z',
      });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        category: null,
        at: '2031-10-15T06:00:00Z',
      });
      await insertDelivery({ tenantId: a, recipient: ra, at: '2031-09-30T18:29:59Z' });
      await insertDelivery({ tenantId: a, recipient: ra, at: '2031-10-31T18:30:00Z' });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        status: 'FAILED',
        at: '2031-10-10T06:00:00Z',
      });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        status: 'SKIPPED',
        at: '2031-10-10T06:00:00Z',
      });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        status: 'DELIVERED',
        at: '2031-10-10T06:00:00Z',
      });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        channel: 'EMAIL',
        at: '2031-10-10T06:00:00Z',
      });
      for (let i = 0; i < 3; i += 1) {
        await insertDelivery({
          tenantId: b,
          recipient: rb,
          category: 'AUTHENTICATION',
          at: '2031-10-20T06:00:00Z',
        });
      }
      await insertDelivery({
        tenantId: b,
        recipient: rb,
        status: 'FAILED',
        category: 'AUTHENTICATION',
        at: '2031-10-20T06:00:00Z',
      });
      await insertDelivery({ tenantId: null, recipient: ra, at: '2031-10-05T06:00:00Z' });
    });

    it('should count SENT WhatsApp messages per institute and category in India time', async () => {
      const res = await gql<{ adminWhatsAppUsage: UsageRow[] }>(USAGE, adminToken, {
        month: '2031-10',
      });

      expect(res.errors).toBeUndefined();
      expect(mine(res.data?.adminWhatsAppUsage ?? [])).toEqual(
        mine([
          { tenantId: null, templateCategory: 'UTILITY', sentCount: 1 },
          { tenantId: instA.tenantId, templateCategory: 'UTILITY', sentCount: 2 },
          { tenantId: instA.tenantId, templateCategory: 'MARKETING', sentCount: 1 },
          { tenantId: instA.tenantId, templateCategory: null, sentCount: 1 },
          { tenantId: instB.tenantId, templateCategory: 'AUTHENTICATION', sentCount: 3 },
        ]),
      );
    });

    it('should put the messages just outside October into their own months', async () => {
      const sept = await gql<{ adminWhatsAppUsage: UsageRow[] }>(USAGE, adminToken, {
        month: '2031-09',
      });
      const nov = await gql<{ adminWhatsAppUsage: UsageRow[] }>(USAGE, adminToken, {
        month: '2031-11',
      });

      expect(mine(sept.data?.adminWhatsAppUsage ?? [])).toEqual([
        { tenantId: instA.tenantId, templateCategory: 'UTILITY', sentCount: 1 },
      ]);
      expect(mine(nov.data?.adminWhatsAppUsage ?? [])).toEqual([
        { tenantId: instA.tenantId, templateCategory: 'UTILITY', sentCount: 1 },
      ]);
    });

    it.each([
      '2031-13',
      '2031-1',
      '2031-00',
      '31-10',
      '2031-10-01',
      '',
      'October',
    ])('should refuse the month %j', async (month) => {
      expect(code(await gql(USAGE, adminToken, { month }))).toBe('VALIDATION_FAILED');
    });
  });

  describe('adminSmsUsage', () => {
    const insertDelivery = async (row: {
      tenantId: string | null;
      recipient: string;
      type: string;
      channel?: string;
      status?: string;
      at: string;
    }) => {
      const status = row.status ?? 'SENT';
      const channel = row.channel ?? 'SMS';
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO notification_deliveries
           (scope, tenant_id, recipient_user_id, type, channel, provider, status,
            skip_reason, error_code, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          row.tenantId ? 'institute' : 'platform',
          row.tenantId,
          row.recipient,
          row.type,
          channel,
          channel === 'SMS' ? 'sms_http' : 'whatsapp_cloud',
          status,
          status === 'SKIPPED' ? 'no_template' : null,
          status === 'FAILED' ? 'SMS_REJECTED' : null,
          row.at,
        ],
      );
      const [inserted] = rows;
      assert(inserted);
      createdDeliveryIds.push(inserted.id);
    };

    const mine = (rows: SmsUsageRow[]) =>
      rows
        .filter(
          (r) =>
            r.tenantId === null || r.tenantId === instA.tenantId || r.tenantId === instB.tenantId,
        )
        .sort((x, y) => `${x.tenantId}|${x.type}`.localeCompare(`${y.tenantId}|${y.type}`));

    const usage = async (month: string) => {
      const res = await gql<{ adminSmsUsage: SmsUsageRow[] }>(SMS_USAGE, adminToken, { month });
      expect(res.errors).toBeUndefined();
      return mine(res.data?.adminSmsUsage ?? []);
    };

    beforeAll(async () => {
      const a = instA.tenantId;
      const b = instB.tenantId;
      const ra = instA.userId;
      const rb = instB.userId;
      // March 2032 in India time runs from 2032-02-29T18:30:00Z to 2032-03-31T18:30:00Z.
      const fee = 'FEE_REMINDER';
      const absent = 'ATTENDANCE_ABSENT';
      await insertDelivery({ tenantId: a, recipient: ra, type: fee, at: '2032-02-29T18:30:00Z' });
      await insertDelivery({ tenantId: a, recipient: ra, type: fee, at: '2032-03-31T18:29:59Z' });
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        type: absent,
        at: '2032-03-15T06:00:00Z',
      });
      await insertDelivery({ tenantId: a, recipient: ra, type: fee, at: '2032-02-29T18:29:59Z' });
      await insertDelivery({ tenantId: a, recipient: ra, type: fee, at: '2032-03-31T18:30:00Z' });
      for (const status of ['FAILED', 'SKIPPED']) {
        await insertDelivery({
          tenantId: a,
          recipient: ra,
          type: fee,
          status,
          at: '2032-03-10T06:00:00Z',
        });
      }
      await insertDelivery({
        tenantId: a,
        recipient: ra,
        type: fee,
        channel: 'WHATSAPP',
        at: '2032-03-10T06:00:00Z',
      });
      for (let i = 0; i < 3; i += 1) {
        await insertDelivery({
          tenantId: b,
          recipient: rb,
          type: absent,
          at: '2032-03-20T06:00:00Z',
        });
      }
      await insertDelivery({
        tenantId: b,
        recipient: rb,
        type: absent,
        status: 'FAILED',
        at: '2032-03-20T06:00:00Z',
      });
      await insertDelivery({
        tenantId: b,
        recipient: rb,
        type: absent,
        channel: 'WHATSAPP',
        at: '2032-03-20T06:00:00Z',
      });
      await insertDelivery({
        tenantId: null,
        recipient: ra,
        type: 'IMPERSONATION_OTP',
        at: '2032-03-05T06:00:00Z',
      });
    });

    it('should count SENT SMS messages per institute and type in India time', async () => {
      expect(await usage('2032-03')).toEqual(
        mine([
          { tenantId: null, type: 'IMPERSONATION_OTP', sentCount: 1 },
          { tenantId: instA.tenantId, type: 'FEE_REMINDER', sentCount: 2 },
          { tenantId: instA.tenantId, type: 'ATTENDANCE_ABSENT', sentCount: 1 },
          { tenantId: instB.tenantId, type: 'ATTENDANCE_ABSENT', sentCount: 3 },
        ]),
      );
    });

    it('should put the messages just outside March into their own months', async () => {
      expect(await usage('2032-02')).toEqual([
        { tenantId: instA.tenantId, type: 'FEE_REMINDER', sentCount: 1 },
      ]);
      expect(await usage('2032-04')).toEqual([
        { tenantId: instA.tenantId, type: 'FEE_REMINDER', sentCount: 1 },
      ]);
    });

    it('should not count SMS messages in the WhatsApp usage', async () => {
      const res = await gql<{ adminWhatsAppUsage: UsageRow[] }>(USAGE, adminToken, {
        month: '2032-03',
      });

      expect(res.errors).toBeUndefined();
      const byTenant = (rows: UsageRow[]) =>
        rows
          .filter((r) => r.tenantId === instA.tenantId || r.tenantId === instB.tenantId)
          .sort((x, y) => `${x.tenantId}`.localeCompare(`${y.tenantId}`));
      expect(byTenant(res.data?.adminWhatsAppUsage ?? [])).toEqual(
        byTenant([
          { tenantId: instA.tenantId, templateCategory: null, sentCount: 1 },
          { tenantId: instB.tenantId, templateCategory: null, sentCount: 1 },
        ]),
      );
    });

    it.each([
      '2032-13',
      '2032-3',
      '2032-00',
      '32-03',
      '2032-03-01',
      '',
      'March',
    ])('should refuse the month %j', async (month) => {
      expect(code(await gql(SMS_USAGE, adminToken, { month }))).toBe('VALIDATION_FAILED');
    });
  });
});
