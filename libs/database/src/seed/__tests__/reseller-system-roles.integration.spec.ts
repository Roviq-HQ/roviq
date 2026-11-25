import assert from 'node:assert';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_SUPERUSER_URL } from '../../__tests__/test-helpers';
import { SYSTEM_USER_ID } from '../../constants';
import type { DrizzleDB } from '../../providers';
import {
  provisionResellerSystemRoles,
  RESELLER_SYSTEM_ROLE_ABILITIES,
} from '../../reseller-system-roles';
import { resellers, roles } from '../../schema';
import { seedSystemRoles } from '../essential/system-roles';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

class Rollback extends Error {}

const { pool, db } = makeSeedTestDb();

afterAll(async () => {
  await pool.end();
});

/** Runs `fn` on the superuser connection and always rolls back. */
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

async function createReseller(tx: DrizzleDB, slug: string): Promise<string> {
  const [reseller] = await tx
    .insert(resellers)
    .values({ name: `ROV-91 ${slug}`, slug, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })
    .returning({ id: resellers.id });
  assert(reseller);
  return reseller.id;
}

const resellerRoles = (tx: DrizzleDB, resellerId: string) =>
  tx
    .select({
      id: roles.id,
      name: roles.name,
      abilities: roles.abilities,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(and(eq(roles.resellerId, resellerId), eq(roles.scope, 'reseller')))
    .orderBy(roles.name);

describe('provisionResellerSystemRoles', () => {
  it('should give a reseller its own copy of the three system roles', async () => {
    await inRolledBackTx(async (tx) => {
      const resellerId = await createReseller(tx, 'rov-91-provision');

      const ids = await provisionResellerSystemRoles(tx, resellerId, SYSTEM_USER_ID);

      const rows = await resellerRoles(tx, resellerId);
      expect(rows).toEqual([
        {
          id: ids.reseller_full_admin,
          name: { en: 'reseller_full_admin' },
          abilities: RESELLER_SYSTEM_ROLE_ABILITIES.reseller_full_admin,
          isSystem: true,
        },
        {
          id: ids.reseller_support_admin,
          name: { en: 'reseller_support_admin' },
          abilities: RESELLER_SYSTEM_ROLE_ABILITIES.reseller_support_admin,
          isSystem: true,
        },
        {
          id: ids.reseller_viewer,
          name: { en: 'reseller_viewer' },
          abilities: RESELLER_SYSTEM_ROLE_ABILITIES.reseller_viewer,
          isSystem: true,
        },
      ]);
      expect(Object.values(ids)).not.toContain(SEED_IDS.ROLE_RESELLER_FULL_ADMIN);
    });
  });

  it('should return the same role ids when run twice', async () => {
    await inRolledBackTx(async (tx) => {
      const resellerId = await createReseller(tx, 'rov-91-idempotent');

      const first = await provisionResellerSystemRoles(tx, resellerId, SYSTEM_USER_ID);
      const second = await provisionResellerSystemRoles(tx, resellerId, SYSTEM_USER_ID);

      expect(second).toEqual(first);
      expect(await resellerRoles(tx, resellerId)).toHaveLength(3);
    });
  });
});

describe('seedSystemRoles', () => {
  it('should keep the Roviq Direct reseller roles on the fixed seed ids', async () => {
    await inRolledBackTx(async (tx) => {
      await seedSystemRoles(tx);

      const direct = await resellerRoles(tx, SEED_IDS.RESELLER_DIRECT);
      expect(direct.map((r) => r.id)).toEqual([
        SEED_IDS.ROLE_RESELLER_FULL_ADMIN,
        SEED_IDS.ROLE_RESELLER_SUPPORT_ADMIN,
        SEED_IDS.ROLE_RESELLER_VIEWER,
      ]);
    });
  });

  it("should refresh every reseller's stale copy of the system roles (ROV-284)", async () => {
    await inRolledBackTx(async (tx) => {
      const resellerId = await createReseller(tx, 'rov-284-stale');
      await provisionResellerSystemRoles(tx, resellerId, SYSTEM_USER_ID);
      await tx
        .update(roles)
        .set({ abilities: [{ action: 'read', subject: 'all' }] })
        .where(eq(roles.resellerId, resellerId));

      await seedSystemRoles(tx);

      const copies = await resellerRoles(tx, resellerId);
      expect(copies.map((r) => [r.name.en, r.abilities])).toEqual([
        ['reseller_full_admin', RESELLER_SYSTEM_ROLE_ABILITIES.reseller_full_admin],
        ['reseller_support_admin', RESELLER_SYSTEM_ROLE_ABILITIES.reseller_support_admin],
        ['reseller_viewer', RESELLER_SYSTEM_ROLE_ABILITIES.reseller_viewer],
      ]);
    });
  });

  it('should skip a reseller another transaction is deleting, not fail on it', async () => {
    const resellerId = await createReseller(db, `rov-284-lock-${Date.now()}`);
    const other = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
    await other.connect();
    try {
      // Another spec's cleanup has deleted the reseller but not committed yet.
      await other.query('BEGIN');
      await other.query('DELETE FROM resellers WHERE id = $1', [resellerId]);

      const seeded = inRolledBackTx(async (tx) => {
        await seedSystemRoles(tx);
        expect(await resellerRoles(tx, resellerId)).toEqual([]);
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query('COMMIT');

      await expect(seeded).resolves.toBeUndefined();
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      await other.query('DELETE FROM resellers WHERE id = $1', [resellerId]);
      await other.end();
    }
  });

  it('should give no roles to a reseller a cleanup has locked, so its delete commits', async () => {
    const resellerId = await createReseller(db, `rov-284-cleanup-${Date.now()}`);
    const other = new pg.Client({ connectionString: TEST_SUPERUSER_URL });
    await other.connect();
    try {
      // The order of cleanupTestReseller: lock the row, delete its roles, delete it.
      await other.query('BEGIN');
      await other.query('SELECT id FROM resellers WHERE id = $1 FOR UPDATE', [resellerId]);
      await other.query(`DELETE FROM roles WHERE reseller_id = $1 AND scope = 'reseller'`, [
        resellerId,
      ]);

      const seeded = db.transaction((tx) => seedSystemRoles(tx));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query('DELETE FROM resellers WHERE id = $1', [resellerId]);
      await other.query('COMMIT');

      await expect(seeded).resolves.toBeUndefined();
      expect(await resellerRoles(db, resellerId)).toEqual([]);
    } finally {
      await other.query('ROLLBACK').catch(() => undefined);
      await other.query('DELETE FROM roles WHERE reseller_id = $1', [resellerId]);
      await other.query('DELETE FROM resellers WHERE id = $1', [resellerId]);
      await other.end();
    }
  });

  // A deploy runs beside reseller deletions; inserting would reference a reseller being removed.
  it('should create no role copy for a reseller that has none', async () => {
    await inRolledBackTx(async (tx) => {
      const resellerId = await createReseller(tx, 'rov-284-no-copies');

      await seedSystemRoles(tx);

      expect(await resellerRoles(tx, resellerId)).toEqual([]);
    });
  });
});
