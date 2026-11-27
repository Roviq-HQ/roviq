/**
 * Every row policy of the institute, reseller and person roles refuses a row that belongs to
 * somebody else: reading it, inserting it, changing it, deleting it, and turning one of the
 * caller's own rows into it (ROV-388). The tables and policies come from the catalog, so a new
 * table is covered the day it is created.
 *
 * A valid row of most tables needs many other rows, so each table is tried on a copy: a table
 * of the same name and columns in a scratch schema, with the role's policies exactly as the
 * catalog defines them on the real table, and every privilege granted, so that only the
 * policies decide. Everything happens in a transaction that is rolled back.
 *
 * - The foreign row names another institute and another reseller; every other id is random.
 * - The own row names the caller's institute and reseller; every other id is the caller's
 *   user id.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SUPERUSER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const ROLES = ['roviq_app', 'roviq_reseller', 'roviq_user'] as const;
type Role = (typeof ROLES)[number];

/** Refused by a row policy: `new row violates row-level security policy`. */
const ROW_SECURITY = '42501';

/**
 * What a policy lets a caller do with a row that is not theirs, each with the reason it may.
 * Key: `<role> <table>: <what happened>`.
 */
const ALLOWED_ON_A_FOREIGN_ROW: Readonly<Record<string, string>> = {
  'roviq_app auth_events: inserted the foreign row':
    'A sign-in event is written before the institute is known; the table is append-only and the role cannot read it back.',
  'roviq_reseller auth_events: inserted the foreign row':
    'A sign-in event is written before the reseller is known; the table is append-only and the role cannot read it back.',
};

/**
 * What the caller's own row needs, besides the ids, before a table's update policy lets the
 * caller change it. Key: `<role> <table>`. A table missing here shows up in the second list
 * of the main test, because its move was never attempted.
 */
const OWN_ROW_ALSO_NEEDS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  'roviq_app notifications': { scope: 'institute' },
  'roviq_reseller notifications': { scope: 'reseller' },
  'roviq_user notifications': { scope: 'platform' },
  // A reseller owns only the files that belong to no institute.
  'roviq_reseller files': { tenant_id: null },
};

interface Policy {
  name: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  using: string | null;
  check: string | null;
}

interface Pair {
  table: string;
  role: Role;
  policies: Policy[];
}

interface Party {
  resellerId: string;
  instituteId: string;
  userId: string;
}

interface Attempt {
  /** What the role did to a foreign row although it should not have. */
  allowed: string[];
  /** True when the role could update its own row, so the move was a real attempt. */
  ownRowReached: boolean;
  hasUpdatePolicy: boolean;
}

let owner: pg.Pool;
let pairs: Pair[];

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  const { rows } = await owner.query<{ tablename: string; role: Role } & Policy>(
    `SELECT p.tablename::text, r::text AS role, p.policyname::text AS name, p.cmd AS command,
            p.qual AS using, p.with_check AS check
       FROM pg_policies p
       CROSS JOIN LATERAL unnest(p.roles) AS r
       JOIN pg_class c ON c.relname = p.tablename
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE p.schemaname = 'public' AND r::text = ANY($1) AND NOT c.relispartition
      ORDER BY 1, 2, 3`,
    [[...ROLES]],
  );
  const byPair = new Map<string, Pair>();
  for (const row of rows) {
    const key = `${row.role} ${row.tablename}`;
    const pair = byPair.get(key) ?? { table: row.tablename, role: row.role, policies: [] };
    pair.policies.push({
      name: row.name,
      command: row.command,
      using: row.using,
      check: row.check,
    });
    byPair.set(key, pair);
  }
  pairs = [...byPair.values()];
});

afterAll(async () => {
  await owner.end();
});

