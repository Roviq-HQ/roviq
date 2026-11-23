/**
 * What the database enforces by itself on the messaging tables (ROV-319): policies, grants
 * and constraints from the `rov-319-messaging-senders` migration. Each test assumes a
 * database role and attempts the read or write; nothing goes through the application.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../seed/ids';
import { asInstitute, asReseller, become, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const DENIED = /permission denied/;

let pool: pg.Pool;
const inTx = (fn: (client: pg.PoolClient) => Promise<void>) => inRolledBackTx(pool, fn);

let numberSeq = 0;

async function insertSender(
  client: pg.PoolClient,
  target: { scope: 'institute' | 'platform'; tenantId?: string },
): Promise<string> {
  numberSeq += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO messaging_senders
       (scope, tenant_id, channel, provider, provider_number_id, display_number, daily_cap,
        created_by, updated_by)
     VALUES ($1, $2, 'WHATSAPP', 'test', $3, '+910000000000', 250, $4, $4) RETURNING id`,
    [target.scope, target.tenantId ?? null, `db-spec-${numberSeq}`, SYSTEM],
  );
  return rows[0].id;
}

async function insertSecret(client: pg.PoolClient, senderId: string): Promise<void> {
  await client.query(
    `INSERT INTO messaging_sender_secrets (sender_id, access_token_encrypted, created_by, updated_by)
     VALUES ($1, '\\x00ff'::bytea, $2, $2)`,
    [senderId, SYSTEM],
  );
}

/** A platform sender may already exist in the database; only one live one is allowed. */
async function removePlatformSenders(client: pg.PoolClient): Promise<void> {
  await client.query(
    `UPDATE messaging_senders SET deleted_at = now(), deleted_by = $1
     WHERE scope = 'platform' AND deleted_at IS NULL`,
    [SYSTEM],
  );
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

describe('messaging tables: row-level security is forced', () => {
  it.each([
    'messaging_senders',
    'messaging_sender_secrets',
    'messaging_opt_outs',
    'messaging_inbound_events',
  ])('%s has RLS enabled and forced', async (table) => {
    await inTx(async (client) => {
      const { rows } = await client.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(rows).toEqual([{ enabled: true, forced: true }]);
    });
  });
});

describe('messaging_senders', () => {
  it('an institute reads only its own sender, never the platform sender or another institute', async () => {
    await inTx(async (client) => {
      await removePlatformSenders(client);
      const own = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      const other = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_2,
      });
      const platform = await insertSender(client, { scope: 'platform' });
      const ids = [own, other, platform];

      await asInstitute(client, SEED_IDS.INSTITUTE_1);
      for (const relation of ['messaging_senders', 'messaging_senders_live']) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM ${relation} WHERE id = ANY($1::uuid[])`,
          [ids],
        );
        expect(rows.map((r) => r.id)).toEqual([own]);
      }
    });
  });

  it('an institute cannot create, change or delete a sender, its own included', async () => {
    await inTx(async (client) => {
      const own = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      await asInstitute(client, SEED_IDS.INSTITUTE_1);
      await expectRefused(
        client,
        DENIED,
        `INSERT INTO messaging_senders
           (scope, tenant_id, channel, provider, provider_number_id, display_number, daily_cap,
            created_by, updated_by)
         VALUES ('institute', $1, 'WHATSAPP', 'test', 'forged', '+910000000001', 5, $2, $2)`,
        [SEED_IDS.INSTITUTE_1, SYSTEM],
      );
      await expectRefused(
        client,
        DENIED,
        'UPDATE messaging_senders SET daily_cap = 100000 WHERE id = $1',
        [own],
      );
      await expectRefused(client, DENIED, 'DELETE FROM messaging_senders WHERE id = $1', [own]);
    });
  });

  it('a reseller reads no sender', async () => {
    await inTx(async (client) => {
      await insertSender(client, { scope: 'institute', tenantId: SEED_IDS.INSTITUTE_1 });
      await asReseller(client, SEED_IDS.RESELLER_DIRECT);
      await expectRefused(client, DENIED, 'SELECT id FROM messaging_senders');
      await expectRefused(client, DENIED, 'SELECT id FROM messaging_senders_live');
    });
  });

  it('a row must name an institute exactly when its scope is institute', async () => {
    await inTx(async (client) => {
      const insert = `INSERT INTO messaging_senders
          (scope, tenant_id, channel, provider, provider_number_id, display_number, daily_cap,
           created_by, updated_by)
        VALUES ($1, $2, 'WHATSAPP', 'test', $3, '+910000000002', 10, $4, $4)`;
      const check = /chk_messaging_senders_scope/;
      await expectRefused(client, check, insert, ['institute', null, 'scope-a', SYSTEM]);
      await expectRefused(client, check, insert, [
        'platform',
        SEED_IDS.INSTITUTE_1,
        'scope-b',
        SYSTEM,
      ]);
      await expectRefused(client, check, insert, [
        'reseller',
        SEED_IDS.INSTITUTE_1,
        'scope-c',
        SYSTEM,
      ]);
    });
  });

  it('one live sender per institute and channel, one for the platform, one per provider number', async () => {
    await inTx(async (client) => {
      await removePlatformSenders(client);
      await insertSender(client, { scope: 'institute', tenantId: SEED_IDS.INSTITUTE_1 });
      await insertSender(client, { scope: 'platform' });
      const takenNumber = `db-spec-${numberSeq}`;
      await client.query('SAVEPOINT s');
      await expect(
        insertSender(client, { scope: 'institute', tenantId: SEED_IDS.INSTITUTE_1 }),
      ).rejects.toThrow(/messaging_senders_tenant_channel_key/);
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expect(insertSender(client, { scope: 'platform' })).rejects.toThrow(
        /messaging_senders_platform_channel_key/,
      );
      await client.query('ROLLBACK TO SAVEPOINT s');
      await expectRefused(
        client,
        /messaging_senders_provider_number_key/,
        `INSERT INTO messaging_senders
           (scope, tenant_id, channel, provider, provider_number_id, display_number, daily_cap,
            created_by, updated_by)
         VALUES ('institute', $1, 'WHATSAPP', 'test', $2, '+910000000003', 10, $3, $3)`,
        [SEED_IDS.INSTITUTE_2, takenNumber, SYSTEM],
      );
    });
  });

  it('a cap must be positive', async () => {
    await inTx(async (client) => {
      const id = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      const check = /chk_messaging_senders_caps/;
      await expectRefused(
        client,
        check,
        'UPDATE messaging_senders SET daily_cap = 0 WHERE id = $1',
        [id],
      );
      await expectRefused(
        client,
        check,
        'UPDATE messaging_senders SET institute_daily_cap = 0 WHERE id = $1',
        [id],
      );
    });
  });
});

describe('messaging_sender_secrets', () => {
  it('only the platform role reads or writes a token; request roles hold no right', async () => {
    await inTx(async (client) => {
      const own = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      await insertSecret(client, own);
      const { rows } = await client.query(
        'SELECT access_token_encrypted FROM messaging_sender_secrets WHERE sender_id = $1',
        [own],
      );
      expect(rows).toHaveLength(1);

      for (const role of ['roviq_app', 'roviq_reseller'] as const) {
        await become(client, role, {
          'app.current_tenant_id': SEED_IDS.INSTITUTE_1,
          'app.current_reseller_id': SEED_IDS.RESELLER_DIRECT,
        });
        await expectRefused(client, DENIED, 'SELECT * FROM messaging_sender_secrets');
        await expectRefused(
          client,
          DENIED,
          `UPDATE messaging_sender_secrets SET access_token_encrypted = '\\x01'::bytea`,
        );
        await expectRefused(
          client,
          DENIED,
          `INSERT INTO messaging_sender_secrets (sender_id, access_token_encrypted, created_by, updated_by)
           VALUES ($1, '\\x01'::bytea, $2, $2)`,
          [own, SYSTEM],
        );
        await expectRefused(client, DENIED, 'DELETE FROM messaging_sender_secrets');
        await client.query('SET LOCAL ROLE roviq_admin');
      }
    });
  });

  it('the sender row an institute reads has no token column', async () => {
    await inTx(async (client) => {
      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name IN ('messaging_senders', 'messaging_senders_live')
           AND column_name ILIKE '%token%'`,
      );
      expect(rows).toEqual([]);
    });
  });
});

