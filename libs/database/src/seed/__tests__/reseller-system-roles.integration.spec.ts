import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SYSTEM_USER_ID } from '../../constants';
import type { DrizzleDB } from '../../providers';
import {
  provisionResellerSystemRoles,
  RESELLER_SYSTEM_ROLE_ABILITIES,
} from '../../reseller-system-roles';
import { resellerMemberships, resellers, roles, users } from '../../schema';
import { seedSystemRoles } from '../essential/system-roles';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

class Rollback extends Error {}

const MIGRATIONS_DIR = join(__dirname, '../../../migrations');

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

describe('ROV-91 reseller role backfill migration', () => {
  const migrationDir = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith('_rov-91-reseller-role-backfill'),
  );
  assert(migrationDir);
  const statements = readFileSync(join(MIGRATIONS_DIR, migrationDir, 'migration.sql'), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim());

  // The backfill touches every reseller in the database, and other test files create and delete
  // theirs meanwhile; one deleted mid-statement fails the roles foreign key. The lock makes
  // those writes wait until this transaction rolls back. It is taken before the test writes
  // anything: locking after this transaction holds row locks deadlocks with a concurrent seed.
  async function inBackfillTx(fn: (tx: DrizzleDB) => Promise<void>): Promise<void> {
    await inRolledBackTx(async (tx) => {
      await tx.execute(sql`LOCK TABLE resellers IN SHARE ROW EXCLUSIVE MODE`);
      await fn(tx);
    });
  }

  async function runBackfill(tx: DrizzleDB): Promise<void> {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  }

  it('should move a membership off the shared Roviq Direct role onto the reseller own copy', async () => {
    await inBackfillTx(async (tx) => {
      const resellerId = await createReseller(tx, 'rov-91-backfill');
      const [user] = await tx
        .insert(users)
        .values({
          email: 'rov-91-backfill@test.local',
          username: 'rov-91-backfill',
          passwordHash: 'not-a-real-hash',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: users.id });
      assert(user);
      await tx.insert(resellerMemberships).values({
        userId: user.id,
        resellerId,
        roleId: SEED_IDS.ROLE_RESELLER_VIEWER,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });

      await runBackfill(tx);

      const ownRoles = await resellerRoles(tx, resellerId);
      expect(ownRoles.map((r) => r.name.en)).toEqual([
        'reseller_full_admin',
        'reseller_support_admin',
        'reseller_viewer',
      ]);
      const [membership] = await tx
        .select({ roleId: resellerMemberships.roleId })
        .from(resellerMemberships)
        .where(eq(resellerMemberships.userId, user.id));
      const ownViewer = ownRoles.find((r) => r.name.en === 'reseller_viewer');
      assert(membership && ownViewer);
      expect(membership.roleId).toBe(ownViewer.id);
    });
  });

  it('should not add roles to a reseller that already has its own copies', async () => {
    await inBackfillTx(async (tx) => {
      const resellerId = await createReseller(tx, 'rov-91-backfill-noop');
      const ids = await provisionResellerSystemRoles(tx, resellerId, SYSTEM_USER_ID);

      await runBackfill(tx);

      const ownRoles = await resellerRoles(tx, resellerId);
      expect(ownRoles.map((r) => r.id)).toEqual([
        ids.reseller_full_admin,
        ids.reseller_support_admin,
        ids.reseller_viewer,
      ]);
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
});
