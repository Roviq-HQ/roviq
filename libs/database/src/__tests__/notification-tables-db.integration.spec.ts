/**
 * What the database enforces by itself on the notification tables (ROV-314): policies,
 * grants and constraints from the `rov-314-notification-tables` migration. Each test
 * assumes a database role and attempts the read or write; nothing goes through the
 * application, so these hold for every present and future code path.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../seed/ids';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const TITLE = JSON.stringify({ en: 'Leave approved' });
const BODY = JSON.stringify({ en: 'Your leave was approved.' });

let pool: pg.Pool;

/** Run `fn` in a transaction that is always rolled back, starting as `roviq_admin`. */
async function inTx(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE roviq_admin');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function become(
  client: pg.PoolClient,
  role: 'roviq_app' | 'roviq_reseller' | 'roviq_admin',
  vars: Record<string, string> = {},
): Promise<void> {
  await client.query(`SET LOCAL ROLE ${role}`);
  for (const [key, value] of Object.entries(vars)) {
    await client.query('SELECT set_config($1, $2, true)', [key, value]);
  }
}

const asInstitute = (client: pg.PoolClient, tenantId: string) =>
  become(client, 'roviq_app', { 'app.current_tenant_id': tenantId });
const asReseller = (client: pg.PoolClient, resellerId: string) =>
  become(client, 'roviq_reseller', { 'app.current_reseller_id': resellerId });

/** The statement must fail with `pattern`; the surrounding transaction stays usable. */
async function expectRefused(
  client: pg.PoolClient,
  pattern: RegExp,
  text: string,
  params: unknown[] = [],
): Promise<void> {
  await client.query('SAVEPOINT attempt');
  await expect(client.query(text, params)).rejects.toThrow(pattern);
  await client.query('ROLLBACK TO SAVEPOINT attempt');
}

interface Target {
  scope: 'institute' | 'reseller' | 'platform';
  tenantId?: string;
  resellerId?: string;
}

async function insertNotification(client: pg.PoolClient, target: Target): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO notifications
       (scope, tenant_id, reseller_id, recipient_user_id, type, title, body, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'LEAVE_DECIDED', $5, $6, $7, $7) RETURNING id`,
    [
      target.scope,
      target.tenantId ?? null,
      target.resellerId ?? null,
      SEED_IDS.USER_ADMIN,
      TITLE,
      BODY,
      SYSTEM,
    ],
  );
  return rows[0].id;
}

async function insertDelivery(client: pg.PoolClient, target: Target): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO notification_deliveries
       (scope, tenant_id, reseller_id, recipient_user_id, type, channel, provider, status)
     VALUES ($1, $2, $3, $4, 'LEAVE_DECIDED', 'EMAIL', 'log', 'SENT') RETURNING id`,
    [target.scope, target.tenantId ?? null, target.resellerId ?? null, SEED_IDS.USER_ADMIN],
  );
  return rows[0].id;
}

const visibleIds = async (client: pg.PoolClient, table: string, ids: string[]) =>
  (
    await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])
  ).rows.map((r) => r.id);

const INSTITUTE_1: Target = { scope: 'institute', tenantId: SEED_IDS.INSTITUTE_1 };
const INSTITUTE_2: Target = { scope: 'institute', tenantId: SEED_IDS.INSTITUTE_2 };
const RESELLER: Target = { scope: 'reseller', resellerId: SEED_IDS.RESELLER_DIRECT };
const PLATFORM: Target = { scope: 'platform' };

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

