import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_USER_ID } from '../constants';
import { i18nLocaleEquals, i18nNameSearch } from '../i18n';
import { TEST_SUPERUSER_URL } from './test-helpers';

let pool: pg.Pool;
beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
});
afterAll(async () => {
  await pool.end();
});

describe('i18n search (real PostgreSQL)', () => {
  const name = { en: 'Science 100%_Lab', hi: 'विज्ञान', ta: 'அறிவியல்' };
  it.each(['science', 'विज्ञान', 'அறிவியல்', '100%_'])('finds translation text %s', async (query) => {
    const db = drizzle({ client: pool });
    const result = await db.execute(
      sql`SELECT ${i18nNameSearch(sql`${JSON.stringify(name)}::jsonb`, query)} AS matches`,
    );
    expect(result.rows).toEqual([{ matches: true }]);
  });
  it.each([
    'zz',
    'ta',
    '%Lab',
    "' OR true --",
  ])('does not match locale keys or interpret patterns: %s', async (query) => {
    const db = drizzle({ client: pool });
    const result = await db.execute(
      sql`SELECT ${i18nNameSearch(sql`${JSON.stringify(name)}::jsonb`, query)} AS matches`,
    );
    expect(result.rows).toEqual([{ matches: false }]);
  });
  it('matches an exact translation in the requested locale', async () => {
    const db = drizzle({ client: pool });
    const column = sql`${JSON.stringify(name)}::jsonb`;
    const result = await db.execute(
      sql`SELECT ${i18nLocaleEquals(column, 'ta', name.ta)} AS exact, ${i18nLocaleEquals(column, 'hi', name.ta)} AS wrong_locale`,
    );
    expect(result.rows).toEqual([{ exact: true, wrong_locale: false }]);
  });
  it('has both containment and substring indexes, with RLS enforced', async () => {
    const rows = await pool.query<{ tablename: string; indexname: string; indexdef: string }>(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE indexname ~ '^idx_(institutes|roles|sections|plans)_name_(gin|trgm)$' ORDER BY indexname`,
    );
    expect(rows.rows).toHaveLength(8);
    for (const index of rows.rows) expect(index.indexdef).toContain('USING gin');
    const rls = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('institutes','roles','sections','plans') ORDER BY relname`,
    );
    expect(rls.rows).toEqual(
      ['institutes', 'plans', 'roles', 'sections'].map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      })),
    );
  });
  it('can use the trigram index for substring lookup', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = await client.query(
        `EXPLAIN (FORMAT JSON) SELECT id FROM institutes WHERE i18n_text_to_string(name) ILIKE '%Science%'`,
      );
      expect(JSON.stringify(plan.rows)).toContain('idx_institutes_name_trgm');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('defaults new institutes to English and rejects a default outside enabled languages', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO institutes (name,slug,created_by,updated_by) VALUES ('{"en":"Locale fixture"}'::jsonb,$1,$2,$2) RETURNING supported_locales,default_locale`,
        [`locale-${randomUUID()}`, SYSTEM_USER_ID],
      );
      expect(result.rows).toEqual([{ supported_locales: ['en'], default_locale: 'en' }]);
      await expect(
        client.query(
          `INSERT INTO institutes (name,slug,supported_locales,default_locale,created_by,updated_by) VALUES ('{"en":"Invalid"}'::jsonb,$1,'["en"]'::jsonb,'ta',$2,$2)`,
          [`locale-${randomUUID()}`, SYSTEM_USER_ID],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
