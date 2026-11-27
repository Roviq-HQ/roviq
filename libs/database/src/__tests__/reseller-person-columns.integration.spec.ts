/**
 * A reseller reads its institutes' people, but not a person's caste, religion, disability or
 * identity numbers (ROV-391). The reseller role holds column privileges that leave those
 * columns out; this spec attempts each read as the role.
 *
 * PostgreSQL checks a column privilege before it looks at any row, so no fixture is needed.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asInstitute, asReseller, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL } from './test-helpers';

const NOBODY = '00000000-0000-0000-0000-00000000dead';
const DENIED = /permission denied/;

/** Table → the columns the reseller role may not read, and one it may. */
const WITHHELD: ReadonlyArray<{ table: string; columns: string[]; readable: string }> = [
  {
    table: 'student_profiles',
    columns: [
      'social_category',
      'caste',
      'is_minority',
      'minority_type',
      'is_cwsn',
      'cwsn_type',
      'medical_info',
    ],
    readable: 'admission_number',
  },
  { table: 'tenant_user_profiles', columns: ['religion'], readable: 'first_name' },
  { table: 'user_profiles', columns: ['religion'], readable: 'first_name' },
  {
    table: 'user_identifiers',
    columns: ['value_encrypted', 'value_hash', 'value_plain', 'value_masked'],
    readable: 'type',
  },
  { table: 'enquiries', columns: ['special_needs'], readable: 'student_name' },
  { table: 'admission_applications', columns: ['form_data'], readable: 'status' },
];

const CASES = WITHHELD.flatMap(({ table, columns }) => columns.map((column) => [table, column]));

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

describe('what a reseller may read about a person', () => {
  it.each(CASES)('should refuse reading %s.%s', async (table, column) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT ${column} FROM ${table}`);
    });
  });

  it.each(CASES)('should refuse filtering %s by %s', async (table, column) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT id FROM ${table} WHERE ${column} IS NOT NULL`);
    });
  });

  it.each(
    WITHHELD.map(({ table }) => [table]),
  )('should refuse reading the whole row of %s, also through its view', async (table) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT * FROM ${table}`);
      await expectRefused(client, DENIED, `SELECT id FROM ${table}_live`);
    });
  });

  it.each(
    WITHHELD.map(({ table, readable }) => [table, readable]),
  )('should still let it read %s.%s', async (table, readable) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      const res = await client.query(
        `SELECT id, ${readable} FROM ${table} WHERE deleted_at IS NULL`,
      );
      expect(res.rows).toEqual([]);
    });
  });
});

describe('what an institute may read about its own people', () => {
  it.each(CASES)('should still let it read %s.%s', async (table, column) => {
    await inRolledBackTx(pool, async (client) => {
      await asInstitute(client, NOBODY);
      const res = await client.query(`SELECT ${column} FROM ${table}_live`);
      expect(res.rows).toEqual([]);
    });
  });
});
