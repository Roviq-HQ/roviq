/**
 * The privileges and row policies of the application roles are written down in
 * `libs/database/privileges.manifest.txt` (ROV-385). This spec compares the file with the
 * database in both directions, holds the rules that keep a new table closed, and proves the
 * narrowed privileges by attempting each statement as the role.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectPrivileges,
  describeDiff,
  diffManifest,
  MANIFEST_ROLES,
  readManifest,
  writeManifest,
} from './privilege-manifest';
import { asInstitute, asReseller, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL, TEST_SUPERUSER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const DENIED = /permission denied/;

/** Policies that let a role pass every row, each with the reason it may. */
const ALWAYS_TRUE_POLICIES: Readonly<Record<string, string>> = {
  auth_events_app_insert:
    'A sign-in event is written before the institute is known; the table is append-only and the role cannot read it back.',
  auth_events_reseller_insert:
    'A sign-in event is written before the reseller is known; the table is append-only and the role cannot read it back.',
};

/** Privileges kept although no policy of the role lets a row through, each with the reason. */
const PRIVILEGES_WITHOUT_A_POLICY: Readonly<Record<string, string>> = {
  'roviq_app SELECT resellers':
    'The audit log query joins the reseller of each entry; for an institute the join finds no row.',
};

let pool: pg.Pool;
let owner: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 3 });
  owner = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

