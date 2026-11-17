/**
 * ROV-88 + ROV-91 RLS Security Invariant Tests (Auth PRD §4, §5).
 *
 * Covers:
 *   1. platform_memberships: only roviq_admin can read (no grant, no policy for app/reseller)
 *   2. reseller_memberships: roviq_reseller sees own, cross-reseller isolation
 *   10-11. membership table privileges, reseller read access to institute memberships
 *   3. roles scope CHECK: platform role with tenant_id → constraint violation
 *   4. impersonation_sessions: CHECK expires_at > started_at + 1 hour → rejected
 *   5. auth_events: roviq_app can INSERT but not SELECT/UPDATE/DELETE
 *
 * All tests use real PostgreSQL with SET LOCAL ROLE.
 * Each test wraps in a transaction with ROLLBACK — no data leaks.
 *
 * Run: pnpm nx test database --testPathPattern=membership-rls-invariants
 * Requires: seeded DB (pnpm db:reset --seed)
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMembership, TEST_POOLER_URL, TEST_SUPERUSER_URL } from './test-helpers';

const SEED = {
  RESELLER_DIRECT: '00000000-0000-7000-a000-000000000011',
  ROLE_PLATFORM_ADMIN: '00000000-0000-7000-a000-000000000301',
  ROLE_RESELLER_FULL_ADMIN: '00000000-0000-7000-a000-000000000311',
  INSTITUTE_1: '00000000-0000-7000-a000-000000000101',
  USER_ADMIN: '00000000-0000-7000-a000-000000000201',
};

let poolerPool: pg.Pool;
let superPool: pg.Pool;

async function asRole(
  role: string,
  vars: Record<string, string>,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await poolerPool.connect();
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

beforeAll(async () => {
  poolerPool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 5 });
  superPool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  const res = await poolerPool.query('SELECT 1 as ok');
  expect(res.rows[0].ok).toBe(1);
});

afterAll(async () => {
  await poolerPool.end();
  await superPool.end();
});

// ═══════════════════════════════════════════════════════
// ROV-88 Invariant 1: platform_memberships — admin-only access
// ═══════════════════════════════════════════════════════

describe('ROV-88 Invariant 1: platform_memberships is admin-only', () => {
  it('roviq_app cannot SELECT from platform_memberships', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      await expect(client.query('SELECT * FROM platform_memberships')).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('roviq_reseller cannot SELECT from platform_memberships', async () => {
    await asRole(
      'roviq_reseller',
      { 'app.current_reseller_id': SEED.RESELLER_DIRECT },
      async (client) => {
        await expect(client.query('SELECT * FROM platform_memberships')).rejects.toThrow(
          /permission denied/,
        );
      },
    );
  });

  it('roviq_admin can SELECT from platform_memberships', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      const res = await client.query('SELECT count(*) FROM platform_memberships');
      expect(Number(res.rows[0].count)).toBeGreaterThanOrEqual(1);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-88 Invariant 2: reseller_memberships isolation
// ═══════════════════════════════════════════════════════

describe('ROV-88 Invariant 2: reseller_memberships cross-reseller isolation', () => {
  it('roviq_reseller with fake reseller_id sees 0 reseller_memberships', async () => {
    const fakeResellerId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    await asRole(
      'roviq_reseller',
      { 'app.current_reseller_id': fakeResellerId },
      async (client) => {
        const res = await client.query('SELECT * FROM reseller_memberships');
        expect(res.rows).toHaveLength(0);
      },
    );
  });

  it('roviq_reseller sees only its own reseller_memberships', async () => {
    await asRole(
      'roviq_reseller',
      { 'app.current_reseller_id': SEED.RESELLER_DIRECT },
      async (client) => {
        const res = await client.query('SELECT DISTINCT reseller_id FROM reseller_memberships');
        expect(res.rows).toEqual([{ reseller_id: SEED.RESELLER_DIRECT }]);
      },
    );
  });

  it('roviq_app cannot SELECT from reseller_memberships', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      await expect(client.query('SELECT * FROM reseller_memberships')).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('roviq_app cannot INSERT into reseller_memberships', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      await expect(
        client.query(
          `INSERT INTO reseller_memberships (user_id, role_id, reseller_id, created_by, updated_by)
           VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000')`,
          [SEED.USER_ADMIN, SEED.ROLE_RESELLER_FULL_ADMIN, SEED.RESELLER_DIRECT],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-88 Invariant 10: membership table privileges
// ═══════════════════════════════════════════════════════

describe('ROV-88 Invariant 10: membership table privileges', () => {
  it('roviq_app and roviq_reseller hold only the privileges their policies need', async () => {
    const res = await superPool.query(
      `SELECT t AS "table", r AS role, p AS privilege, has_table_privilege(r, t, p) AS granted
       FROM unnest(ARRAY[
              'platform_memberships', 'platform_memberships_live',
              'reseller_memberships', 'reseller_memberships_live'
            ]) t,
            unnest(ARRAY['roviq_app', 'roviq_reseller']) r,
            unnest(ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']) p
       ORDER BY t, r, p`,
    );
    const row = (table: string, role: string, granted: boolean) =>
      ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((privilege) => ({
        table,
        role,
        privilege,
        granted,
      }));
    // A reseller holds SELECT only on the live view
    const liveRow = (table: string, role: string) =>
      ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((privilege) => ({
        table,
        role,
        privilege,
        granted: privilege === 'SELECT',
      }));
    expect(res.rows).toEqual([
      ...row('platform_memberships', 'roviq_app', false),
      ...row('platform_memberships', 'roviq_reseller', false),
      ...row('platform_memberships_live', 'roviq_app', false),
      ...row('platform_memberships_live', 'roviq_reseller', false),
      ...row('reseller_memberships', 'roviq_app', false),
      ...row('reseller_memberships', 'roviq_reseller', true),
      ...row('reseller_memberships_live', 'roviq_app', false),
      ...liveRow('reseller_memberships_live', 'roviq_reseller'),
    ]);
  });
});

// ═══════════════════════════════════════════════════════
// ROV-88 Invariant 11: reseller read access to institute memberships
// ═══════════════════════════════════════════════════════

describe('ROV-88 Invariant 11: memberships reseller read', () => {
  // Superuser builds a second reseller + institute + membership, then drops to
  // roviq_reseller inside the same transaction so nothing is committed.
  async function withOtherResellerMembership(
    fn: (client: pg.PoolClient, other: { resellerId: string; tenantId: string }) => Promise<void>,
  ): Promise<void> {
    const client = await superPool.connect();
    try {
      await client.query('BEGIN');
      const suffix = randomUUID().slice(0, 8);
      const reseller = await client.query(
        `INSERT INTO resellers (name, slug, created_by, updated_by)
         VALUES ($1, $2, $3, $3) RETURNING id`,
        [`ROV-88 Reseller ${suffix}`, `rov-88-reseller-${suffix}`, SEED.USER_ADMIN],
      );
      const resellerId: string = reseller.rows[0].id;
      const institute = await client.query(
        `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [
          { en: `ROV-88 Institute ${suffix}` },
          `rov-88-institute-${suffix}`,
          resellerId,
          SEED.USER_ADMIN,
        ],
      );
      const tenantId: string = institute.rows[0].id;
      const role = await client.query(
        `INSERT INTO roles (scope, tenant_id, name, abilities, created_by, updated_by)
         VALUES ('institute', $1, $2, '[]', $3, $3) RETURNING id`,
        [tenantId, { en: 'ROV-88 Role' }, SEED.USER_ADMIN],
      );
      await createMembership(client, randomUUID(), SEED.USER_ADMIN, tenantId, role.rows[0].id);
      await fn(client, { resellerId, tenantId });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  async function becomeReseller(client: pg.PoolClient, resellerId: string): Promise<void> {
    await client.query('SET LOCAL ROLE roviq_reseller');
    await client.query(`SELECT set_config('app.current_reseller_id', $1, true)`, [resellerId]);
  }

  it('a reseller reads memberships of its own institutes only', async () => {
    await withOtherResellerMembership(async (client, other) => {
      await becomeReseller(client, other.resellerId);
      const res = await client.query('SELECT DISTINCT tenant_id FROM memberships');
      expect(res.rows).toEqual([{ tenant_id: other.tenantId }]);
    });
  });

  it("a reseller cannot read memberships of another reseller's institute", async () => {
    await withOtherResellerMembership(async (client, other) => {
      await becomeReseller(client, SEED.RESELLER_DIRECT);
      const own = await client.query('SELECT count(*) FROM memberships WHERE tenant_id = $1', [
        SEED.INSTITUTE_1,
      ]);
      expect(Number(own.rows[0].count)).toBeGreaterThanOrEqual(1);
      const foreign = await client.query('SELECT count(*) FROM memberships WHERE tenant_id = $1', [
        other.tenantId,
      ]);
      expect(Number(foreign.rows[0].count)).toBe(0);
    });
  });

  it('a reseller cannot write memberships', async () => {
    await asRole(
      'roviq_reseller',
      { 'app.current_reseller_id': SEED.RESELLER_DIRECT },
      async (client) => {
        await expect(
          client.query(`UPDATE memberships SET status = 'SUSPENDED' WHERE tenant_id = $1`, [
            SEED.INSTITUTE_1,
          ]),
        ).rejects.toThrow(/permission denied/);
      },
    );
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 3: roles scope CHECK constraint
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 3: chk_role_scope CHECK constraint', () => {
  it('platform role with tenant_id violates chk_role_scope', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO roles (scope, tenant_id, reseller_id, name, abilities, created_by, updated_by)
           VALUES ('platform', $1, NULL, '{"en":"bad_platform_role"}', '[]', $2, $2)`,
          [SEED.INSTITUTE_1, SEED.USER_ADMIN],
        ),
      ).rejects.toThrow(/chk_role_scope/);
    });
  });

  it('reseller role without reseller_id violates chk_role_scope', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO roles (scope, tenant_id, reseller_id, name, abilities, created_by, updated_by)
           VALUES ('reseller', NULL, NULL, '{"en":"bad_reseller_role"}', '[]', $1, $1)`,
          [SEED.USER_ADMIN],
        ),
      ).rejects.toThrow(/chk_role_scope/);
    });
  });

  it('institute role without tenant_id violates chk_role_scope', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO roles (scope, tenant_id, reseller_id, name, abilities, created_by, updated_by)
           VALUES ('institute', NULL, NULL, '{"en":"bad_institute_role"}', '[]', $1, $1)`,
          [SEED.USER_ADMIN],
        ),
      ).rejects.toThrow(/chk_role_scope/);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 4: impersonation_sessions — 1-hour CHECK
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 4: impersonation_sessions max 1-hour constraint', () => {
  it('expires_at > started_at + 1 hour → chk_max_duration violation', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO impersonation_sessions
           (impersonator_id, impersonator_scope, target_user_id, target_tenant_id,
            reason, started_at, expires_at)
           VALUES ($1, 'platform', $1, $2,
                   'Valid reason longer than ten chars', now(), now() + interval '2 hours')`,
          [SEED.USER_ADMIN, SEED.INSTITUTE_1],
        ),
      ).rejects.toThrow(/chk_max_duration/);
    });
  });

  it('reason shorter than 10 chars → chk_reason_length violation', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO impersonation_sessions
           (impersonator_id, impersonator_scope, target_user_id, target_tenant_id,
            reason, started_at, expires_at)
           VALUES ($1, 'platform', $1, $2,
                   'short', now(), now() + interval '30 minutes')`,
          [SEED.USER_ADMIN, SEED.INSTITUTE_1],
        ),
      ).rejects.toThrow(/chk_reason_length/);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 5: auth_events — insert-only for roviq_app
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 5: auth_events INSERT-only for roviq_app', () => {
  it('roviq_app can INSERT an auth_event', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      // No RETURNING — the invariant is INSERT-only; RETURNING would require
      // SELECT privilege on the returned column, which roviq_app must not have.
      const res = await client.query(
        `INSERT INTO auth_events (user_id, event_type, scope, tenant_id)
         VALUES ($1, 'login_success', 'institute', $2)`,
        [SEED.USER_ADMIN, SEED.INSTITUTE_1],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it('roviq_app cannot SELECT from auth_events (no SELECT policy)', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      await expect(client.query('SELECT * FROM auth_events LIMIT 1')).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('roviq_app cannot DELETE from auth_events (no DELETE policy)', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      await expect(
        client.query('DELETE FROM auth_events WHERE user_id = $1', [SEED.USER_ADMIN]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 6: System roles seed
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 6: system roles seeded correctly', () => {
  it('all 5 system roles exist with correct scope', async () => {
    const res = await superPool.query(
      `SELECT id, scope, reseller_id, is_system, name->>'en' as name_en
       FROM roles
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [
        [
          '00000000-0000-7000-a000-000000000301',
          '00000000-0000-7000-a000-000000000302',
          '00000000-0000-7000-a000-000000000311',
          '00000000-0000-7000-a000-000000000312',
          '00000000-0000-7000-a000-000000000313',
        ],
      ],
    );
    expect(res.rows).toHaveLength(5);

    const byId = new Map(res.rows.map((r) => [r.id, r]));

    const platformAdmin = byId.get('00000000-0000-7000-a000-000000000301');
    expect(platformAdmin?.scope).toBe('platform');
    expect(platformAdmin?.reseller_id).toBeNull();
    expect(platformAdmin?.is_system).toBe(true);
    expect(platformAdmin?.name_en).toBe('platform_admin');

    const resellerFull = byId.get('00000000-0000-7000-a000-000000000311');
    expect(resellerFull?.scope).toBe('reseller');
    expect(resellerFull?.reseller_id).toBe(SEED.RESELLER_DIRECT);
    expect(resellerFull?.is_system).toBe(true);
    expect(resellerFull?.name_en).toBe('reseller_full_admin');
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 7: scope columns reject unknown values
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 7: scope columns reject unknown values', () => {
  it('role with an unknown scope violates chk_role_scope', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO roles (scope, tenant_id, reseller_id, name, abilities, created_by, updated_by)
           VALUES ('galaxy', NULL, NULL, '{"en":"unknown_scope_role"}', '[]', $1, $1)`,
          [SEED.USER_ADMIN],
        ),
      ).rejects.toThrow(/chk_role_scope/);
    });
  });

  it('refresh token with an unknown membership_scope violates its CHECK', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO refresh_tokens (user_id, membership_id, membership_scope, token_hash, expires_at, created_by, updated_by)
           VALUES ($1, uuidv7(), 'galaxy', 'rov-91-hash', now() + interval '1 day', $1, $1)`,
          [SEED.USER_ADMIN],
        ),
      ).rejects.toThrow(/chk_refresh_token_membership_scope/);
    });
  });

  it('impersonation session with an unknown impersonator_scope violates its CHECK', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        client.query(
          `INSERT INTO impersonation_sessions
           (impersonator_id, impersonator_scope, target_user_id, target_tenant_id,
            reason, started_at, expires_at)
           VALUES ($1, 'galaxy', $1, $2,
                   'Valid reason longer than ten chars', now(), now() + interval '30 minutes')`,
          [SEED.USER_ADMIN, SEED.INSTITUTE_1],
        ),
      ).rejects.toThrow(/chk_impersonator_scope/);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 8: platform / reseller role names are unique
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 8: platform and reseller role name uniqueness', () => {
  const insertRole = (
    client: pg.PoolClient,
    scope: string,
    resellerId: string | null,
    name: string,
  ) =>
    client.query(
      `INSERT INTO roles (scope, tenant_id, reseller_id, name, abilities, created_by, updated_by)
       VALUES ($1, NULL, $2, $3, '[]', $4, $4)`,
      [scope, resellerId, JSON.stringify({ en: name }), SEED.USER_ADMIN],
    );

  it('rejects a second platform role with an existing name', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(insertRole(client, 'platform', null, 'platform_admin')).rejects.toThrow(
        /roles_platform_name_key/,
      );
    });
  });

  it('rejects a second role with the same name under the same reseller', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await expect(
        insertRole(client, 'reseller', SEED.RESELLER_DIRECT, 'reseller_full_admin'),
      ).rejects.toThrow(/roles_reseller_id_name_key/);
    });
  });

  it('allows the same role name under a different reseller', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      const reseller = await client.query(
        `INSERT INTO resellers (name, slug, created_by, updated_by)
         VALUES ('ROV-91 Reseller', 'rov-91-uniq-reseller', $1, $1) RETURNING id`,
        [SEED.USER_ADMIN],
      );
      const res = await insertRole(client, 'reseller', reseller.rows[0].id, 'reseller_full_admin');
      expect(res.rowCount).toBe(1);
    });
  });

  it('allows a name to be reused once the earlier role is soft-deleted', async () => {
    await asRole('roviq_admin', {}, async (client) => {
      await insertRole(client, 'platform', null, 'rov_91_reusable');
      await client.query(
        `UPDATE roles SET deleted_at = now() WHERE scope = 'platform' AND name->>'en' = 'rov_91_reusable'`,
      );
      const res = await insertRole(client, 'platform', null, 'rov_91_reusable');
      expect(res.rowCount).toBe(1);
    });
  });
});

// ═══════════════════════════════════════════════════════
// ROV-91 Invariant 9: auth_events table privileges are INSERT-only
// ═══════════════════════════════════════════════════════

describe('ROV-91 Invariant 9: auth_events table privileges', () => {
  it('roviq_app and roviq_reseller hold INSERT and nothing else', async () => {
    const res = await superPool.query(
      `SELECT r AS role, p AS privilege, has_table_privilege(r, 'auth_events', p) AS granted
       FROM unnest(ARRAY['roviq_app', 'roviq_reseller']) r,
            unnest(ARRAY['INSERT', 'SELECT', 'UPDATE', 'DELETE']) p
       ORDER BY r, p`,
    );
    expect(res.rows).toEqual([
      { role: 'roviq_app', privilege: 'DELETE', granted: false },
      { role: 'roviq_app', privilege: 'INSERT', granted: true },
      { role: 'roviq_app', privilege: 'SELECT', granted: false },
      { role: 'roviq_app', privilege: 'UPDATE', granted: false },
      { role: 'roviq_reseller', privilege: 'DELETE', granted: false },
      { role: 'roviq_reseller', privilege: 'INSERT', granted: true },
      { role: 'roviq_reseller', privilege: 'SELECT', granted: false },
      { role: 'roviq_reseller', privilege: 'UPDATE', granted: false },
    ]);
  });

  it('roviq_app cannot UPDATE auth_events', async () => {
    await asRole('roviq_app', { 'app.current_tenant_id': SEED.INSTITUTE_1 }, async (client) => {
      await expect(client.query(`UPDATE auth_events SET event_type = 'tampered'`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('roviq_reseller can INSERT but cannot SELECT auth_events', async () => {
    await asRole(
      'roviq_reseller',
      { 'app.current_reseller_id': SEED.RESELLER_DIRECT },
      async (client) => {
        const res = await client.query(
          `INSERT INTO auth_events (user_id, event_type, scope, reseller_id)
           VALUES ($1, 'login_success', 'reseller', $2)`,
          [SEED.USER_ADMIN, SEED.RESELLER_DIRECT],
        );
        expect(res.rowCount).toBe(1);
        await client.query('SAVEPOINT before_select');
        await expect(client.query('SELECT * FROM auth_events LIMIT 1')).rejects.toThrow(
          /permission denied/,
        );
      },
    );
  });
});