/** Run `fn` as the owner in a transaction that is always rolled back. */
async function rolledBack<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** A reseller with one institute, and the id of a person. */
async function createParty(client: pg.PoolClient): Promise<Party> {
  const tag = randomUUID().slice(0, 8);
  const reseller = await client.query<{ id: string }>(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-388 ${tag}`, `rov388-${tag}`, SYSTEM],
  );
  const institute = await client.query<{ id: string }>(
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [JSON.stringify({ en: `ROV-388 ${tag}` }), `rov388-inst-${tag}`, reseller.rows[0].id, SYSTEM],
  );
  return {
    resellerId: reseller.rows[0].id,
    instituteId: institute.rows[0].id,
    userId: randomUUID(),
  };
}

const quoted = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const has = (policies: Policy[], command: Policy['command']): boolean =>
  policies.some((policy) => policy.command === command || policy.command === 'ALL');

/** Runs a statement that may be refused, keeping the transaction usable. */
async function attempt(
  client: pg.PoolClient,
  text: string,
  params: unknown[],
): Promise<{ rows: number } | { refused: string }> {
  await client.query('SAVEPOINT attempt');
  try {
    const result = await client.query(text, params);
    await client.query('RELEASE SAVEPOINT attempt');
    return { rows: result.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    return { refused: error instanceof pg.DatabaseError ? (error.code ?? '') : String(error) };
  }
}

/** Builds the copy of `table` with `policies` for `role` and returns its name and id columns. */
async function buildCopy(
  client: pg.PoolClient,
  { table, role, policies }: Pair,
): Promise<{ copy: string; ids: string[] }> {
  const copy = `rls_probe.${quoted(table)}`;
  await client.query('CREATE SCHEMA rls_probe');
  await client.query(`CREATE TABLE ${copy} (LIKE public.${quoted(table)} INCLUDING DEFAULTS)`);
  const { rows: columns } = await client.query<{ name: string; type: string }>(
    `SELECT column_name::text AS name, udt_name::text AS type FROM information_schema.columns
      WHERE table_schema = 'rls_probe' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  // A row needs no other row to exist: only the ids are filled in.
  for (const column of columns) {
    await client.query(`ALTER TABLE ${copy} ALTER COLUMN ${quoted(column.name)} DROP NOT NULL`);
  }
  await client.query(`ALTER TABLE ${copy} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${copy} FORCE ROW LEVEL SECURITY`);
  await client.query(`GRANT USAGE ON SCHEMA rls_probe TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${copy} TO ${role}`);
  for (const policy of policies) {
    const using = policy.using === null ? '' : ` USING (${policy.using})`;
    const check = policy.check === null ? '' : ` WITH CHECK (${policy.check})`;
    await client.query(
      `CREATE POLICY ${quoted(policy.name)} ON ${copy} FOR ${policy.command} TO ${role}${using}${check}`,
    );
  }

  const ids = columns.filter((column) => column.type === 'uuid').map((column) => column.name);
  expect(ids.length, `${table} has no id column to tell rows apart`).toBeGreaterThan(0);
  return { copy, ids };
}

/**
 * Tries each thing `role` must not be able to do to a row of `other` on the copy of `table`,
 * while its own context is `caller`.
 */
async function tryForeignRow(
  client: pg.PoolClient,
  pair: Pair,
  caller: Party,
  other: Party,
): Promise<Attempt> {
  const { table, role, policies } = pair;
  const { copy, ids } = await buildCopy(client, pair);
  const idList = ids.map(quoted).join(', ');
  const places = ids.map((_, index) => `$${index + 1}`).join(', ');
  const rowOf = (party: Party, otherId: () => string): string[] =>
    ids.map((name) => {
      if (name === 'tenant_id' || (name === 'id' && table === 'institutes'))
        return party.instituteId;
      if (name === 'reseller_id' || (name === 'id' && table === 'resellers'))
        return party.resellerId;
      return otherId();
    });
  const foreignRow = rowOf(other, randomUUID);
  const insert = `INSERT INTO ${copy} (${idList}) VALUES (${places})`;
  const asOwner = async <T>(fn: () => Promise<T>): Promise<T> => {
    await client.query('RESET ROLE');
    return fn();
  };
  const asRole = async (): Promise<void> => {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      caller.instituteId,
    ]);
    await client.query(`SELECT set_config('app.current_reseller_id', $1, true)`, [
      caller.resellerId,
    ]);
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [caller.userId]);
  };
  const stored = async (): Promise<number> =>
    asOwner(async () => (await client.query(`SELECT 1 FROM ${copy}`)).rowCount ?? 0);

  const allowed: string[] = [];

  // Insert: the role may not create the foreign row.
  if (has(policies, 'INSERT')) {
    await asRole();
    const inserted = await attempt(client, insert, foreignRow);
    if ('rows' in inserted) allowed.push('inserted the foreign row');
    else expect(inserted.refused, `${role} ${table}: insert`).toBe(ROW_SECURITY);
    await asOwner(() => client.query(`DELETE FROM ${copy}`));
  }

  await asOwner(() => client.query(insert, foreignRow));
  expect(await stored(), `${table}: the foreign row was not stored`).toBe(1);

  // Read.
  await asRole();
  const read = await client.query(`SELECT 1 FROM ${copy}`);
  if ((read.rowCount ?? 0) > 0) allowed.push('read the foreign row');

  // Update: constants only, so that nothing but the update policy decides which rows are hit.
  if (has(policies, 'UPDATE')) {
    const same = ids.map((name, index) => `${quoted(name)} = $${index + 1}`).join(', ');
    const updated = await attempt(client, `UPDATE ${copy} SET ${same}`, foreignRow);
    if ('refused' in updated || updated.rows > 0)
      allowed.push('reached the foreign row with an update');
  }

  // Delete.
  if (has(policies, 'DELETE')) {
    await attempt(client, `DELETE FROM ${copy}`, []);
    if ((await stored()) === 0) allowed.push('deleted the foreign row');
  }

  // Move: one of the caller's own rows may not become somebody else's.
  let ownRowReached = false;
  if (has(policies, 'UPDATE')) {
    await asOwner(() => client.query(`DELETE FROM ${copy}`));
    await asOwner(() =>
      client.query(
        insert,
        rowOf(caller, () => caller.userId),
      ),
    );
    for (const [column, value] of Object.entries(OWN_ROW_ALSO_NEEDS[`${role} ${table}`] ?? {})) {
      await client.query(`UPDATE ${copy} SET ${quoted(column)} = $1`, [value]);
    }
    await asRole();
    const moved = await attempt(
      client,
      `UPDATE ${copy} SET ${ids.map((name, index) => `${quoted(name)} = $${index + 1}`).join(', ')}`,
      rowOf(other, randomUUID),
    );
    if ('rows' in moved && moved.rows > 0) {
      ownRowReached = true;
      allowed.push('turned its own row into a foreign row');
    } else if ('refused' in moved) {
      ownRowReached = true;
      expect(moved.refused, `${role} ${table}: move`).toBe(ROW_SECURITY);
    }
  }
  await client.query('RESET ROLE');
  // A role whose update policies pass no row has no row of its own to give away.
  const canUpdate = policies.some(
    (policy) =>
      (policy.command === 'UPDATE' || policy.command === 'ALL') && policy.using !== 'false',
  );
  return { allowed, ownRowReached, hasUpdatePolicy: canUpdate };
}

