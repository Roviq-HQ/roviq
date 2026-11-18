import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AbilityRule } from '@roviq/common-types';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../providers';
import { RESELLER_SYSTEM_ROLE_ABILITIES } from '../reseller-system-roles';
import { roles } from '../schema';
import { makeSeedTestDb } from '../seed/__tests__/seed-test-helpers';
import { SEED_IDS } from '../seed/ids';

class Rollback extends Error {}

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const READ_USER: AbilityRule = { action: 'read', subject: 'User' };

const { pool, db } = makeSeedTestDb();

afterAll(async () => {
  await pool.end();
});

async function inRolledBackTx(fn: (tx: DrizzleDB) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
}

async function abilitiesOf(tx: DrizzleDB, roleId: string): Promise<AbilityRule[]> {
  const [row] = await tx
    .select({ abilities: roles.abilities })
    .from(roles)
    .where(eq(roles.id, roleId));
  assert(row);
  return row.abilities as AbilityRule[];
}

describe('ROV-101 reseller_full_admin read-User backfill migration', () => {
  const migrationDir = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith('_rov-101-reseller-full-admin-reads-users'),
  );
  assert(migrationDir);
  const migration = readFileSync(join(MIGRATIONS_DIR, migrationDir, 'migration.sql'), 'utf8');
  const runBackfill = (tx: DrizzleDB) => tx.execute(sql.raw(migration));

  const withoutReadUser = RESELLER_SYSTEM_ROLE_ABILITIES.reseller_full_admin.filter(
    (rule) => !(rule.action === READ_USER.action && rule.subject === READ_USER.subject),
  );

  it('adds read User to a stored reseller_full_admin role that lacks it', async () => {
    await inRolledBackTx(async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: withoutReadUser })
        .where(eq(roles.id, SEED_IDS.ROLE_RESELLER_FULL_ADMIN));

      await runBackfill(tx);

      const abilities = await abilitiesOf(tx, SEED_IDS.ROLE_RESELLER_FULL_ADMIN);
      expect(abilities).toContainEqual(READ_USER);
      expect(abilities).toHaveLength(withoutReadUser.length + 1);
    });
  });

  it('does not add the grant twice', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await abilitiesOf(tx, SEED_IDS.ROLE_RESELLER_FULL_ADMIN);
      expect(before).toContainEqual(READ_USER);

      await runBackfill(tx);

      expect(await abilitiesOf(tx, SEED_IDS.ROLE_RESELLER_FULL_ADMIN)).toEqual(before);
    });
  });

  it('matches the code, so a newly provisioned role and a migrated one agree', () => {
    expect(RESELLER_SYSTEM_ROLE_ABILITIES.reseller_full_admin).toContainEqual(READ_USER);
  });
});
