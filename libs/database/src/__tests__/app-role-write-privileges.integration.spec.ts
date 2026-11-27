/**
 * What the institute and reseller roles may not write, attempted as the role (ROV-385): audit
 * rows, a reseller's institutes beyond the group column, and an institute's own code.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asInstitute, asReseller, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL, TEST_SUPERUSER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';
const DENIED = /permission denied/;

let pool: pg.Pool;
let owner: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 3 });
  owner = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 1 });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
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

describe('only the platform deletes or restores an institute', () => {
  it('should refuse a reseller soft-deleting its own institute even when it holds the column', async () => {
    // The reseller role holds no privilege on deleted_at, so the trigger behind it never runs
    // for it. Here the privilege is granted first, and the trigger alone must refuse.
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      const a = await createParty(client);
      await client.query('GRANT UPDATE (deleted_at) ON institutes TO roviq_reseller');
      await asReseller(client, a.resellerId);
      await expectRefused(
        client,
        /only the platform can delete or restore an institute/,
        'UPDATE institutes SET deleted_at = now() WHERE id = $1',
        [a.instituteId],
      );
      await client.query('RESET ROLE');
      const kept = await client.query('SELECT deleted_at FROM institutes WHERE id = $1', [
        a.instituteId,
      ]);
      expect(kept.rows).toEqual([{ deleted_at: null }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
