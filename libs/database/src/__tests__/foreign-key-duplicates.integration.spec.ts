import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SUPERUSER_URL } from './test-helpers';

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 1 });
});

afterAll(async () => {
  await pool.end();
});

describe('foreign keys', () => {
  // A second key on the same columns doubles every insert and update check.
  it('declares each foreign key once', async () => {
    const { rows } = await pool.query<{ table: string; names: string[] }>(`
      SELECT conrelid::regclass::text AS "table", array_agg(conname::text ORDER BY conname) AS names
      FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      GROUP BY conrelid, conkey, confrelid, confkey
      HAVING count(*) > 1
      ORDER BY 1
    `);
    expect(rows).toEqual([]);
  });
});
