/**
 * Row rules of `institute_group_branding` and of inserts into `audit_logs` (ROV-371), proved
 * by attempting each statement as the database role.
 *
 * Group branding is written by the platform only; an institute reads the branding of its own
 * group. Audit rows are written by the audit writer and the platform: an institute or reseller
 * role inserts none.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asInstitute, asReseller, become, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
// Neither role holds the write privilege, so the refusal comes before any row rule.
const DENIED = /permission denied/;

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 3 });
});

afterAll(async () => {
  await pool.end();
});

interface Party {
  resellerId: string;
  groupId: string;
  instituteId: string;
  brandingId: string;
}

/** A reseller, a group with branding, and an institute in that group. Runs as `roviq_admin`. */
async function createParty(client: pg.PoolClient): Promise<Party> {
  const tag = randomUUID().slice(0, 8);
  const one = async (text: string, params: unknown[]): Promise<string> =>
    (await client.query<{ id: string }>(text, params)).rows[0].id;

  const resellerId = await one(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-371 ${tag}`, `rov371-${tag}`, SYSTEM],
  );
  const groupId = await one(
    `INSERT INTO institute_groups (name, code, type, reseller_id, created_by, updated_by)
     VALUES ($1, $2, 'TRUST', $3, $4, $4) RETURNING id`,
    [`ROV-371 group ${tag}`, `R371${tag}`, resellerId, SYSTEM],
  );
  const instituteId = await one(
    `INSERT INTO institutes (name, slug, reseller_id, group_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [JSON.stringify({ en: `ROV-371 ${tag}` }), `rov371-inst-${tag}`, resellerId, groupId, SYSTEM],
  );
  const brandingId = await one(
    `INSERT INTO institute_group_branding (group_id, primary_color, created_by, updated_by)
     VALUES ($1, '#111111', $2, $2) RETURNING id`,
    [groupId, SYSTEM],
  );
  return { resellerId, groupId, instituteId, brandingId };
}

const INSERT_AUDIT = `INSERT INTO audit_logs
  (scope, tenant_id, reseller_id, user_id, actor_id, action, action_type, entity_type, correlation_id, source)
  VALUES ($1, $2, $3, $4, $4, 'rov371', 'CREATE', 'Test', uuidv7(), 'TEST')`;

describe('institute_group_branding', () => {
  it('an institute reads the branding of its own group and no other', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      await asInstitute(client, a.instituteId);
      const rows = await client.query<{ id: string }>(
        'SELECT id FROM institute_group_branding WHERE id = ANY($1)',
        [[a.brandingId, b.brandingId]],
      );
      expect(rows.rows.map((r) => r.id)).toEqual([a.brandingId]);
      const live = await client.query<{ id: string }>(
        'SELECT id FROM institute_group_branding_live WHERE id = ANY($1)',
        [[a.brandingId, b.brandingId]],
      );
      expect(live.rows.map((r) => r.id)).toEqual([a.brandingId]);
    });
  });

  it('an institute cannot insert group branding, for another group or its own', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const other = await client.query<{ id: string }>(
        `INSERT INTO institute_groups (name, code, type, created_by, updated_by)
         VALUES ('ROV-371 bare', $1, 'TRUST', $2, $2) RETURNING id`,
        [`R371B${randomUUID().slice(0, 6)}`, SYSTEM],
      );
      await asInstitute(client, a.instituteId);
      const insert = `INSERT INTO institute_group_branding (group_id, created_by, updated_by) VALUES ($1, $2, $2)`;
      await expectRefused(client, DENIED, insert, [other.rows[0].id, SYSTEM]);
      await expectRefused(client, DENIED, insert, [a.groupId, SYSTEM]);
    });
  });

  it('an institute cannot change or delete group branding, of another group or its own', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      await asInstitute(client, a.instituteId);
      for (const id of [a.brandingId, b.brandingId]) {
        await expectRefused(
          client,
          DENIED,
          `UPDATE institute_group_branding SET primary_color = '#ff0000' WHERE id = $1`,
          [id],
        );
        await expectRefused(client, DENIED, 'DELETE FROM institute_group_branding WHERE id = $1', [
          id,
        ]);
      }
      await become(client, 'roviq_admin');
      const after = await client.query<{ primary_color: string }>(
        'SELECT primary_color FROM institute_group_branding WHERE id = ANY($1)',
        [[a.brandingId, b.brandingId]],
      );
      expect(after.rows.map((r) => r.primary_color)).toEqual(['#111111', '#111111']);
    });
  });

  it('the platform role writes group branding', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const updated = await client.query(
        `UPDATE institute_group_branding SET primary_color = '#222222' WHERE id = $1`,
        [a.brandingId],
      );
      expect(updated.rowCount).toBe(1);
    });
  });

  it('only the platform and institute roles have a policy on the table', async () => {
    await inRolledBackTx(pool, async (client) => {
      const policies = await client.query<{ policyname: string; cmd: string; roles: string }>(
        `SELECT policyname, cmd, roles::text FROM pg_policies
         WHERE tablename = 'institute_group_branding' ORDER BY policyname`,
      );
      expect(policies.rows).toEqual([
        { policyname: 'institute_group_branding_admin_all', cmd: 'ALL', roles: '{roviq_admin}' },
        { policyname: 'institute_group_branding_app_select', cmd: 'SELECT', roles: '{roviq_app}' },
      ]);
    });
  });
});

describe('audit_logs inserts by the institute and reseller roles', () => {
  it('an institute cannot insert a row, even for itself', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asInstitute(client, a.instituteId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['institute', a.instituteId, null, SYSTEM]);
    });
  });

  it('an institute cannot insert a row for another institute', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      await asInstitute(client, a.instituteId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['institute', b.instituteId, null, SYSTEM]);
    });
  });

  it('an institute cannot insert a platform or reseller row', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asInstitute(client, a.instituteId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['platform', null, null, SYSTEM]);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['reseller', null, a.resellerId, SYSTEM]);
    });
  });

  it('an institute cannot insert a row that names a subject institute', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      await asInstitute(client, a.instituteId);
      await expectRefused(
        client,
        DENIED,
        `INSERT INTO audit_logs
          (scope, tenant_id, subject_tenant_id, user_id, actor_id, action, action_type, entity_type, correlation_id, source)
         VALUES ('institute', $1, $2, $3, $3, 'rov371', 'CREATE', 'Test', uuidv7(), 'TEST')`,
        [a.instituteId, b.instituteId, SYSTEM],
      );
    });
  });

  it('a reseller cannot insert a row, even for itself', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asReseller(client, a.resellerId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['reseller', null, a.resellerId, SYSTEM]);
    });
  });

  it('a reseller cannot insert a row for another reseller', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      const b = await createParty(client);
      await asReseller(client, a.resellerId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['reseller', null, b.resellerId, SYSTEM]);
    });
  });

  it('a reseller cannot insert a platform row or an institute row, even of its own institute', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await asReseller(client, a.resellerId);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['platform', null, null, SYSTEM]);
      await expectRefused(client, DENIED, INSERT_AUDIT, ['institute', a.instituteId, null, SYSTEM]);
    });
  });

  it('no context set: neither role can insert', async () => {
    await inRolledBackTx(pool, async (client) => {
      const a = await createParty(client);
      await become(client, 'roviq_app');
      await expectRefused(client, DENIED, INSERT_AUDIT, ['institute', a.instituteId, null, SYSTEM]);
      await become(client, 'roviq_reseller');
      await expectRefused(client, DENIED, INSERT_AUDIT, ['reseller', null, a.resellerId, SYSTEM]);
    });
  });
});
