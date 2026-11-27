/**
 * What the `roviq_user` role may do (ROV-377). Each test builds two people as `roviq_admin`,
 * assumes the role as one of them and attempts the statement; nothing goes through the
 * application.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const DENIED = /permission denied/;
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 4 });
});

afterAll(async () => {
  await pool.end();
});

interface Person {
  userId: string;
  profileId: string;
  phoneId: string;
  passkeyId: string;
  sessionId: string;
  notificationId: string;
  instituteNotificationId: string;
  groupMembershipId: string;
}

async function one(client: pg.PoolClient, text: string, values: unknown[]): Promise<string> {
  const res = await client.query<{ id: string }>(`${text} RETURNING id`, values);
  return res.rows[0].id;
}

async function insertPerson(client: pg.PoolClient): Promise<Person> {
  const tag = randomUUID().slice(0, 12);
  const userId = await one(
    client,
    `INSERT INTO users (email, username, password_hash, created_by, updated_by)
     VALUES ($1, $2, 'not-a-real-hash', $3, $3)`,
    [`rov377-${tag}@test.local`, `rov377_${tag}`, SYSTEM],
  );
  const resellerId = await one(
    client,
    'INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3)',
    [`ROV-377 ${tag}`, `rov377-${tag}`, SYSTEM],
  );
  const instituteId = await one(
    client,
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4)`,
    [JSON.stringify({ en: `ROV-377 ${tag}` }), `rov377-inst-${tag}`, resellerId, SYSTEM],
  );
  const roleId = await one(
    client,
    `INSERT INTO roles (scope, tenant_id, name, abilities, created_by, updated_by)
     VALUES ('institute', $1, $2, '[]', $3, $3)`,
    [instituteId, JSON.stringify({ en: 'rov377' }), SYSTEM],
  );
  const membershipId = await one(
    client,
    `INSERT INTO memberships (user_id, tenant_id, role_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, 'ACTIVE', $4, $4)`,
    [userId, instituteId, roleId, SYSTEM],
  );
  const groupId = await one(
    client,
    `INSERT INTO institute_groups (name, code, type, created_by, updated_by)
     VALUES ($1, $2, (enum_range(NULL::"GroupType"))[1], $3, $3)`,
    [`ROV-377 ${tag}`, `ROV377-${tag}`, userId],
  );
  return {
    userId,
    profileId: await one(
      client,
      `INSERT INTO user_profiles (user_id, first_name, nationality, created_by, updated_by)
       VALUES ($1, $2, 'Indian', $3, $3)`,
      [userId, JSON.stringify({ en: tag }), SYSTEM],
    ),
    phoneId: await one(
      client,
      `INSERT INTO phone_numbers (user_id, country_code, number, is_primary, created_by, updated_by)
       VALUES ($1, '+91', $2, true, $3, $3)`,
      [userId, `9${Math.floor(100000000 + Math.random() * 899999999)}`, SYSTEM],
    ),
    passkeyId: await one(
      client,
      `INSERT INTO auth_providers (user_id, provider, provider_user_id, created_by, updated_by)
       VALUES ($1, 'passkey', $2, $3, $3)`,
      [userId, `cred-${tag}`, SYSTEM],
    ),
    sessionId: await one(
      client,
      `INSERT INTO refresh_tokens
         (user_id, tenant_id, membership_id, membership_scope, token_hash, expires_at, created_by, updated_by)
       VALUES ($1, $2, $3, 'institute', $4, now() + interval '1 day', $1, $1)`,
      [userId, instituteId, membershipId, `hash-${tag}`],
    ),
    notificationId: await one(
      client,
      `INSERT INTO notifications (scope, recipient_user_id, type, title, body, created_by, updated_by)
       VALUES ('platform', $1, 'rov377', $2, $2, $3, $3)`,
      [userId, JSON.stringify({ en: 'x' }), SYSTEM],
    ),
    instituteNotificationId: await one(
      client,
      `INSERT INTO notifications
         (scope, tenant_id, recipient_user_id, type, title, body, created_by, updated_by)
       VALUES ('institute', $1, $2, 'rov377', $3, $3, $4, $4)`,
      [instituteId, userId, JSON.stringify({ en: 'x' }), SYSTEM],
    ),
    groupMembershipId: await one(
      client,
      `INSERT INTO group_memberships (user_id, group_id, role_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)`,
      [userId, groupId, roleId, SYSTEM],
    ),
  };
}

/** Builds two people as `roviq_admin`, runs `fn` in the same transaction, always rolled back. */
async function withPeople(
  fn: (client: pg.PoolClient, me: Person, other: Person) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE roviq_admin');
    const me = await insertPerson(client);
    const other = await insertPerson(client);
    await fn(client, me, other);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function asUser(client: pg.PoolClient, userId: string | null): Promise<void> {
  await client.query('SET LOCAL ROLE roviq_user');
  await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId ?? '']);
}

async function ids(client: pg.PoolClient, text: string, values: unknown[] = []): Promise<string[]> {
  const res = await client.query<{ id: string }>(text, values);
  return res.rows.map((row) => row.id);
}