/** Run `fn` as the owner in a transaction that is always rolled back. */
async function asOwnerRolledBack(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('privilege manifest', () => {
  it('should match the database, grant for grant and policy for policy', async () => {
    const client = await owner.connect();
    try {
      const database = await collectPrivileges(client);
      if (process.env.UPDATE_PRIVILEGE_MANIFEST === '1') {
        writeManifest(database);
        return;
      }
      const diff = diffManifest(database, readManifest());
      expect(diff.onlyInDatabase.length + diff.onlyInManifest.length, describeDiff(diff)).toBe(0);
    } finally {
      client.release();
    }
  });

  it('should notice a grant, a column grant and a policy that nobody wrote down', async () => {
    await asOwnerRolledBack(async (client) => {
      await client.query('GRANT INSERT ON audit_logs TO roviq_app');
      await client.query('GRANT UPDATE (status) ON institutes TO roviq_reseller');
      await client.query(
        'CREATE POLICY probe_everything ON institutes FOR SELECT TO roviq_app USING (true)',
      );
      const diff = diffManifest(await collectPrivileges(client), readManifest());
      expect(diff.onlyInDatabase).toEqual(
        expect.arrayContaining([
          'grant  | roviq_app | audit_logs | INSERT | *',
          expect.stringMatching(/^grant {2}\| roviq_reseller \| institutes \| UPDATE \| .*status/),
          'policy | institutes | probe_everything | roviq_app | SELECT | using: true | check: ',
        ]),
      );
    });
  });

  it('should notice a privilege the file promises and the database lacks', async () => {
    await asOwnerRolledBack(async (client) => {
      await client.query('REVOKE SELECT ON institutes FROM roviq_app');
      const diff = diffManifest(await collectPrivileges(client), readManifest());
      expect(diff.onlyInManifest).toContain('grant  | roviq_app | institutes | SELECT | *');
    });
  });
});

describe('rules that keep a table closed', () => {
  it('should let no institute, reseller or person policy pass every row, except the listed ones', async () => {
    const { rows } = await owner.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'public'
          AND roles && ARRAY['roviq_app', 'roviq_reseller', 'roviq_user']::name[]
          AND (qual = 'true' OR with_check = 'true')
        ORDER BY policyname`,
    );
    expect(rows.map((row) => row.policyname)).toEqual(Object.keys(ALWAYS_TRUE_POLICIES).sort());
  });

  it('should hold no table privilege that no policy of the role can ever satisfy', async () => {
    const { rows } = await owner.query<{
      grantee: string;
      table_name: string;
      privilege_type: string;
    }>(
      `SELECT g.grantee, g.table_name, g.privilege_type
         FROM information_schema.role_table_grants g
         JOIN pg_class c ON c.relname = g.table_name
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = g.table_schema
        WHERE g.table_schema = 'public' AND c.relkind IN ('r', 'p')
          AND g.grantee IN ('roviq_app', 'roviq_reseller', 'roviq_user')
          AND NOT EXISTS (
            SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = g.table_name
               AND g.grantee = ANY (p.roles::text[])
               AND p.cmd IN (g.privilege_type, 'ALL')
               AND NOT (COALESCE(p.qual, '') = 'false'
                        OR (p.cmd = 'INSERT' AND COALESCE(p.with_check, '') = 'false'))
          )
        ORDER BY 1, 2, 3`,
    );
    expect(rows.map((row) => `${row.grantee} ${row.privilege_type} ${row.table_name}`)).toEqual(
      Object.keys(PRIVILEGES_WITHOUT_A_POLICY).sort(),
    );
  });

  it('should give no role an insert or delete on a view, and an update only where it may update the table', async () => {
    // SELECT … FOR UPDATE through a view needs UPDATE on the view; nothing else writes to one.
    const { rows } = await owner.query<{
      grantee: string;
      table_name: string;
      privilege_type: string;
    }>(
      `SELECT g.grantee, g.table_name, g.privilege_type
         FROM information_schema.role_table_grants g
         JOIN pg_class c ON c.relname = g.table_name
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = g.table_schema
        WHERE g.table_schema = 'public' AND c.relkind = 'v'
          AND g.grantee = ANY($1)
          AND CASE
                WHEN g.privilege_type = 'SELECT' THEN false
                WHEN g.privilege_type <> 'UPDATE' THEN true
                -- CASE keeps the privilege lookup away from rows that are not views.
                WHEN to_regclass(format('public.%I', left(g.table_name, -5))) IS NULL THEN true
                ELSE NOT (
                  has_table_privilege(g.grantee, format('public.%I', left(g.table_name, -5)), 'UPDATE')
                  OR has_any_column_privilege(g.grantee, format('public.%I', left(g.table_name, -5)), 'UPDATE')
                )
              END`,
      [[...MANIFEST_ROLES]],
    );
    expect(rows).toEqual([]);
  });

  it('should give the institute and reseller roles nothing by default on a new table', async () => {
    const { rows } = await owner.query<{ acl: string }>(
      `SELECT defaclacl::text AS acl FROM pg_default_acl a
         JOIN pg_namespace n ON n.oid = a.defaclnamespace
        WHERE n.nspname = 'public' AND a.defaclobjtype = 'r'`,
    );
    for (const row of rows) {
      expect(row.acl).not.toMatch(/roviq_app=|roviq_reseller=|roviq_user=/);
    }
  });

  it('should force row security on a table the moment it is created, and let no application role read it', async () => {
    await asOwnerRolledBack(async (client) => {
      await client.query('CREATE TABLE public.privilege_probe (id int, secret text)');
      await client.query("INSERT INTO public.privilege_probe VALUES (1, 'x')");
      const { rows } = await client.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
           FROM pg_class WHERE oid = 'public.privilege_probe'::regclass`,
      );
      expect(rows).toEqual([{ enabled: true, forced: true }]);

      for (const role of ['roviq_app', 'roviq_reseller', 'roviq_user', 'roviq_audit_writer']) {
        await client.query(`SET LOCAL ROLE ${role}`);
        await expectRefused(client, DENIED, 'SELECT * FROM public.privilege_probe');
        await expectRefused(client, DENIED, 'INSERT INTO public.privilege_probe VALUES (2)');
        await client.query('RESET ROLE');
      }

      // With row security forced and no policy, even a role that is granted the table reads nothing.
      await client.query('GRANT SELECT ON public.privilege_probe TO roviq_app');
      await client.query('SET LOCAL ROLE roviq_app');
      expect((await client.query('SELECT * FROM public.privilege_probe')).rows).toEqual([]);
    });
  });
});

interface Party {
  resellerId: string;
  groupId: string;
  instituteId: string;
}