describe('notification tables: row-level security is forced', () => {
  it.each([
    'notifications',
    'notification_deliveries',
    'device_tokens',
  ])('%s has RLS enabled and forced', async (table) => {
    await inTx(async (client) => {
      const { rows } = await client.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
           FROM pg_class WHERE oid = $1::regclass`,
        [table],
      );
      expect(rows[0]).toEqual({ enabled: true, forced: true });
    });
  });
});

describe('notifications', () => {
  it('an institute reads only its own institute-scoped rows', async () => {
    await inTx(async (client) => {
      const own = await insertNotification(client, INSTITUTE_1);
      const others = [
        await insertNotification(client, INSTITUTE_2),
        await insertNotification(client, RESELLER),
        await insertNotification(client, PLATFORM),
      ];

      await asInstitute(client, SEED_IDS.INSTITUTE_1);

      expect(await visibleIds(client, 'notifications', [own, ...others])).toEqual([own]);
      expect(await visibleIds(client, 'notifications_live', [own, ...others])).toEqual([own]);
    });
  });

  it('an institute cannot create or delete a notification', async () => {
    await inTx(async (client) => {
      const own = await insertNotification(client, INSTITUTE_1);
      await asInstitute(client, SEED_IDS.INSTITUTE_1);

      await expectRefused(
        client,
        /permission denied for table notifications/,
        `INSERT INTO notifications
           (scope, tenant_id, recipient_user_id, type, title, body, created_by, updated_by)
         VALUES ('institute', $1, $2, 'FORGED', $3, $4, $5, $5)`,
        [SEED_IDS.INSTITUTE_1, SEED_IDS.USER_TEACHER, TITLE, BODY, SYSTEM],
      );
      await expectRefused(
        client,
        /permission denied for table notifications/,
        'DELETE FROM notifications WHERE id = $1',
        [own],
      );
    });
  });

  it('an institute may set read_at and archived_at, and nothing else', async () => {
    await inTx(async (client) => {
      const own = await insertNotification(client, INSTITUTE_1);
      await asInstitute(client, SEED_IDS.INSTITUTE_1);

      const marked = await client.query(
        `UPDATE notifications
            SET read_at = now(), archived_at = now(), updated_by = $2, version = version + 1
          WHERE id = $1`,
        [own, SEED_IDS.USER_ADMIN],
      );
      expect(marked.rowCount).toBe(1);

      for (const assignment of [
        `title = '{"en":"Pay here"}'::jsonb`,
        `body = '{"en":"Pay here"}'::jsonb`,
        `data = '{"href":"https://evil.example"}'::jsonb`,
        `recipient_user_id = '${SEED_IDS.USER_TEACHER}'`,
        `tenant_id = '${SEED_IDS.INSTITUTE_2}'`,
        'deleted_at = now()',
      ]) {
        await expectRefused(
          client,
          /permission denied for table notifications/,
          `UPDATE notifications SET ${assignment} WHERE id = $1`,
          [own],
        );
      }
    });
  });

  it("an institute cannot mark another institute's notification", async () => {
    await inTx(async (client) => {
      const foreign = await insertNotification(client, INSTITUTE_2);
      await asInstitute(client, SEED_IDS.INSTITUTE_1);

      const result = await client.query('UPDATE notifications SET read_at = now() WHERE id = $1', [
        foreign,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('a reseller reads and marks only its own reseller-scoped rows', async () => {
    await inTx(async (client) => {
      const own = await insertNotification(client, RESELLER);
      const institute = await insertNotification(client, INSTITUTE_1);
      const platform = await insertNotification(client, PLATFORM);

      await asReseller(client, SEED_IDS.RESELLER_DIRECT);
      expect(await visibleIds(client, 'notifications', [own, institute, platform])).toEqual([own]);
      const marked = await client.query('UPDATE notifications SET read_at = now() WHERE id = $1', [
        own,
      ]);
      expect(marked.rowCount).toBe(1);
      await expectRefused(
        client,
        /permission denied for table notifications/,
        `INSERT INTO notifications
           (scope, reseller_id, recipient_user_id, type, title, body, created_by, updated_by)
         VALUES ('reseller', $1, $2, 'FORGED', $3, $4, $5, $5)`,
        [SEED_IDS.RESELLER_DIRECT, SEED_IDS.USER_RESELLER, TITLE, BODY, SYSTEM],
      );

      await asReseller(client, randomUUID());
      expect(await visibleIds(client, 'notifications', [own, institute, platform])).toEqual([]);
    });
  });

  it('a row must name the institute or reseller its scope requires', async () => {
    await inTx(async (client) => {
      const insert = `INSERT INTO notifications
          (scope, tenant_id, reseller_id, recipient_user_id, type, title, body, created_by, updated_by)
        VALUES ($1, $2, $3, $4, 'LEAVE_DECIDED', $5, $6, $7, $7)`;
      const row = (scope: string, tenantId: string | null, resellerId: string | null) => [
        scope,
        tenantId,
        resellerId,
        SEED_IDS.USER_ADMIN,
        TITLE,
        BODY,
        SYSTEM,
      ];

      await expectRefused(client, /chk_notifications_scope/, insert, row('institute', null, null));
      await expectRefused(
        client,
        /chk_notifications_scope/,
        insert,
        row('platform', SEED_IDS.INSTITUTE_1, null),
      );
      await expectRefused(
        client,
        /chk_notifications_scope/,
        insert,
        row('reseller', SEED_IDS.INSTITUTE_1, SEED_IDS.RESELLER_DIRECT),
      );
      await expectRefused(
        client,
        /chk_notifications_scope/,
        insert,
        row('tenant', SEED_IDS.INSTITUTE_1, null),
      );
    });
  });
});

describe('notification_deliveries', () => {
  it('an institute reads only its own rows and cannot write', async () => {
    await inTx(async (client) => {
      const own = await insertDelivery(client, INSTITUTE_1);
      const others = [
        await insertDelivery(client, INSTITUTE_2),
        await insertDelivery(client, RESELLER),
        await insertDelivery(client, PLATFORM),
      ];

      await asInstitute(client, SEED_IDS.INSTITUTE_1);

      expect(await visibleIds(client, 'notification_deliveries', [own, ...others])).toEqual([own]);
      await expectRefused(
        client,
        /permission denied for table notification_deliveries/,
        `INSERT INTO notification_deliveries
           (scope, tenant_id, recipient_user_id, type, channel, provider, status)
         VALUES ('institute', $1, $2, 'FORGED', 'EMAIL', 'log', 'SENT')`,
        [SEED_IDS.INSTITUTE_1, SEED_IDS.USER_ADMIN],
      );
      await expectRefused(
        client,
        /permission denied for table notification_deliveries/,
        `UPDATE notification_deliveries SET status = 'DELIVERED' WHERE id = $1`,
        [own],
      );
    });
  });

  it('a reseller cannot read delivery rows', async () => {
    await inTx(async (client) => {
      await insertDelivery(client, RESELLER);
      await asReseller(client, SEED_IDS.RESELLER_DIRECT);

      await expectRefused(
        client,
        /permission denied for table notification_deliveries/,
        'SELECT id FROM notification_deliveries',
      );
    });
  });

  it('is append-only, also for the platform role', async () => {
    await inTx(async (client) => {
      const id = await insertDelivery(client, INSTITUTE_1);

      await expectRefused(
        client,
        /permission denied for table notification_deliveries/,
        `UPDATE notification_deliveries SET status = 'FAILED', error_code = 'X' WHERE id = $1`,
        [id],
      );
      await expectRefused(
        client,
        /permission denied for table notification_deliveries/,
        'DELETE FROM notification_deliveries WHERE id = $1',
        [id],
      );
    });
  });

  it('a skipped row needs a reason and a failed row an error code', async () => {
    await inTx(async (client) => {
      const insert = `INSERT INTO notification_deliveries
          (scope, tenant_id, recipient_user_id, type, channel, status, skip_reason, error_code)
        VALUES ('institute', $1, $2, 'LEAVE_DECIDED', 'WHATSAPP', $3, $4, $5)`;
      const row = (status: string, skipReason: string | null, errorCode: string | null) => [
        SEED_IDS.INSTITUTE_1,
        SEED_IDS.USER_ADMIN,
        status,
        skipReason,
        errorCode,
      ];

      await expectRefused(
        client,
        /chk_notification_deliveries_outcome/,
        insert,
        row('SKIPPED', null, null),
      );
      await expectRefused(
        client,
        /chk_notification_deliveries_outcome/,
        insert,
        row('FAILED', null, null),
      );
      const skipped = await client.query(insert, row('SKIPPED', 'no_provider', null));
      expect(skipped.rowCount).toBe(1);
      const failed = await client.query(insert, row('FAILED', null, 'PROVIDER_TIMEOUT'));
      expect(failed.rowCount).toBe(1);
    });
  });
});

describe('device_tokens', () => {
  const insertToken = (client: pg.PoolClient, token: string, userId: string) =>
    client.query<{ id: string }>(
      `INSERT INTO device_tokens (user_id, token, platform, created_by, updated_by)
       VALUES ($1, $2, 'WEB', $1, $1) RETURNING id`,
      [userId, token],
    );

  it('request roles cannot read or write tokens, also through the live view', async () => {
    await inTx(async (client) => {
      const token = `tok-${randomUUID()}`;
      await insertToken(client, token, SEED_IDS.USER_ADMIN);

      await asInstitute(client, SEED_IDS.INSTITUTE_1);
      await expectRefused(
        client,
        /permission denied for table device_tokens/,
        'SELECT token FROM device_tokens',
      );
      // security_invoker: the view checks the caller's rights on the base table.
      await expectRefused(
        client,
        /permission denied for table device_tokens/,
        'SELECT token FROM device_tokens_live',
      );
      await expectRefused(
        client,
        /permission denied for table device_tokens/,
        `INSERT INTO device_tokens (user_id, token, platform, created_by, updated_by)
         VALUES ($1, $2, 'WEB', $1, $1)`,
        [SEED_IDS.USER_TEACHER, `tok-${randomUUID()}`],
      );

      await asReseller(client, SEED_IDS.RESELLER_DIRECT);
      await expectRefused(
        client,
        /permission denied for table device_tokens/,
        'SELECT token FROM device_tokens',
      );
    });
  });

  it('a live token belongs to one user; a removed token can be registered again', async () => {
    await inTx(async (client) => {
      const token = `tok-${randomUUID()}`;
      const first = await insertToken(client, token, SEED_IDS.USER_ADMIN);

      await expectRefused(
        client,
        /device_tokens_token_key/,
        `INSERT INTO device_tokens (user_id, token, platform, created_by, updated_by)
         VALUES ($1, $2, 'WEB', $1, $1)`,
        [SEED_IDS.USER_TEACHER, token],
      );

      await client.query('UPDATE device_tokens SET deleted_at = now() WHERE id = $1', [
        first.rows[0].id,
      ]);
      const again = await insertToken(client, token, SEED_IDS.USER_TEACHER);
      expect(again.rowCount).toBe(1);
    });
  });
});
