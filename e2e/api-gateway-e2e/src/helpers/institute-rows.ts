/**
 * Reads, with the superuser connection, which ids belong to an institute. Read-only: the
 * two-institute spec needs the full list of another institute's ids to look for them in
 * responses, and no API may return that list.
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
} as const;

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
