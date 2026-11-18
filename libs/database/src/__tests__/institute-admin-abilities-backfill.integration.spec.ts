import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AbilityRule, DEFAULT_ROLE_ABILITIES } from '@roviq/common-types';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../providers';
import { roles } from '../schema';
import { makeSeedTestDb } from '../seed/__tests__/seed-test-helpers';
import { SEED_IDS } from '../seed/ids';

class Rollback extends Error {}

const MIGRATIONS_DIR = join(__dirname, '../../migrations');
const LEGACY_ABILITIES: AbilityRule[] = [{ action: 'manage', subject: 'all' }];

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

const adminRoleOf = (tenantId: string) =>
  and(eq(roles.tenantId, tenantId), eq(roles.name, { en: 'institute_admin' }));

async function abilitiesOf(tx: DrizzleDB, tenantId: string): Promise<unknown> {
  const [row] = await tx
    .select({ abilities: roles.abilities })
    .from(roles)
    .where(adminRoleOf(tenantId));
  assert(row);
  return row.abilities;
}

describe('ROV-290 institute_admin abilities backfill migration', () => {
  const migrationDir = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith('_rov-290-institute-admin-abilities-backfill'),
  );
  assert(migrationDir);
  const statements = readFileSync(join(MIGRATIONS_DIR, migrationDir, 'migration.sql'), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim());

  const runBackfill = async (tx: DrizzleDB) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  };

  it('should rewrite a legacy manage-all institute_admin role to the current default', async () => {
    await inRolledBackTx(async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: LEGACY_ABILITIES })
        .where(adminRoleOf(SEED_IDS.INSTITUTE_1));

      await runBackfill(tx);

      expect(await abilitiesOf(tx, SEED_IDS.INSTITUTE_1)).toEqual(
        DEFAULT_ROLE_ABILITIES.institute_admin,
      );
    });
  });

  it('should leave an institute_admin role with customised abilities untouched', async () => {
    await inRolledBackTx(async (tx) => {
      const custom: AbilityRule[] = [{ action: 'read', subject: 'Student' }];
      await tx.update(roles).set({ abilities: custom }).where(adminRoleOf(SEED_IDS.INSTITUTE_2));

      await runBackfill(tx);

      expect(await abilitiesOf(tx, SEED_IDS.INSTITUTE_2)).toEqual(custom);
    });
  });

  it('should leave a non-default role that happens to hold manage-all untouched', async () => {
    await inRolledBackTx(async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: LEGACY_ABILITIES, isDefault: false })
        .where(adminRoleOf(SEED_IDS.INSTITUTE_1));

      await runBackfill(tx);

      expect(await abilitiesOf(tx, SEED_IDS.INSTITUTE_1)).toEqual(LEGACY_ABILITIES);
    });
  });
});
