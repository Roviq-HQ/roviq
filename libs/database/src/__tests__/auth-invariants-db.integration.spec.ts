/**
 * Auth invariants the database enforces by itself (ROV-102): constraints, triggers
 * and policies from the `rov-102-*` migrations. Each test assumes a database role
 * and attempts the forbidden write or read; nothing here goes through the
 * application, so these hold for every present and future code path.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../seed/ids';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
let pool: pg.Pool;

/** Run `fn` as `role` in a transaction that is always rolled back. */
async function asRole(
  role: string,
  vars: Record<string, string>,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    for (const [key, value] of Object.entries(vars)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const asAdmin = (fn: (client: pg.PoolClient) => Promise<void>) => asRole('roviq_admin', {}, fn);

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

interface Staff {
  resellerId: string;
  userId: string;
  membershipId: string;
  instituteId: string;
}

/** A non-system reseller with one staff member and one institute. */
async function createReseller(client: pg.PoolClient): Promise<Staff> {
  const tag = randomUUID().slice(0, 8);
  const reseller = await client.query<{ id: string }>(
    `INSERT INTO resellers (name, slug, created_by, updated_by)
     VALUES ($1, $2, $3, $3) RETURNING id`,
    [`Invariant ${tag}`, `invariant-${tag}`, SYSTEM],
  );
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (email, username, password_hash, created_by, updated_by)
     VALUES ($1, $2, 'x', $3, $3) RETURNING id`,
    [`invariant-${tag}@test.local`, `invariant_${tag}`, SYSTEM],
  );
  const membership = await client.query<{ id: string }>(
    `INSERT INTO reseller_memberships (user_id, reseller_id, role_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [user.rows[0].id, reseller.rows[0].id, SEED_IDS.ROLE_RESELLER_FULL_ADMIN, SYSTEM],
  );
  const institute = await client.query<{ id: string }>(
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [
      JSON.stringify({ en: `Invariant ${tag}` }),
      `invariant-inst-${tag}`,
      reseller.rows[0].id,
      SYSTEM,
    ],
  );
  return {
    resellerId: reseller.rows[0].id,
    userId: user.rows[0].id,
    membershipId: membership.rows[0].id,
    instituteId: institute.rows[0].id,
  };
}

const INSERT_TOKEN = `
  INSERT INTO refresh_tokens
    (user_id, tenant_id, membership_id, membership_scope, token_hash, expires_at, created_by, updated_by)
  VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', $6, $6)
  RETURNING id`;

const resellerToken = (client: pg.PoolClient, staff: Staff) =>
  client
    .query<{ id: string }>(INSERT_TOKEN, [
      staff.userId,
      null,
      staff.membershipId,
      'reseller',
      randomUUID(),
      SYSTEM,
    ])
    .then((res) => res.rows[0].id);

const INSERT_SESSION = `
  INSERT INTO impersonation_sessions
    (impersonator_id, impersonator_scope, target_user_id, target_tenant_id, reason, expires_at)
  VALUES ($1, $2, $3, $4, 'database invariant test', now() + interval '30 minutes')
  RETURNING id`;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 3 });
});

afterAll(async () => {
  await pool.end();
});