describe.each([
  {
    table: 'messaging_opt_outs',
    insert: `INSERT INTO messaging_opt_outs (sender_id, channel, recipient_phone)
             VALUES ($1, 'WHATSAPP', '+919000000001') RETURNING id`,
  },
  {
    table: 'messaging_inbound_events',
    insert: `INSERT INTO messaging_inbound_events (sender_id, provider_event_id, kind)
             VALUES ($1, 'evt-append-only', 'message') RETURNING id`,
  },
])('$table', ({ table, insert }) => {
  it('request roles cannot read or write it', async () => {
    await inTx(async (client) => {
      const sender = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      await client.query(insert, [sender]);
      for (const role of ['roviq_app', 'roviq_reseller'] as const) {
        await become(client, role, {
          'app.current_tenant_id': SEED_IDS.INSTITUTE_1,
          'app.current_reseller_id': SEED_IDS.RESELLER_DIRECT,
        });
        await expectRefused(client, DENIED, `SELECT * FROM ${table}`);
        await expectRefused(client, DENIED, insert, [sender]);
        await client.query('SET LOCAL ROLE roviq_admin');
      }
    });
  });

  it('is append-only, also for the platform role', async () => {
    await inTx(async (client) => {
      const sender = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      const { rows } = await client.query<{ id: string }>(insert, [sender]);
      await expectRefused(client, DENIED, `UPDATE ${table} SET sender_id = $1 WHERE id = $2`, [
        sender,
        rows[0].id,
      ]);
      await expectRefused(client, DENIED, `DELETE FROM ${table} WHERE id = $1`, [rows[0].id]);
    });
  });
});