/** A reseller with a group and an institute in it. Runs as `roviq_admin`. */
async function createParty(client: pg.PoolClient): Promise<Party> {
  const tag = randomUUID().slice(0, 8);
  const one = async (text: string, params: unknown[]): Promise<string> =>
    (await client.query<{ id: string }>(text, params)).rows[0].id;
  const resellerId = await one(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-385 ${tag}`, `rov385-${tag}`, SYSTEM],
  );
  const groupId = await one(
    `INSERT INTO institute_groups (name, code, type, reseller_id, created_by, updated_by)
     VALUES ($1, $2, 'TRUST', $3, $4, $4) RETURNING id`,
    [`ROV-385 group ${tag}`, `R385${tag}`, resellerId, SYSTEM],
  );
  const instituteId = await one(
    `INSERT INTO institutes (name, slug, reseller_id, group_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [JSON.stringify({ en: `ROV-385 ${tag}` }), `rov385-inst-${tag}`, resellerId, groupId, SYSTEM],
  );
  return { resellerId, groupId, instituteId };
}

const INSERT_AUDIT = `INSERT INTO audit_logs
  (scope, tenant_id, reseller_id, user_id, actor_id, action, action_type, entity_type, correlation_id, source)
  VALUES ($1, $2, $3, $4, $4, 'rov385', 'CREATE', 'Test', uuidv7(), 'TEST')`;

describe('audit rows are written by the audit writer and the platform only', () => {
  it('should refuse an institute inserting a row, even for itself', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asInstitute(client, a.instituteId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['institute', a.instituteId, null, SYSTEM]);
    });
  });

  it('should refuse a reseller inserting a row, even for itself', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asReseller(client, a.resellerId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['reseller', null, a.resellerId, SYSTEM]);
    });
  });
});

describe('what a reseller may write on its institutes', () => {
  it('should refuse creating an institute', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asReseller(client, a.resellerId);
      await expectRefused(
        client,
        DENIED,
        `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
         VALUES ('{"en":"x"}', $1, $2, $3, $3)`,
        [`rov385-new-${randomUUID().slice(0, 8)}`, a.resellerId, SYSTEM],
      );
    });
  });

  it.each([
    ['reseller_id', 'reseller_id = reseller_id'],
    ['status', "status = 'SUSPENDED'"],
    ['first_admin_user_id', 'first_admin_user_id = NULL'],
    ['name', `name = '{"en":"renamed"}'`],
    ['code', "code = 'TAKEN'"],
    ['slug', "slug = 'taken'"],
    ['deleted_at', 'deleted_at = now()'],
  ])('should refuse changing %s of its own institute', async (_column, assignment) => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asReseller(client, a.resellerId);
      await expectRefused(client, DENIED, `UPDATE institutes SET ${assignment} WHERE id = $1`, [
        a.instituteId,
      ]);
    });
  });

  it('should let it take its own institute out of a group, and no other reseller’s', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      await asReseller(client, a.resellerId);
      const own = await client.query(
        'UPDATE institutes SET group_id = NULL, updated_at = now() WHERE id = $1',
        [a.instituteId],
      );
      expect(own.rowCount).toBe(1);
      const other = await client.query('UPDATE institutes SET group_id = NULL WHERE id = $1', [
        b.instituteId,
      ]);
      expect(other.rowCount).toBe(0);
    });
  });

  it('should let it move its institute into its own group, and into no other reseller’s', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      const tag = randomUUID().slice(0, 8);
      const secondGroup = await client.query<{ id: string }>(
        `INSERT INTO institute_groups (name, code, type, reseller_id, created_by, updated_by)
         VALUES ($1, $2, 'TRUST', $3, $4, $4) RETURNING id`,
        [`ROV-385 second ${tag}`, `R385B${tag}`, a.resellerId, SYSTEM],
      );
      await asReseller(client, a.resellerId);
      const own = await client.query('UPDATE institutes SET group_id = $2 WHERE id = $1', [
        a.instituteId,
        secondGroup.rows[0].id,
      ]);
      expect(own.rowCount).toBe(1);
      await expectRefused(
        client,
        /row-level security/,
        'UPDATE institutes SET group_id = $2 WHERE id = $1',
        [a.instituteId, b.groupId],
      );
    });
  });
});

describe('what an institute may write on its own row', () => {
  it('should refuse changing its code', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asInstitute(client, a.instituteId);
      await expectRefused(client, DENIED, "UPDATE institutes SET code = 'MINE' WHERE id = $1", [
        a.instituteId,
      ]);
    });
  });

  it('should still let it change its name', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asInstitute(client, a.instituteId);
      const res = await client.query(
        `UPDATE institutes SET name = '{"en":"renamed"}' WHERE id = $1`,
        [a.instituteId],
      );
      expect(res.rowCount).toBe(1);
    });
  });
});