describe('refresh tokens', () => {
  it('7. refuses a token whose scope is not platform, reseller or institute', async () => {
    await asAdmin(async (client) => {
      await expectRefused(client, /chk_refresh_token_membership_scope/, INSERT_TOKEN, [
        SEED_IDS.USER_TEACHER,
        SEED_IDS.INSTITUTE_1,
        SEED_IDS.MEMBERSHIP_TEACHER_INST1,
        'impersonation',
        randomUUID(),
        SYSTEM,
      ]);
    });
  });

  it('issues a token only to an active membership of that user in that institute', async () => {
    await asAdmin(async (client) => {
      const issue = (userId: string, tenantId: string, membershipId: string) => [
        userId,
        tenantId,
        membershipId,
        'institute',
        randomUUID(),
        SYSTEM,
      ];
      const ok = await client.query(
        INSERT_TOKEN,
        issue(SEED_IDS.USER_TEACHER, SEED_IDS.INSTITUTE_1, SEED_IDS.MEMBERSHIP_TEACHER_INST1),
      );
      expect(ok.rows).toHaveLength(1);

      const refused = /refresh token refused/;
      // Another user's membership, the wrong institute, a membership that does not exist.
      await expectRefused(
        client,
        refused,
        INSERT_TOKEN,
        issue(SEED_IDS.USER_ADMIN, SEED_IDS.INSTITUTE_1, SEED_IDS.MEMBERSHIP_TEACHER_INST1),
      );
      await expectRefused(
        client,
        refused,
        INSERT_TOKEN,
        issue(SEED_IDS.USER_TEACHER, SEED_IDS.INSTITUTE_2, SEED_IDS.MEMBERSHIP_TEACHER_INST1),
      );
      await expectRefused(
        client,
        refused,
        INSERT_TOKEN,
        issue(SEED_IDS.USER_TEACHER, SEED_IDS.INSTITUTE_1, randomUUID()),
      );
    });
  });

  it('refuses a revocation without a reason and never un-revokes', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      const id = await resellerToken(client, staff);

      await expectRefused(
        client,
        /chk_refresh_token_revoked_reason/,
        'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1',
        [id],
      );

      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'user_initiated' WHERE id = $1`,
        [id],
      );
      await expectRefused(
        client,
        /stays revoked/,
        'UPDATE refresh_tokens SET revoked_at = NULL, revoked_reason = NULL WHERE id = $1',
        [id],
      );
      await expectRefused(
        client,
        /stays revoked/,
        `UPDATE refresh_tokens SET revoked_reason = 'rotation' WHERE id = $1`,
        [id],
      );
    });
  });

  it('cannot be re-pointed at another user or extended', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      const id = await resellerToken(client, staff);

      await expectRefused(
        client,
        /re-pointed or extended/,
        'UPDATE refresh_tokens SET user_id = $2 WHERE id = $1',
        [id, SEED_IDS.USER_ADMIN],
      );
      await expectRefused(
        client,
        /re-pointed or extended/,
        `UPDATE refresh_tokens SET expires_at = expires_at + interval '1 day' WHERE id = $1`,
        [id],
      );
    });
  });
});

describe('reseller suspension', () => {
  it('9–10. revokes the staff tokens and ends their reseller impersonations, and only theirs', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      const other = await createReseller(client);
      const tokenId = await resellerToken(client, staff);
      const otherTokenId = await resellerToken(client, other);
      const session = await client.query<{ id: string }>(INSERT_SESSION, [
        staff.userId,
        'reseller',
        SEED_IDS.USER_TEACHER,
        staff.instituteId,
      ]);
      const otherSession = await client.query<{ id: string }>(INSERT_SESSION, [
        other.userId,
        'reseller',
        SEED_IDS.USER_TEACHER,
        other.instituteId,
      ]);

      // Nothing but the status changes: the database does the rest.
      await client.query(`UPDATE resellers SET status = 'SUSPENDED' WHERE id = $1`, [
        staff.resellerId,
      ]);

      const tokens = await client.query<{ id: string; revoked_reason: string | null }>(
        'SELECT id, revoked_reason FROM refresh_tokens WHERE id = ANY($1)',
        [[tokenId, otherTokenId]],
      );
      expect(tokens.rows.find((t) => t.id === tokenId)?.revoked_reason).toBe('admin_revoked');
      expect(tokens.rows.find((t) => t.id === otherTokenId)?.revoked_reason).toBeNull();

      const sessions = await client.query<{ id: string; ended_reason: string | null }>(
        'SELECT id, ended_reason FROM impersonation_sessions WHERE id = ANY($1)',
        [[session.rows[0].id, otherSession.rows[0].id]],
      );
      expect(sessions.rows.find((s) => s.id === session.rows[0].id)?.ended_reason).toBe('revoked');
      expect(sessions.rows.find((s) => s.id === otherSession.rows[0].id)?.ended_reason).toBeNull();
    });
  });

  it('refuses new tokens and new impersonations for a suspended reseller', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      await client.query(`UPDATE resellers SET status = 'SUSPENDED' WHERE id = $1`, [
        staff.resellerId,
      ]);

      await expectRefused(client, /refresh token refused/, INSERT_TOKEN, [
        staff.userId,
        null,
        staff.membershipId,
        'reseller',
        randomUUID(),
        SYSTEM,
      ]);
      await expectRefused(client, /impersonation refused/, INSERT_SESSION, [
        staff.userId,
        'reseller',
        SEED_IDS.USER_TEACHER,
        staff.instituteId,
      ]);
    });
  });
});

describe('impersonation sessions', () => {
  it('refuses a reseller impersonating into an institute it does not own', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);

      await expectRefused(client, /impersonation refused/, INSERT_SESSION, [
        staff.userId,
        'reseller',
        SEED_IDS.USER_TEACHER,
        SEED_IDS.INSTITUTE_1,
      ]);
    });
  });

  it('refuses a platform or institute session from someone without that membership', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);

      await expectRefused(client, /impersonation refused/, INSERT_SESSION, [
        staff.userId,
        'platform',
        SEED_IDS.USER_TEACHER,
        SEED_IDS.INSTITUTE_1,
      ]);
      await expectRefused(client, /impersonation refused/, INSERT_SESSION, [
        staff.userId,
        'institute',
        SEED_IDS.USER_TEACHER,
        SEED_IDS.INSTITUTE_1,
      ]);
    });
  });

  it('8. an ended session cannot be reopened, and a live one cannot be extended or re-pointed', async () => {
    await asAdmin(async (client) => {
      const session = await client.query<{ id: string }>(INSERT_SESSION, [
        SEED_IDS.USER_ADMIN,
        'platform',
        SEED_IDS.USER_TEACHER,
        SEED_IDS.INSTITUTE_1,
      ]);
      const id = session.rows[0].id;

      await expectRefused(
        client,
        /re-pointed or extended/,
        `UPDATE impersonation_sessions SET expires_at = expires_at + interval '10 minutes' WHERE id = $1`,
        [id],
      );
      await expectRefused(
        client,
        /re-pointed or extended/,
        'UPDATE impersonation_sessions SET target_tenant_id = $2 WHERE id = $1',
        [id, SEED_IDS.INSTITUTE_2],
      );

      await client.query(
        `UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'revoked' WHERE id = $1`,
        [id],
      );
      await expectRefused(
        client,
        /ended impersonation session cannot be changed/,
        'UPDATE impersonation_sessions SET ended_at = NULL, ended_reason = NULL WHERE id = $1',
        [id],
      );
    });
  });

  it('tenant and reseller roles can read only their own sessions and write none', async () => {
    // One transaction: sessions are opened as roviq_admin, then each role looks at them.
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      const open = (tenantId: string) =>
        client
          .query<{ id: string }>(INSERT_SESSION, [
            SEED_IDS.USER_ADMIN,
            'platform',
            SEED_IDS.USER_TEACHER,
            tenantId,
          ])
          .then((res) => res.rows[0].id);
      const inInstitute1 = await open(SEED_IDS.INSTITUTE_1);
      const inResellerInstitute = await open(staff.instituteId);
      const ours = [inInstitute1, inResellerInstitute];

      const visibleTo = async (role: string, setting: string, value: string) => {
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query('SELECT set_config($1, $2, true)', [setting, value]);
        const res = await client.query<{ id: string }>(
          'SELECT id FROM impersonation_sessions WHERE id = ANY($1)',
          [ours],
        );
        return res.rows.map((r) => r.id).sort();
      };

      expect(await visibleTo('roviq_app', 'app.current_tenant_id', SEED_IDS.INSTITUTE_1)).toEqual([
        inInstitute1,
      ]);
      await expectRefused(client, /permission denied/, INSERT_SESSION, [
        SEED_IDS.USER_ADMIN,
        'institute',
        SEED_IDS.USER_TEACHER,
        SEED_IDS.INSTITUTE_1,
      ]);
      await expectRefused(
        client,
        /permission denied/,
        `UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'revoked'`,
      );

      expect(await visibleTo('roviq_app', 'app.current_tenant_id', SEED_IDS.INSTITUTE_2)).toEqual(
        [],
      );

      expect(
        await visibleTo('roviq_reseller', 'app.current_reseller_id', staff.resellerId),
      ).toEqual([inResellerInstitute]);
      await expectRefused(
        client,
        /permission denied/,
        `UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'revoked'`,
      );
    });
  });
});

describe('password change', () => {
  it('11. revokes every live session of the user, whoever changes the password', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      const id = await resellerToken(client, staff);

      await client.query(`UPDATE users SET password_hash = 'changed' WHERE id = $1`, [
        staff.userId,
      ]);

      const token = await client.query<{ revoked_at: Date | null; revoked_reason: string | null }>(
        'SELECT revoked_at, revoked_reason FROM refresh_tokens WHERE id = $1',
        [id],
      );
      expect(token.rows[0].revoked_at).toBeInstanceOf(Date);
      expect(token.rows[0].revoked_reason).toBe('password_change');
    });
  });

  it('leaves sessions alone when another column of the user changes', async () => {
    await asAdmin(async (client) => {
      const staff = await createReseller(client);
      const id = await resellerToken(client, staff);

      await client.query('UPDATE users SET updated_at = now() WHERE id = $1', [staff.userId]);

      const token = await client.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM refresh_tokens WHERE id = $1',
        [id],
      );
      expect(token.rows[0].revoked_at).toBeNull();
    });
  });
});

describe('system reseller', () => {
  it('18. cannot be suspended, deactivated, soft-deleted or deleted, even as roviq_admin', async () => {
    await asAdmin(async (client) => {
      const id = [SEED_IDS.RESELLER_DIRECT];
      const refused = /system reseller cannot be/;
      await expectRefused(
        client,
        refused,
        `UPDATE resellers SET status = 'SUSPENDED' WHERE id = $1`,
        id,
      );
      await expectRefused(
        client,
        refused,
        'UPDATE resellers SET is_active = false WHERE id = $1',
        id,
      );
      await expectRefused(
        client,
        refused,
        'UPDATE resellers SET deleted_at = now() WHERE id = $1',
        id,
      );
      await expectRefused(
        client,
        refused,
        'UPDATE resellers SET is_system = false WHERE id = $1',
        id,
      );
      await expectRefused(client, refused, 'DELETE FROM resellers WHERE id = $1', id);

      // Other columns stay editable.
      const renamed = await client.query('UPDATE resellers SET name = name WHERE id = $1', id);
      expect(renamed.rowCount).toBe(1);
    });
  });
});

describe('institute deletion', () => {
  const ownReseller = { 'app.current_reseller_id': SEED_IDS.RESELLER_DIRECT };

  it('17. a reseller can neither delete nor soft-delete its own institute', async () => {
    await asRole('roviq_reseller', ownReseller, async (client) => {
      const own = await client.query('SELECT id FROM institutes WHERE id = $1', [
        SEED_IDS.INSTITUTE_1,
      ]);
      expect(own.rows).toHaveLength(1);

      await expectRefused(client, /permission denied/, 'DELETE FROM institutes WHERE id = $1', [
        SEED_IDS.INSTITUTE_1,
      ]);
      await expectRefused(
        client,
        /only the platform can delete or restore an institute/,
        'UPDATE institutes SET deleted_at = now() WHERE id = $1',
        [SEED_IDS.INSTITUTE_1],
      );
    });
  });

  it('the platform role can soft-delete an institute', async () => {
    await asAdmin(async (client) => {
      const res = await client.query('UPDATE institutes SET deleted_at = now() WHERE id = $1', [
        SEED_IDS.INSTITUTE_1,
      ]);
      expect(res.rowCount).toBe(1);
    });
  });
});
