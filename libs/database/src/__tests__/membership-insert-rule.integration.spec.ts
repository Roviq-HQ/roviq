/**
 * Which memberships the institute role may insert (ROV-372), and what a membership lets an
 * institute read. Each test builds two institutes as `roviq_admin`, assumes a database role
 * and attempts the write; nothing goes through the application.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const REFUSED = /may add only a person it created or one of its active members/;
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 4 });
});

afterAll(async () => {
  await pool.end();
});

interface Side {
  instituteId: string;
  roleId: string;
  secondRoleId: string;
}

interface World {
  a: Side;
  b: Side;
}

async function insertUser(client: pg.PoolClient, originTenantId: string | null): Promise<string> {
  const tag = randomUUID().slice(0, 12);
  const res = await client.query<{ id: string }>(
    `INSERT INTO users (email, username, password_hash, origin_tenant_id, created_by, updated_by)
     VALUES ($1, $2, 'not-a-real-hash', $3, $4, $4) RETURNING id`,
    [`rov372-${tag}@test.local`, `rov372_${tag}`, originTenantId, SYSTEM],
  );
  return res.rows[0].id;
}

async function insertRole(client: pg.PoolClient, tenantId: string, name: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO roles (scope, tenant_id, name, abilities, created_by, updated_by)
     VALUES ('institute', $1, $2, '[]', $3, $3) RETURNING id`,
    [tenantId, JSON.stringify({ en: name }), SYSTEM],
  );
  return res.rows[0].id;
}

async function insertSide(client: pg.PoolClient): Promise<Side> {
  const tag = randomUUID().slice(0, 8);
  const reseller = await client.query<{ id: string }>(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-372 ${tag}`, `rov372-${tag}`, SYSTEM],
  );
  const institute = await client.query<{ id: string }>(
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [JSON.stringify({ en: `ROV-372 ${tag}` }), `rov372-inst-${tag}`, reseller.rows[0].id, SYSTEM],
  );
  const instituteId = institute.rows[0].id;
  return {
    instituteId,
    roleId: await insertRole(client, instituteId, 'rov372_one'),
    secondRoleId: await insertRole(client, instituteId, 'rov372_two'),
  };
}

/** Builds the world as `roviq_admin`, runs `fn` in the same transaction, always rolled back. */
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

async function asAdmin(client: pg.PoolClient): Promise<void> {
  await client.query('SET LOCAL ROLE roviq_admin');
}

async function asInstitute(client: pg.PoolClient, tenantId: string): Promise<void> {
  await client.query('SET LOCAL ROLE roviq_app');
  await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
}

const INSERT_MEMBERSHIP = `INSERT INTO memberships (user_id, tenant_id, role_id, status, created_by, updated_by)
   VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`;

async function insertMembership(
  client: pg.PoolClient,
  userId: string,
  side: Side,
  roleId = side.roleId,
  status = 'ACTIVE',
): Promise<string> {
  const res = await client.query<{ id: string }>(INSERT_MEMBERSHIP, [
    userId,
    side.instituteId,
    roleId,
    status,
    SYSTEM,
  ]);
  return res.rows[0].id;
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

async function countMemberships(client: pg.PoolClient, userId: string): Promise<number> {
  await asAdmin(client);
  const res = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM memberships WHERE user_id = $1',
    [userId],
  );
  return res.rows[0].n;
}