async function tryPair(pair: Pair): Promise<Attempt> {
  return rolledBack(async (client) => {
    const caller = await createParty(client);
    const other = await createParty(client);
    return tryForeignRow(client, pair, caller, other);
  });
}

const pairOf = (role: Role, table: string): Pair => {
  const pair = pairs.find((item) => item.role === role && item.table === table);
  if (!pair) throw new Error(`no policy of ${role} on ${table}`);
  return pair;
};

/** The pair with one policy replaced: what a weakened policy would look like. */
const weakened = (pair: Pair, name: string, change: Partial<Policy>): Pair => ({
  ...pair,
  policies: pair.policies.map((policy) =>
    policy.name === name ? { ...policy, ...change } : policy,
  ),
});

describe('row policies refuse a row that belongs to somebody else', () => {
  it('should find the policies of every role in the catalog', () => {
    // A query that silently returned nothing would make the next test pass on no table at all.
    expect(pairs.length).toBeGreaterThan(150);
    expect(pairs.map((pair) => `${pair.role} ${pair.table}`)).toEqual(
      expect.arrayContaining([
        'roviq_app student_profiles',
        'roviq_reseller institutes',
        'roviq_user users',
      ]),
    );
  });

  it('should let no role read, insert, change, delete or give away a foreign row, on any table', async () => {
    const allowed: string[] = [];
    const notReached: string[] = [];
    for (const pair of pairs) {
      const result = await tryPair(pair);
      const key = `${pair.role} ${pair.table}`;
      allowed.push(...result.allowed.map((what) => `${key}: ${what}`));
      if (result.hasUpdatePolicy && !result.ownRowReached) notReached.push(key);
    }
    expect(allowed.sort()).toEqual(Object.keys(ALLOWED_ON_A_FOREIGN_ROW).sort());
    // A table listed here was not tried: say in OWN_ROW_ALSO_NEEDS what its own row needs.
    expect(notReached.sort()).toEqual([]);
  });

  // The proof that each attempt can fail: the same copy, with one policy that refuses nothing.
  it.each([
    ['read', 'sections_app_select', { using: 'true' }, 'read the foreign row'],
    ['insert', 'sections_app_insert', { check: 'true' }, 'inserted the foreign row'],
    ['update', 'sections_app_update', { using: 'true' }, 'reached the foreign row with an update'],
    ['delete', 'sections_app_delete', { using: 'true' }, 'deleted the foreign row'],
    ['move', 'sections_app_update', { check: 'true' }, 'turned its own row into a foreign row'],
  ] as const)('should notice a policy that lets every row through on %s', async (_what, name, change, expected) => {
    const result = await tryPair(weakened(pairOf('roviq_app', 'sections'), name, change));
    expect(result.allowed).toContain(expected);
  });

  it('should reach the caller’s own row through the real policies', async () => {
    // The proof that the copy carries the policies, not a refusal of everything.
    const result = await tryPair(pairOf('roviq_app', 'sections'));
    expect(result).toEqual({ allowed: [], ownRowReached: true, hasUpdatePolicy: true });
  });
});
