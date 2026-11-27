/**
 * Reads, with the superuser connection, which ids belong to an institute, and counts its rows.
 * Read-only: the two-institute spec needs the full list of another institute's ids to look
 * for them in responses, and no API may return that list.
 */
import type pg from 'pg';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const SUPERUSER_URL =
  process.env.DATABASE_URL_E2E_MIGRATE ??
  process.env.DATABASE_URL_TEST_MIGRATE ??
  `postgresql://roviq:roviq_dev@localhost:${process.env.E2E_POSTGRES_PORT ?? '5435'}/roviq_test`;

/** Base tables that carry both `id` and `tenant_id` as uuid columns. */
async function tenantTables(pool: pg.Pool): Promise<string[]> {
  const res = await pool.query<{ table_name: string }>(
    `SELECT t.table_name
       FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND EXISTS (SELECT 1 FROM information_schema.columns c
                     WHERE c.table_schema = 'public' AND c.table_name = t.table_name
                       AND c.column_name = 'tenant_id' AND c.data_type = 'uuid')
        AND EXISTS (SELECT 1 FROM information_schema.columns c
                     WHERE c.table_schema = 'public' AND c.table_name = t.table_name
                       AND c.column_name = 'id' AND c.data_type = 'uuid')
        AND NOT EXISTS (SELECT 1 FROM pg_inherits i
                         WHERE i.inhrelid = format('public.%I', t.table_name)::regclass)
      ORDER BY t.table_name`,
  );
  return res.rows.map((row) => row.table_name);
}

/**
 * Every id that belongs to the given institutes and to nobody else: the institute ids, the
 * primary key of each of their rows, and the users whose only memberships are in them.
 * The value says where the id comes from, for the failure message.
 */
export async function collectInstituteIds(
  pool: pg.Pool,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const tenantId of tenantIds) ids.set(tenantId, 'institutes');

  for (const table of await tenantTables(pool)) {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM "${table}" WHERE tenant_id = ANY($1::uuid[])`,
      [tenantIds],
    );
    for (const row of res.rows) ids.set(row.id, table);
  }

  const users = await pool.query<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE EXISTS (SELECT 1 FROM memberships m
                     WHERE m.user_id = u.id AND m.tenant_id = ANY($1::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM memberships m
                         WHERE m.user_id = u.id AND m.tenant_id <> ALL($1::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM platform_memberships p WHERE p.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM reseller_memberships r WHERE r.user_id = u.id)`,
    [tenantIds],
  );
  for (const row of users.rows) ids.set(row.id, 'users');
  return ids;
}

