/**
 * Row and column security of the platform user tables (ROV-279): `users`, `phone_numbers`,
 * `auth_providers`. Each test builds two resellers with one institute each, assumes a database
 * role and attempts the read or write; nothing goes through the application.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 4 });
});

afterAll(async () => {
  await pool.end();
});

interface Side {
  resellerId: string;
  instituteId: string;
  /** On the reseller's team, member of no institute. */
  staffUserId: string;
  /** Member of this side's institute only. */
  memberUserId: string;
}

interface World {
  a: Side;
  b: Side;
}

async function insertUser(client: pg.PoolClient, tag: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO users (email, username, password_hash, created_by, updated_by)
     VALUES ($1, $2, 'not-a-real-hash', $3, $3) RETURNING id`,
    [`rov279-${tag}@test.local`, `rov279_${tag}`, SYSTEM],
  );
  return res.rows[0].id;
}

async function insertPhone(client: pg.PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO phone_numbers (user_id, country_code, number, is_primary, created_by, updated_by)
     VALUES ($1, '91', $2, true, $3, $3)`,
    [userId, `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`, SYSTEM],
  );
}

async function insertSide(client: pg.PoolClient): Promise<Side> {
  const tag = randomUUID().slice(0, 8);
  const reseller = await client.query<{ id: string }>(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-279 ${tag}`, `rov279-${tag}`, SYSTEM],
  );
  const resellerId = reseller.rows[0].id;
  const institute = await client.query<{ id: string }>(
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [JSON.stringify({ en: `ROV-279 ${tag}` }), `rov279-inst-${tag}`, resellerId, SYSTEM],
  );
  const instituteId = institute.rows[0].id;
  const resellerRole = await client.query<{ id: string }>(
    `INSERT INTO roles (scope, reseller_id, name, abilities, created_by, updated_by)
     VALUES ('reseller', $1, '{"en":"rov279_reseller"}', '[]', $2, $2) RETURNING id`,
    [resellerId, SYSTEM],
  );
  const instituteRole = await client.query<{ id: string }>(
    `INSERT INTO roles (scope, tenant_id, name, abilities, created_by, updated_by)
     VALUES ('institute', $1, '{"en":"rov279_institute"}', '[]', $2, $2) RETURNING id`,
    [instituteId, SYSTEM],
  );

  const staffUserId = await insertUser(client, `staff_${tag}`);
  await client.query(
    `INSERT INTO reseller_memberships (user_id, reseller_id, role_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4)`,
    [staffUserId, resellerId, resellerRole.rows[0].id, SYSTEM],
  );
  const memberUserId = await insertUser(client, `member_${tag}`);
  await client.query(
    `INSERT INTO memberships (user_id, tenant_id, role_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, 'ACTIVE', $4, $4)`,
    [memberUserId, instituteId, instituteRole.rows[0].id, SYSTEM],
  );
  await insertPhone(client, memberUserId);
  await insertPhone(client, staffUserId);
  await client.query(
    `INSERT INTO auth_providers (user_id, provider, provider_user_id, created_by, updated_by)
     VALUES ($1, 'passkey', $2, $3, $3)`,
    [memberUserId, `cred-${tag}`, SYSTEM],
  );
  return { resellerId, instituteId, staffUserId, memberUserId };
}

/**
 * Builds the world as `roviq_admin`, then runs `fn` with it in the same transaction, which is
 * always rolled back. `fn` switches role with `as`.
 */
async function withWorld(
  fn: (client: pg.PoolClient, world: World) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE roviq_admin');
    const world = { a: await insertSide(client), b: await insertSide(client) };
    await fn(client, world);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function asInstitute(client: pg.PoolClient, tenantId: string): Promise<void> {
  await client.query('SET LOCAL ROLE roviq_app');
  await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
}

async function asReseller(client: pg.PoolClient, resellerId: string): Promise<void> {
  await client.query('SET LOCAL ROLE roviq_reseller');
  await client.query(`SELECT set_config('app.current_reseller_id', $1, true)`, [resellerId]);
}

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

async function visibleUserIds(
  client: pg.PoolClient,
  relation: 'users' | 'users_live',
  ids: string[],
): Promise<string[]> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM ${relation} WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [ids],
  );
  return res.rows.map((r) => r.id);
}

async function visiblePhoneOwners(
  client: pg.PoolClient,
  relation: 'phone_numbers' | 'phone_numbers_live',
  ids: string[],
): Promise<string[]> {
  const res = await client.query<{ user_id: string }>(
    `SELECT user_id FROM ${relation} WHERE user_id = ANY($1::uuid[]) ORDER BY user_id`,
    [ids],
  );
  return res.rows.map((r) => r.user_id);
}

const everyone = (w: World) => [
  w.a.memberUserId,
  w.a.staffUserId,
  w.b.memberUserId,
  w.b.staffUserId,
];
const sorted = (ids: string[]) => [...ids].sort();

describe('ROV-279: row security is forced on the platform user tables', () => {
  it('should have RLS enabled and forced on users, phone_numbers and auth_providers', async () => {
    const res = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('users', 'phone_numbers', 'auth_providers') AND relkind = 'r'
       ORDER BY relname`,
    );
    expect(res.rows).toEqual([
      { relname: 'auth_providers', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'phone_numbers', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'users', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});

describe('ROV-279: an institute reads only its own members', () => {
  it('should show users and users_live of its members and no one else', async () => {
    await withWorld(async (client, w) => {
      await asInstitute(client, w.a.instituteId);
      expect(await visibleUserIds(client, 'users', everyone(w))).toEqual([w.a.memberUserId]);
      expect(await visibleUserIds(client, 'users_live', everyone(w))).toEqual([w.a.memberUserId]);
    });
  });

  it('should show phone numbers of its members and no one else', async () => {
    await withWorld(async (client, w) => {
      await asInstitute(client, w.a.instituteId);
      expect(await visiblePhoneOwners(client, 'phone_numbers', everyone(w))).toEqual([
        w.a.memberUserId,
      ]);
      expect(await visiblePhoneOwners(client, 'phone_numbers_live', everyone(w))).toEqual([
        w.a.memberUserId,
      ]);
    });
  });

  it('should refuse every write to phone_numbers', async () => {
    await withWorld(async (client, w) => {
      await asInstitute(client, w.a.instituteId);
      await expectRefused(
        client,
        /permission denied for table phone_numbers/,
        `INSERT INTO phone_numbers (user_id, country_code, number, created_by, updated_by)
         VALUES ($1, '91', '9000000001', $1, $1)`,
        [w.a.memberUserId],
      );
      await expectRefused(
        client,
        /permission denied for table phone_numbers/,
        `UPDATE phone_numbers SET label = 'x' WHERE user_id = $1`,
        [w.a.memberUserId],
      );
      await expectRefused(
        client,
        /permission denied for table phone_numbers/,
        `DELETE FROM phone_numbers WHERE user_id = $1`,
        [w.a.memberUserId],
      );
    });
  });

  it('should refuse any access to auth_providers and its live view', async () => {
    await withWorld(async (client, w) => {
      await asInstitute(client, w.a.instituteId);
      await expectRefused(
        client,
        /permission denied for table auth_providers/,
        'SELECT id FROM auth_providers',
      );
      await expectRefused(
        client,
        /permission denied for view auth_providers_live/,
        'SELECT id FROM auth_providers_live',
      );
      await expectRefused(
        client,
        /permission denied for table auth_providers/,
        `INSERT INTO auth_providers (user_id, provider, created_by, updated_by)
         VALUES ($1, 'passkey', $1, $1)`,
        [w.a.memberUserId],
      );
    });
  });

  it('should refuse password_hash and token_version but read the other columns', async () => {
    await withWorld(async (client, w) => {
      await asInstitute(client, w.a.instituteId);
      await expectRefused(
        client,
        /permission denied for table users/,
        'SELECT password_hash FROM users WHERE id = $1',
        [w.a.memberUserId],
      );
      await expectRefused(
        client,
        /permission denied for table users/,
        'SELECT token_version FROM users WHERE id = $1',
        [w.a.memberUserId],
      );
      const live = await client.query('SELECT * FROM users_live WHERE id = $1', [w.a.memberUserId]);
      expect(live.rows).toHaveLength(1);
      expect(Object.keys(live.rows[0])).not.toContain('password_hash');
      expect(Object.keys(live.rows[0])).not.toContain('token_version');
    });
  });
});

describe('ROV-279: a reseller reads only its institutes and its team', () => {
  it("should show users of its institutes and its team, not the other reseller's", async () => {
    await withWorld(async (client, w) => {
      await asReseller(client, w.a.resellerId);
      const expected = sorted([w.a.memberUserId, w.a.staffUserId]);
      expect(await visibleUserIds(client, 'users', everyone(w))).toEqual(expected);
      expect(await visibleUserIds(client, 'users_live', everyone(w))).toEqual(expected);
    });
  });

  it('should refuse reading phone numbers, also of its own institutes and team', async () => {
    await withWorld(async (client, w) => {
      await asReseller(client, w.a.resellerId);
      await expectRefused(
        client,
        /permission denied for table phone_numbers/,
        'SELECT user_id FROM phone_numbers WHERE user_id = $1',
        [w.a.memberUserId],
      );
      await expectRefused(
        client,
        /permission denied for table phone_numbers/,
        'SELECT user_id FROM phone_numbers_live WHERE user_id = $1',
        [w.a.staffUserId],
      );
    });
  });

  it('should refuse writes to phone_numbers, any access to auth_providers and password_hash', async () => {
    await withWorld(async (client, w) => {
      await asReseller(client, w.a.resellerId);
      await expectRefused(
        client,
        /permission denied for table phone_numbers/,
        `UPDATE phone_numbers SET label = 'x' WHERE user_id = $1`,
        [w.a.memberUserId],
      );
      await expectRefused(
        client,
        /permission denied for table auth_providers/,
        'SELECT id FROM auth_providers',
      );
      await expectRefused(
        client,
        /permission denied for table users/,
        'SELECT password_hash FROM users WHERE id = $1',
        [w.a.staffUserId],
      );
    });
  });
});

describe('ROV-279: the platform role keeps full access', () => {
  it('should read every user with password_hash, every phone and every passkey', async () => {
    await withWorld(async (client, w) => {
      const ids = everyone(w);
      const users = await client.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM users WHERE id = ANY($1::uuid[])',
        [ids],
      );
      expect(users.rows).toHaveLength(4);
      expect(await visiblePhoneOwners(client, 'phone_numbers', ids)).toHaveLength(4);
      const providers = await client.query(
        'SELECT id FROM auth_providers_live WHERE user_id = ANY($1::uuid[])',
        [ids],
      );
      expect(providers.rows).toHaveLength(2);
    });
  });

  it('should write phone_numbers and auth_providers', async () => {
    await withWorld(async (client, w) => {
      const phone = await client.query(
        `UPDATE phone_numbers SET label = 'work' WHERE user_id = $1 RETURNING id`,
        [w.b.memberUserId],
      );
      expect(phone.rowCount).toBe(1);
      const provider = await client.query(
        `UPDATE auth_providers SET provider_data = '{}'::jsonb WHERE user_id = $1 RETURNING id`,
        [w.b.memberUserId],
      );
      expect(provider.rowCount).toBe(1);
    });
  });
});
