/**
 * What the database enforces on `messaging_templates` (ROV-333): an institute reads the rows of
 * its own sender's account only, a reseller reads none, and only the platform role writes.
 * Each test assumes the role and attempts the read or write.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../seed/ids';
import { asInstitute, asReseller, become, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';

let pool: pg.Pool;
const inTx = (fn: (client: pg.PoolClient) => Promise<void>) => inRolledBackTx(pool, fn);

async function insertSender(client: pg.PoolClient, tenantId: string, account: string) {
  await client.query(
    `INSERT INTO messaging_senders
       (scope, tenant_id, channel, provider, provider_number_id, provider_account_id,
        display_number, daily_cap, created_by, updated_by)
     VALUES ('institute', $1, 'WHATSAPP', 'whatsapp_cloud', $2, $3, '+910000000000', 10, $4, $4)`,
    [tenantId, `rls-${randomUUID().slice(0, 12)}`, account, SYSTEM],
  );
}

async function insertTemplate(client: pg.PoolClient, account: string, name: string) {
  await client.query(
    `INSERT INTO messaging_templates
       (provider_account_id, name, language, declared_category, content_hash, created_by, updated_by)
     VALUES ($1, $2, 'en', 'UTILITY', 'h', $3, $3)`,
    [account, name, SYSTEM],
  );
}

const visibleNames = async (client: pg.PoolClient, names: string[]) =>
  (
    await client.query<{ name: string }>(
      'SELECT name FROM messaging_templates WHERE name = ANY($1) ORDER BY name',
      [names],
    )
  ).rows.map((r) => r.name);

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

describe('messaging_templates (ROV-333)', () => {
  it('has row-level security enabled and forced', async () => {
    await inTx(async (client) => {
      const { rows } = await client.query<{ enabled: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
           FROM pg_class WHERE oid = 'messaging_templates'::regclass`,
      );
      expect(rows[0]).toEqual({ enabled: true, forced: true });
    });
  });

  it("lets an institute read its own sender's account only, and a reseller nothing", async () => {
    await inTx(async (client) => {
      const run = randomUUID().slice(0, 8);
      const [accountA, accountB] = [`acct-a-${run}`, `acct-b-${run}`];
      const [own, other] = [`own_${run}`, `other_${run}`];
      await insertSender(client, SEED_IDS.INSTITUTE_1, accountA);
      await insertSender(client, SEED_IDS.INSTITUTE_2, accountB);
      await insertTemplate(client, accountA, own);
      await insertTemplate(client, accountB, other);

      await asInstitute(client, SEED_IDS.INSTITUTE_1);
      expect(await visibleNames(client, [own, other])).toEqual([own]);
      await asInstitute(client, SEED_IDS.INSTITUTE_2);
      expect(await visibleNames(client, [own, other])).toEqual([other]);
      await asReseller(client, SEED_IDS.RESELLER_DIRECT);
      await expectRefused(
        client,
        /permission denied/,
        'SELECT name FROM messaging_templates WHERE name = ANY($1)',
        [[own, other]],
      );
    });
  });

  it('refuses every write except the platform role', async () => {
    await inTx(async (client) => {
      const run = randomUUID().slice(0, 8);
      const account = `acct-w-${run}`;
      await insertSender(client, SEED_IDS.INSTITUTE_1, account);
      await insertTemplate(client, account, `w_${run}`);

      await asInstitute(client, SEED_IDS.INSTITUTE_1);
      await expectRefused(
        client,
        /permission denied/,
        `UPDATE messaging_templates SET status = 'APPROVED' WHERE name = $1`,
        [`w_${run}`],
      );
      await expectRefused(
        client,
        /permission denied/,
        `INSERT INTO messaging_templates
           (provider_account_id, name, language, declared_category, content_hash, created_by, updated_by)
         VALUES ($1, 'x', 'en', 'UTILITY', 'h', $2, $2)`,
        [account, SYSTEM],
      );
      await become(client, 'roviq_admin');
      await expectRefused(
        client,
        /permission denied/,
        'DELETE FROM messaging_templates WHERE name = $1',
        [`w_${run}`],
      );
      const updated = await client.query(
        `UPDATE messaging_templates SET status = 'APPROVED' WHERE name = $1`,
        [`w_${run}`],
      );
      expect(updated.rowCount).toBe(1);
    });
  });
});