describe('ROV-372: the institute role inserts a membership only for its own people', () => {
  it('should accept a membership for a user the same institute created', async () => {
    await withWorld(async (client, w) => {
      const own = await insertUser(client, w.a.instituteId);
      await asInstitute(client, w.a.instituteId);
      await insertMembership(client, own, w.a);
      expect(await countMemberships(client, own)).toBe(1);
    });
  });

  it('should refuse a membership for a user another institute created', async () => {
    await withWorld(async (client, w) => {
      const theirs = await insertUser(client, w.b.instituteId);
      await insertMembership(client, theirs, w.b);
      await asInstitute(client, w.a.instituteId);
      await expectRefused(client, REFUSED, INSERT_MEMBERSHIP, [
        theirs,
        w.a.instituteId,
        w.a.roleId,
        'ACTIVE',
        SYSTEM,
      ]);
      expect(await countMemberships(client, theirs)).toBe(1);
    });
  });

  it('should refuse a membership for a user no institute created', async () => {
    await withWorld(async (client, w) => {
      const platformMade = await insertUser(client, null);
      await asInstitute(client, w.a.instituteId);
      await expectRefused(client, REFUSED, INSERT_MEMBERSHIP, [
        platformMade,
        w.a.instituteId,
        w.a.roleId,
        'ACTIVE',
        SYSTEM,
      ]);
      expect(await countMemberships(client, platformMade)).toBe(0);
    });
  });

  it('should refuse a membership for a user that does not exist', async () => {
    await withWorld(async (client, w) => {
      await asInstitute(client, w.a.instituteId);
      await expectRefused(client, REFUSED, INSERT_MEMBERSHIP, [
        randomUUID(),
        w.a.instituteId,
        w.a.roleId,
        'ACTIVE',
        SYSTEM,
      ]);
    });
  });

  it('should accept a second role for an active member, whoever created the account', async () => {
    await withWorld(async (client, w) => {
      // The first admin: made by the platform, added to the institute by the platform.
      const firstAdmin = await insertUser(client, null);
      await insertMembership(client, firstAdmin, w.a);
      await asInstitute(client, w.a.instituteId);
      await insertMembership(client, firstAdmin, w.a, w.a.secondRoleId);
      expect(await countMemberships(client, firstAdmin)).toBe(2);
    });
  });

  it.each([
    ['suspended', `status = 'SUSPENDED'`],
    ['deleted', 'deleted_at = now(), deleted_by = created_by'],
  ])('should refuse a second role when the only membership is %s', async (_label, change) => {
    await withWorld(async (client, w) => {
      const person = await insertUser(client, null);
      const membershipId = await insertMembership(client, person, w.a);
      await client.query(`UPDATE memberships SET ${change} WHERE id = $1`, [membershipId]);
      await asInstitute(client, w.a.instituteId);
      await expectRefused(client, REFUSED, INSERT_MEMBERSHIP, [
        person,
        w.a.instituteId,
        w.a.secondRoleId,
        'ACTIVE',
        SYSTEM,
      ]);
    });
  });

  it('should not count an active membership in another institute', async () => {
    await withWorld(async (client, w) => {
      const person = await insertUser(client, null);
      await insertMembership(client, person, w.b);
      await asInstitute(client, w.a.instituteId);
      await expectRefused(client, REFUSED, INSERT_MEMBERSHIP, [
        person,
        w.a.instituteId,
        w.a.roleId,
        'ACTIVE',
        SYSTEM,
      ]);
    });
  });

  it('should let the platform role add any user to an institute', async () => {
    await withWorld(async (client, w) => {
      const platformMade = await insertUser(client, null);
      const theirs = await insertUser(client, w.b.instituteId);
      await insertMembership(client, platformMade, w.a);
      await insertMembership(client, theirs, w.a);
      expect(await countMemberships(client, platformMade)).toBe(1);
      expect(await countMemberships(client, theirs)).toBe(1);
    });
  });
});

describe('ROV-372: a membership stays with its user and institute', () => {
  it.each([
    'roviq_app',
    'roviq_admin',
  ] as const)('should refuse %s moving a membership to another user', async (role) => {
    await withWorld(async (client, w) => {
      const own = await insertUser(client, w.a.instituteId);
      const other = await insertUser(client, w.a.instituteId);
      const membershipId = await insertMembership(client, own, w.a);
      if (role === 'roviq_app') await asInstitute(client, w.a.instituteId);
      await expectRefused(
        client,
        /a membership cannot move to another user or institute/,
        'UPDATE memberships SET user_id = $1 WHERE id = $2',
        [other, membershipId],
      );
    });
  });

  it('should refuse the platform role moving a membership to another institute', async () => {
    await withWorld(async (client, w) => {
      const own = await insertUser(client, w.a.instituteId);
      const membershipId = await insertMembership(client, own, w.a);
      await expectRefused(
        client,
        /a membership cannot move to another user or institute/,
        'UPDATE memberships SET tenant_id = $1, role_id = $2 WHERE id = $3',
        [w.b.instituteId, w.b.roleId, membershipId],
      );
    });
  });

  it('should still let the institute change the status of its own membership', async () => {
    await withWorld(async (client, w) => {
      const own = await insertUser(client, w.a.instituteId);
      const membershipId = await insertMembership(client, own, w.a);
      await asInstitute(client, w.a.instituteId);
      const res = await client.query(
        `UPDATE memberships SET status = 'SUSPENDED' WHERE id = $1 RETURNING id`,
        [membershipId],
      );
      expect(res.rowCount).toBe(1);
    });
  });
});