describe('messaging_opt_outs and messaging_inbound_events: constraints', () => {
  it('an opt-out names a phone number or a provider user id', async () => {
    await inTx(async (client) => {
      const sender = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      await expectRefused(
        client,
        /chk_messaging_opt_outs_recipient/,
        `INSERT INTO messaging_opt_outs (sender_id, channel) VALUES ($1, 'WHATSAPP')`,
        [sender],
      );
      await client.query(
        `INSERT INTO messaging_opt_outs (sender_id, channel, provider_user_id)
         VALUES ($1, 'WHATSAPP', 'user-without-phone')`,
        [sender],
      );
    });
  });

  it('an opt-out row says STOP unless it says START, and nothing else', async () => {
    await inTx(async (client) => {
      const sender = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      const insert = `INSERT INTO messaging_opt_outs (sender_id, channel, recipient_phone, action)
                      VALUES ($1, 'WHATSAPP', '+919000000003', $2)`;
      await client.query(insert, [sender, 'START']);
      await expectRefused(client, /chk_messaging_opt_outs_action/, insert, [sender, 'PAUSE']);
      const { rows } = await client.query<{ action: string }>(
        `INSERT INTO messaging_opt_outs (sender_id, channel, recipient_phone)
         VALUES ($1, 'WHATSAPP', '+919000000004') RETURNING action`,
        [sender],
      );
      expect(rows).toEqual([{ action: 'STOP' }]);
    });
  });

  it('an event id is stored once per sender, and one automatic reply per person and day', async () => {
    await inTx(async (client) => {
      const sender = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      const insert = `INSERT INTO messaging_inbound_events
          (sender_id, provider_event_id, kind, recipient_phone, provider_user_id, auto_reply_day)
        VALUES ($1, $2, 'message', $3, $4, $5)`;
      await client.query(insert, [sender, 'evt-1', '+919000000002', null, '2026-11-23']);
      await expectRefused(client, /messaging_inbound_events_event_key/, insert, [
        sender,
        'evt-1',
        '+919000000009',
        null,
        null,
      ]);
      await expectRefused(client, /messaging_inbound_events_auto_reply_key/, insert, [
        sender,
        'evt-2',
        '+919000000002',
        null,
        '2026-11-23',
      ]);
      // The next day, another person, or an event that gets no reply are all fine.
      await client.query(insert, [sender, 'evt-3', '+919000000002', null, '2026-11-24']);
      await client.query(insert, [sender, 'evt-4', null, 'user-x', '2026-11-23']);
      await client.query(insert, [sender, 'evt-5', '+919000000002', null, null]);
    });
  });
});

describe('notification_deliveries: sender reference', () => {
  it('a delivery row may name the sender it went through, and only an existing one', async () => {
    await inTx(async (client) => {
      const sender = await insertSender(client, {
        scope: 'institute',
        tenantId: SEED_IDS.INSTITUTE_1,
      });
      const insert = `INSERT INTO notification_deliveries
          (scope, tenant_id, recipient_user_id, type, channel, provider, status, sender_id,
           template_category)
        VALUES ('institute', $1, $2, 'ATTENDANCE_ABSENT', 'WHATSAPP', 'test', 'SENT', $3, 'UTILITY')`;
      await client.query(insert, [SEED_IDS.INSTITUTE_1, SEED_IDS.USER_ADMIN, sender]);
      await expectRefused(client, /violates foreign key constraint/, insert, [
        SEED_IDS.INSTITUTE_1,
        SEED_IDS.USER_ADMIN,
        '00000000-0000-7000-a000-00000000dead',
      ]);
    });
  });
});