/** Every id that belongs to a reseller itself: its team, its roles and its plans. */
export async function collectResellerIds(
  pool: pg.Pool,
  resellerId: string,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>([[resellerId, 'resellers']]);
  for (const table of ['reseller_memberships', 'roles', 'plans']) {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM "${table}" WHERE reseller_id = $1`,
      [resellerId],
    );
    for (const row of res.rows) ids.set(row.id, table);
  }
  return ids;
}

/** Kinds that are not "the first row of the table with this name". */
const SPECIAL_KINDS = {
  institutes: `SELECT $1::uuid AS id`,
  resellers: `SELECT reseller_id AS id FROM institutes WHERE id = $1`,
  reseller_memberships: `SELECT rm.id FROM reseller_memberships rm
    JOIN institutes i ON i.reseller_id = rm.reseller_id WHERE i.id = $1 ORDER BY rm.id LIMIT 1`,
  plans: `SELECT p.id FROM plans p
    JOIN institutes i ON i.reseller_id = p.reseller_id WHERE i.id = $1 ORDER BY p.id LIMIT 1`,
  payment_gateway_configs: `SELECT g.id FROM payment_gateway_configs g
    JOIN institutes i ON i.reseller_id = g.reseller_id WHERE i.id = $1 ORDER BY g.id LIMIT 1`,
  institute_groups: `SELECT group_id AS id FROM institutes WHERE id = $1`,
  // A person of this institute only: one who is also elsewhere is not foreign to everyone.
  users: `SELECT m.user_id AS id FROM memberships m
    WHERE m.tenant_id = $1
      AND NOT EXISTS (SELECT 1 FROM memberships o
                       WHERE o.user_id = m.user_id AND o.tenant_id <> m.tenant_id)
      AND NOT EXISTS (SELECT 1 FROM platform_memberships p WHERE p.user_id = m.user_id)
      AND NOT EXISTS (SELECT 1 FROM reseller_memberships r WHERE r.user_id = m.user_id)
    ORDER BY m.user_id LIMIT 1`,
  student_memberships: `SELECT membership_id AS id FROM student_profiles
    WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
  staff_memberships: `SELECT membership_id AS id FROM staff_profiles
    WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
} as const;

/** Every kind `pickInstituteIds` can return a row for; a kind outside it is a typing error. */
export async function knownKinds(pool: pg.Pool): Promise<Set<string>> {
  return new Set([...(await tenantTables(pool)), ...Object.keys(SPECIAL_KINDS)]);
}

/** One id of each kind for the institute: a table name, or a key of `SPECIAL_KINDS`. */
export async function pickInstituteIds(
  pool: pg.Pool,
  tenantId: string,
): Promise<Record<string, string>> {
  const picked: Record<string, string> = {};
  for (const table of await tenantTables(pool)) {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM "${table}" WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
      [tenantId],
    );
    const id = res.rows[0]?.id;
    if (id) picked[table] = id;
  }
  for (const [kind, sql] of Object.entries(SPECIAL_KINDS)) {
    const res = await pool.query<{ id: string | null }>(sql, [tenantId]);
    const id = res.rows[0]?.id;
    if (id) picked[kind] = id;
  }
  return picked;
}

export interface ForeignIdHit {
  id: string;
  /** The table the id belongs to. */
  source: string;
}

/**
 * Every id of `foreign` found in the response. Ids the request itself sent may be repeated
 * in an error message, so they are ignored there, and only there.
 */
export function findForeignIds(
  response: { data?: unknown; errors?: unknown },
  foreign: ReadonlyMap<string, string>,
  sentIds: readonly string[] = [],
): ForeignIdHit[] {
  const hits = new Map<string, string>();
  const scan = (value: unknown, ignore: ReadonlySet<string>) => {
    if (value === undefined || value === null) return;
    for (const match of JSON.stringify(value).matchAll(UUID)) {
      const id = match[0].toLowerCase();
      const source = foreign.get(id);
      if (source !== undefined && !ignore.has(id)) hits.set(id, source);
    }
  };
  scan(response.data, new Set());
  scan(response.errors, new Set(sentIds.map((id) => id.toLowerCase())));
  return [...hits].map(([id, source]) => ({ id, source }));
}

/** What is watched for change: institutes, resellers, and everyone who belongs to them. */
export interface WatchedOwners {
  tenantIds: readonly string[];
  resellerIds: readonly string[];
}

interface WatchedTable {
  name: string;
  owner: 'tenant_id' | 'reseller_id' | 'user_id' | 'id';
  hasUpdatedAt: boolean;
  hasDeletedAt: boolean;
}

/** Base tables that belong to an institute, a reseller or a person, and what each records. */
async function watchedTables(pool: pg.Pool): Promise<WatchedTable[]> {
  const res = await pool.query<{ table_name: string; columns: string[] }>(
    `SELECT t.table_name, array_agg(c.column_name::text) AS columns
       FROM information_schema.tables t
       JOIN information_schema.columns c
         ON c.table_schema = 'public' AND c.table_name = t.table_name
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (SELECT 1 FROM pg_inherits i
                         WHERE i.inhrelid = format('public.%I', t.table_name)::regclass)
      GROUP BY t.table_name
      ORDER BY t.table_name`,
  );
  const tables: WatchedTable[] = [];
  for (const { table_name: name, columns } of res.rows) {
    const has = (column: string) => columns.includes(column);
    const facts = { hasUpdatedAt: has('updated_at'), hasDeletedAt: has('deleted_at') };
    if (name === 'institutes' || name === 'resellers' || name === 'users') {
      tables.push({ name, owner: 'id', ...facts });
    }
    if (has('tenant_id')) tables.push({ name, owner: 'tenant_id', ...facts });
    if (has('reseller_id') && name !== 'institutes') {
      tables.push({ name, owner: 'reseller_id', ...facts });
    }
    if (has('user_id') && !has('tenant_id') && !has('reseller_id')) {
      tables.push({ name, owner: 'user_id', ...facts });
    }
  }
  return tables;
}

/**
 * One line per table and owner: how many rows, the latest `updated_at`, and how many are
 * deleted. Read-only. Two snapshots that are equal mean no row of the watched institutes,
 * resellers and their people was added, changed or removed in between.
 */
export async function snapshotRows(
  pool: pg.Pool,
  watched: WatchedOwners,
  ignoredTables: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const people = `(SELECT user_id FROM memberships WHERE tenant_id = ANY($1::uuid[])
    UNION SELECT user_id FROM reseller_memberships WHERE reseller_id = ANY($2::uuid[]))`;
  const parts: string[] = [];
  for (const table of await watchedTables(pool)) {
    if (ignoredTables.has(table.name)) continue;
    const updated = table.hasUpdatedAt ? 'max(updated_at)::text' : 'NULL::text';
    const deleted = table.hasDeletedAt ? 'count(deleted_at)' : '0::bigint';
    const select = (owner: string, where: string) =>
      `SELECT '${table.name}'::text AS tbl, ${owner} AS owner, count(*) AS n,
              ${updated} AS u, ${deleted} AS d
         FROM "${table.name}" WHERE ${where} GROUP BY 2`;
    if (table.owner === 'tenant_id') {
      parts.push(select('tenant_id::text', 'tenant_id = ANY($1::uuid[])'));
    } else if (table.owner === 'reseller_id') {
      parts.push(select('reseller_id::text', 'reseller_id = ANY($2::uuid[])'));
    } else if (table.owner === 'user_id') {
      parts.push(select(`'people'::text`, `user_id IN ${people}`));
    } else if (table.name === 'users') {
      parts.push(select(`'people'::text`, `id IN ${people}`));
    } else {
      const ids = table.name === 'institutes' ? '$1' : '$2';
      parts.push(select('id::text', `id = ANY(${ids}::uuid[])`));
    }
  }
  const res = await pool.query<{ tbl: string; owner: string; n: string; u: string; d: string }>(
    parts.join('\nUNION ALL\n'),
    [watched.tenantIds, watched.resellerIds],
  );
  const lines = new Map<string, string>();
  for (const row of res.rows) {
    lines.set(
      `${row.tbl} of ${row.owner}`,
      `${row.n} rows, last change ${row.u}, ${row.d} deleted`,
    );
  }
  return lines;
}

/** What differs between two snapshots, one sentence per table and owner. */
export function snapshotChanges(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const changes: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key) ?? 'no rows';
    const is = after.get(key) ?? 'no rows';
    if (was !== is) changes.push(`${key}: ${was} → ${is}`);
  }
  return changes.sort();
}