async function expectRefused(
  client: pg.PoolClient,
  pattern: RegExp,
  text: string,
  values: unknown[] = [],
): Promise<void> {
  await client.query('SAVEPOINT attempt');
  await expect(client.query(text, values)).rejects.toThrow(pattern);
  await client.query('ROLLBACK TO SAVEPOINT attempt');
}

/** Tables the role reads, with the column that names the person. */
const READABLE = [
  ['users', 'id', 'userId'],
  ['users_live', 'id', 'userId'],
  ['user_profiles', 'id', 'profileId'],
  ['user_profiles_live', 'id', 'profileId'],
  ['phone_numbers', 'id', 'phoneId'],
  ['phone_numbers_live', 'id', 'phoneId'],
  ['auth_providers', 'id', 'passkeyId'],
  ['auth_providers_live', 'id', 'passkeyId'],
  ['refresh_tokens', 'id', 'sessionId'],
  ['refresh_tokens_live', 'id', 'sessionId'],
  ['group_memberships', 'id', 'groupMembershipId'],
  ['group_memberships_live', 'id', 'groupMembershipId'],
] as const;

describe('roviq_user reads', () => {
  it.each(READABLE)('%s: only the own row', async (table, column, key) => {
    await withPeople(async (client, me, other) => {
      await asUser(client, me.userId);
      const seen = await ids(
        client,
        `SELECT ${column} AS id FROM ${table} WHERE ${column} = ANY($1)`,
        [[me[key], other[key]]],
      );
      expect(seen).toEqual([me[key]]);
    });
  });

  it('notifications: only the own platform notification', async () => {
    await withPeople(async (client, me, other) => {
      await asUser(client, me.userId);
      const all = [
        me.notificationId,
        me.instituteNotificationId,
        other.notificationId,
        other.instituteNotificationId,
      ];
      for (const table of ['notifications', 'notifications_live']) {
        expect(await ids(client, `SELECT id FROM ${table} WHERE id = ANY($1)`, [all])).toEqual([
          me.notificationId,
        ]);
      }
    });
  });

  it.each([null, ''])('no person set (%j): nothing is readable', async (unset) => {
    await withPeople(async (client, me) => {
      await client.query('SET LOCAL ROLE roviq_user');
      if (unset !== null) await asUser(client, null);
      for (const [table, column, key] of READABLE) {
        expect(
          await ids(client, `SELECT ${column} AS id FROM ${table} WHERE ${column} = $1`, [me[key]]),
        ).toEqual([]);
      }
      expect(await ids(client, 'SELECT id FROM notifications')).toEqual([]);
    });
  });

  it('no other table or column is readable', async () => {
    await withPeople(async (client, me) => {
      await asUser(client, me.userId);
      for (const table of [
        'memberships',
        'institutes',
        'roles',
        'student_profiles',
        'device_tokens',
        'user_addresses',
        'user_identifiers',
        'user_documents',
        'platform_memberships',
        'reseller_memberships',
        'audit_logs',
      ]) {
        await expectRefused(client, DENIED, `SELECT 1 FROM ${table} LIMIT 1`);
      }
      await expectRefused(client, DENIED, 'SELECT origin_tenant_id FROM users');
    });
  });

  it('holds exactly the listed table privileges', async () => {
    // The catalog view lists a role's grants only to that role, so the query runs as it.
    const client = await pool.connect();
    const res = await (async () => {
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE roviq_user');
        return await client.query<{ table_name: string; privileges: string }>(
          `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
             FROM information_schema.role_table_grants
            WHERE grantee = 'roviq_user' AND table_schema = 'public'
            GROUP BY table_name ORDER BY table_name`,
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    })();
    expect(Object.fromEntries(res.rows.map((row) => [row.table_name, row.privileges]))).toEqual({
      auth_providers: 'INSERT,SELECT',
      auth_providers_live: 'SELECT',
      group_memberships: 'SELECT',
      group_memberships_live: 'SELECT',
      notifications: 'SELECT',
      notifications_live: 'SELECT',
      phone_numbers: 'INSERT,SELECT',
      phone_numbers_live: 'SELECT',
      refresh_tokens: 'SELECT',
      refresh_tokens_live: 'SELECT',
      user_profiles: 'SELECT',
      user_profiles_live: 'SELECT',
      users_live: 'SELECT',
    });
    const role = await pool.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = 'roviq_user'`,
    );
    expect(role.rows).toEqual([
      { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolinherit: false },
    ]);
  });
});

describe('roviq_user writes', () => {
  /** [what, statement, the own id, the other person's id] */
  const OWN_UPDATES = [
    [
      'users',
      `UPDATE users SET preferred_locale = 'hi', updated_by = id WHERE id = ANY($1)`,
      'userId',
    ],
    [
      'user_profiles',
      `UPDATE user_profiles SET nationality = 'Changed' WHERE id = ANY($1)`,
      'profileId',
    ],
    [
      'phone_numbers',
      `UPDATE phone_numbers SET number = '9000000001' WHERE id = ANY($1)`,
      'phoneId',
    ],
    [
      'auth_providers',
      'UPDATE auth_providers SET deleted_at = now() WHERE id = ANY($1)',
      'passkeyId',
    ],
    [
      'refresh_tokens',
      `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'USER_INITIATED' WHERE id = ANY($1)`,
      'sessionId',
    ],
    [
      'notifications',
      'UPDATE notifications SET read_at = now() WHERE id = ANY($1)',
      'notificationId',
    ],
  ] as const;

  it.each(
    OWN_UPDATES,
  )('%s: an update changes the own row and never another person’s', async (_t, sql, key) => {
    await withPeople(async (client, me, other) => {
      await asUser(client, me.userId);
      const res = await client.query(`${sql} RETURNING id`, [[me[key], other[key]]]);
      expect(res.rows.map((row) => row.id)).toEqual([me[key]]);
    });
  });

  it('a row cannot be handed to another person', async () => {
    await withPeople(async (client, me, other) => {
      await asUser(client, me.userId);
      // user_id is outside every column grant, so the statement itself is refused.
      for (const table of ['user_profiles', 'phone_numbers', 'auth_providers', 'refresh_tokens']) {
        await expectRefused(client, DENIED, `UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [
          other.userId,
          me.userId,
        ]);
      }
    });
  });

  it('columns outside the grant cannot be changed', async () => {
    await withPeople(async (client, me) => {
      await asUser(client, me.userId);
      for (const statement of [
        `UPDATE users SET status = 'ACTIVE' WHERE id = $1`,
        `UPDATE users SET username = 'someone_else' WHERE id = $1`,
        `UPDATE users SET email = 'x@test.local' WHERE id = $1`,
        `UPDATE users SET deleted_at = now() WHERE id = $1`,
        `UPDATE user_profiles SET date_of_birth = '2000-01-01' WHERE user_id = $1`,
        `UPDATE phone_numbers SET is_primary = false WHERE user_id = $1`,
        `UPDATE auth_providers SET provider_data = '{}' WHERE user_id = $1`,
        `UPDATE refresh_tokens SET expires_at = now() WHERE user_id = $1`,
        `UPDATE notifications SET title = '{}' WHERE recipient_user_id = $1`,
        `UPDATE group_memberships SET is_active = false WHERE user_id = $1`,
      ]) {
        await expectRefused(client, DENIED, statement, [me.userId]);
      }
    });
  });

  it('passkeys and phone numbers are added for the person only', async () => {
    await withPeople(async (client, me, other) => {
      await asUser(client, me.userId);
      const passkey = `INSERT INTO auth_providers (user_id, provider, provider_user_id, created_by, updated_by)
         VALUES ($1, 'passkey', $2, $1, $1)`;
      await client.query(passkey, [me.userId, `own-${randomUUID()}`]);
      await expectRefused(client, /row-level security policy/, passkey, [
        other.userId,
        `foreign-${randomUUID()}`,
      ]);
      await expectRefused(
        client,
        /row-level security policy/,
        `INSERT INTO phone_numbers (user_id, country_code, number, created_by, updated_by)
         VALUES ($1, '+91', '9000000002', $1, $1)`,
        [other.userId],
      );
    });
  });

  it('nothing is inserted or deleted elsewhere', async () => {
    await withPeople(async (client, me) => {
      await asUser(client, me.userId);
      for (const statement of [
        `INSERT INTO users (email, username, password_hash, created_by, updated_by)
           VALUES ('a@test.local', 'a_rov377', 'x', $1, $1)`,
        `INSERT INTO refresh_tokens (user_id, membership_id, membership_scope, token_hash, expires_at, created_by, updated_by)
           VALUES ($1, $1, 'platform', 'h', now(), $1, $1)`,
        'DELETE FROM auth_providers WHERE user_id = $1',
        'DELETE FROM phone_numbers WHERE user_id = $1',
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        'DELETE FROM users WHERE id = $1',
      ]) {
        await expectRefused(client, DENIED, statement, [me.userId]);
      }
    });
  });

  it('a revoked session stays revoked and cannot be extended', async () => {
    await withPeople(async (client, me) => {
      await asUser(client, me.userId);
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'USER_INITIATED' WHERE id = $1`,
        [me.sessionId],
      );
      await expectRefused(
        client,
        /a revoked refresh token stays revoked/,
        'UPDATE refresh_tokens SET revoked_at = NULL, revoked_reason = NULL WHERE id = $1',
        [me.sessionId],
      );
    });
  });
});

describe('the other request roles', () => {
  it('cannot assume a person’s rows through the new policies', async () => {
    await withPeople(async (client, me) => {
      // The person setting means nothing to the institute role: its own policies still decide.
      await client.query('SET LOCAL ROLE roviq_app');
      await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [me.userId]);
      expect(await ids(client, 'SELECT id FROM users_live WHERE id = $1', [me.userId])).toEqual([]);
      await expectRefused(client, DENIED, 'SELECT 1 FROM auth_providers LIMIT 1');
    });
  });
});