describe('ROV-372: the institute that created a user is fixed', () => {
  it('should refuse the institute role writing origin_tenant_id', async () => {
    await withWorld(async (client, w) => {
      const theirs = await insertUser(client, w.b.instituteId);
      const own = await insertUser(client, w.a.instituteId);
      await insertMembership(client, own, w.a);
      await asInstitute(client, w.a.instituteId);
      for (const id of [theirs, own]) {
        await expectRefused(
          client,
          /permission denied for table users/,
          'UPDATE users SET origin_tenant_id = $1 WHERE id = $2',
          [w.a.instituteId, id],
        );
      }
      await expectRefused(
        client,
        /permission denied for table users/,
        `INSERT INTO users (email, username, password_hash, origin_tenant_id, created_by, updated_by)
         VALUES ('rov372-x@test.local', 'rov372_x', 'not-a-real-hash', $1, $2, $2)`,
        [w.a.instituteId, SYSTEM],
      );
    });
  });

  it('should refuse the institute role reading origin_tenant_id', async () => {
    await withWorld(async (client, w) => {
      const own = await insertUser(client, w.a.instituteId);
      await insertMembership(client, own, w.a);
      await asInstitute(client, w.a.instituteId);
      await expectRefused(
        client,
        /permission denied for table users/,
        'SELECT origin_tenant_id FROM users WHERE id = $1',
        [own],
      );
    });
  });

  it.each([
    ['another institute', (w: World) => w.a.instituteId],
    ['none', () => null],
  ])('should refuse the platform role changing it to %s', async (_label, next) => {
    await withWorld(async (client, w) => {
      const theirs = await insertUser(client, w.b.instituteId);
      await expectRefused(
        client,
        /the institute that created a user cannot be changed/,
        'UPDATE users SET origin_tenant_id = $1 WHERE id = $2',
        [next(w), theirs],
      );
    });
  });

  it('should refuse the platform role setting it on a user created without one', async () => {
    await withWorld(async (client, w) => {
      const platformMade = await insertUser(client, null);
      await expectRefused(
        client,
        /the institute that created a user cannot be changed/,
        'UPDATE users SET origin_tenant_id = $1 WHERE id = $2',
        [w.a.instituteId, platformMade],
      );
    });
  });

  it('should leave other columns of the user writable by the platform role', async () => {
    await withWorld(async (client, w) => {
      const own = await insertUser(client, w.a.instituteId);
      const res = await client.query(
        `UPDATE users SET preferred_locale = 'hi' WHERE id = $1 RETURNING origin_tenant_id`,
        [own],
      );
      expect(res.rows).toEqual([{ origin_tenant_id: w.a.instituteId }]);
    });
  });
});

describe('ROV-372: an institute reads the account of a current member only', () => {
  async function visible(
    client: pg.PoolClient,
    relation: string,
    column: string,
    userId: string,
  ): Promise<number> {
    const res = await client.query(`SELECT 1 FROM ${relation} WHERE ${column} = $1`, [userId]);
    return res.rowCount ?? 0;
  }

  it.each([
    ['users', 'id'],
    ['users_live', 'id'],
    ['phone_numbers', 'user_id'],
    ['user_profiles', 'user_id'],
  ])('should stop showing %s once the membership is deleted', async (relation, column) => {
    await withWorld(async (client, w) => {
      const person = await insertUser(client, w.a.instituteId);
      const membershipId = await insertMembership(client, person, w.a);
      await client.query(
        `INSERT INTO phone_numbers (user_id, country_code, number, is_primary, created_by, updated_by)
         VALUES ($1, '91', $2, true, $3, $3)`,
        [person, `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`, SYSTEM],
      );
      await client.query(
        `INSERT INTO user_profiles (user_id, first_name, created_by, updated_by)
         VALUES ($1, '{"en":"Rov"}', $2, $2)`,
        [person, SYSTEM],
      );

      await asInstitute(client, w.a.instituteId);
      expect(await visible(client, relation, column, person)).toBe(1);

      await asAdmin(client);
      await client.query(
        'UPDATE memberships SET deleted_at = now(), deleted_by = $2 WHERE id = $1',
        [membershipId, SYSTEM],
      );
      await asInstitute(client, w.a.instituteId);
      expect(await visible(client, relation, column, person)).toBe(0);
    });
  });
});
