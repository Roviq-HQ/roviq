/**
 * What the institute role may write on `institutes` (ROV-383), proved by attempting each
 * statement as the database role.
 *
 * An institute edits the profile columns of its own row. It changes no other institute's row,
 * no column that decides ownership, status or billing, and it never inserts or deletes one.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asInstitute, become, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const PERMISSION_DENIED = /permission denied for table institutes/;

/** Columns the institute role may update. The manifest of the grant. */
const EDITABLE = [
  'name',
  'code',
  'contact',
  'address',
  'timezone',
  'currency',
  'supported_locales',
  'default_locale',
  'version',
  'updated_at',
  'updated_by',
];

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 3 });
});

afterAll(async () => {
  await pool.end();
});

/** A reseller and one institute of it. Runs as `roviq_admin`. */
async function createInstitute(client: pg.PoolClient): Promise<{ id: string; resellerId: string }> {
  const tag = randomUUID().slice(0, 8);
  const reseller = await client.query<{ id: string }>(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-383 ${tag}`, `rov383-${tag}`, SYSTEM],
  );
  const institute = await client.query<{ id: string }>(
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [JSON.stringify({ en: `ROV-383 ${tag}` }), `rov383-inst-${tag}`, reseller.rows[0].id, SYSTEM],
  );
  return { id: institute.rows[0].id, resellerId: reseller.rows[0].id };
}

describe('institutes, as the institute role', () => {
  it('updates the profile columns of its own row', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createInstitute(client);
      await asInstitute(client, a.id);
      const updated = await client.query(
        `UPDATE institutes
            SET name = $2, code = $3, contact = '{"phones":[],"emails":[]}', address = '{}',
                timezone = 'Asia/Kolkata', currency = 'INR',
                supported_locales = '["en","hi"]', default_locale = 'en',
                version = version + 1, updated_at = now(), updated_by = $4
          WHERE id = $1 RETURNING id`,
        [a.id, JSON.stringify({ en: 'Renamed' }), `R383${randomUUID().slice(0, 6)}`, SYSTEM],
      );
      expect(updated.rowCount).toBe(1);
    });
  });

  it('changes no row of another institute', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createInstitute(client);
      const b = await createInstitute(client);
      await asInstitute(client, a.id);
      const updated = await client.query(
        `UPDATE institutes SET timezone = 'UTC' WHERE id = $1 RETURNING id`,
        [b.id],
      );
      expect(updated.rowCount).toBe(0);
      const everyRow = await client.query(`UPDATE institutes SET timezone = 'UTC' RETURNING id`);
      expect(everyRow.rows.map((row) => row.id)).toEqual([a.id]);
      await become(client, 'roviq_admin');
      const other = await client.query(`SELECT timezone FROM institutes WHERE id = $1`, [b.id]);
      expect(other.rows[0].timezone).not.toBe('UTC');
    });
  });

  it.each([
    ['status', `'SUSPENDED'`],
    ['setup_status', `'COMPLETED'`],
    ['reseller_id', 'NULL'],
    ['group_id', 'NULL'],
    ['slug', `'taken-over'`],
    ['is_demo', 'true'],
    ['first_admin_user_id', 'NULL'],
    ['require_impersonation_consent', 'false'],
    ['settings', `'{}'`],
    ['type', `'COACHING'`],
    ['structure_framework', `'NEP'`],
    ['departments', `'{}'`],
    ['deleted_at', 'now()'],
    ['deleted_by', 'NULL'],
    ['created_by', 'NULL'],
    ['id', 'uuidv7()'],
  ])('cannot update %s, even on its own row', async (column, value) => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createInstitute(client);
      await asInstitute(client, a.id);
      await expectRefused(
        client,
        PERMISSION_DENIED,
        `UPDATE institutes SET ${column} = ${value} WHERE id = $1`,
        [a.id],
      );
    });
  });

  it('cannot insert or delete an institute', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createInstitute(client);
      await asInstitute(client, a.id);
      await expectRefused(
        client,
        PERMISSION_DENIED,
        `INSERT INTO institutes (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3)`,
        [JSON.stringify({ en: 'New' }), `rov383-new-${randomUUID().slice(0, 8)}`, SYSTEM],
      );
      await expectRefused(client, PERMISSION_DENIED, `DELETE FROM institutes WHERE id = $1`, [
        a.id,
      ]);
    });
  });

  it('holds update on exactly the listed columns', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await become(client, 'roviq_admin');
      const granted = await client.query<{ column_name: string }>(
        `SELECT a.attname AS column_name
           FROM pg_attribute a
          WHERE a.attrelid = 'public.institutes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('roviq_app', a.attrelid, a.attnum, 'UPDATE')`,
      );
      expect(granted.rows.map((row) => row.column_name).sort()).toEqual([...EDITABLE].sort());
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
