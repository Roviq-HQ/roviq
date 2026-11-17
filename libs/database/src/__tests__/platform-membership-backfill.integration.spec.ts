import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AbilityRule } from '@roviq/common-types';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SYSTEM_USER_ID } from '../constants';
import type { DrizzleDB } from '../providers';
import { memberships, platformMemberships, users } from '../schema';
import { makeSeedTestDb } from '../seed/__tests__/seed-test-helpers';
import { SEED_IDS } from '../seed/ids';

class Rollback extends Error {}

const MIGRATIONS_DIR = join(__dirname, '../../migrations');

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

async function createUser(tx: DrizzleDB, username: string): Promise<string> {
  const [user] = await tx
    .insert(users)
    .values({
      email: `${username}@test.local`,
      username,
      passwordHash: 'not-a-real-hash',
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    })
    .returning({ id: users.id });
  assert(user);
  return user.id;
}

async function platformRows(tx: DrizzleDB, userId: string) {
  return tx
    .select({
      roleId: platformMemberships.roleId,
      abilities: platformMemberships.abilities,
      isActive: platformMemberships.isActive,
      createdBy: platformMemberships.createdBy,
    })
    .from(platformMemberships)
    .where(eq(platformMemberships.userId, userId));
}

async function instituteRows(tx: DrizzleDB, userId: string) {
  return tx
    .select({ roleId: memberships.roleId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
}

describe('ROV-88 platform membership backfill migration', () => {
  const migrationDir = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith('_rov-88-platform-membership-backfill'),
  );
  assert(migrationDir);
  const statements = readFileSync(join(MIGRATIONS_DIR, migrationDir, 'migration.sql'), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim());

  const runBackfill = async (tx: DrizzleDB) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  };

  it('should move a platform-role membership into platform_memberships', async () => {
    await inRolledBackTx(async (tx) => {
      const userId = await createUser(tx, 'rov-88-backfill');
      const abilities: AbilityRule[] = [{ action: 'read', subject: 'Institute' }];
      await tx.insert(memberships).values({
        userId,
        tenantId: SEED_IDS.INSTITUTE_1,
        roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
        abilities,
        createdBy: userId,
        updatedBy: userId,
      });

      await runBackfill(tx);

      expect(await platformRows(tx, userId)).toEqual([
        { roleId: SEED_IDS.ROLE_PLATFORM_ADMIN, abilities, isActive: true, createdBy: userId },
      ]);
      expect(await instituteRows(tx, userId)).toEqual([]);
    });
  });

  it('should carry a suspended membership over as inactive', async () => {
    await inRolledBackTx(async (tx) => {
      const userId = await createUser(tx, 'rov-88-backfill-suspended');
      await tx.insert(memberships).values({
        userId,
        tenantId: SEED_IDS.INSTITUTE_1,
        roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
        status: 'SUSPENDED',
        createdBy: userId,
        updatedBy: userId,
      });

      await runBackfill(tx);

      expect(await platformRows(tx, userId)).toEqual([
        {
          roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
          abilities: [],
          isActive: false,
          createdBy: userId,
        },
      ]);
      expect(await instituteRows(tx, userId)).toEqual([]);
    });
  });

  it('should keep an existing platform membership and still remove the stale row', async () => {
    await inRolledBackTx(async (tx) => {
      const userId = await createUser(tx, 'rov-88-backfill-existing');
      await tx.insert(platformMemberships).values({
        userId,
        roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
        createdBy: userId,
        updatedBy: userId,
      });
      await tx.insert(memberships).values({
        userId,
        tenantId: SEED_IDS.INSTITUTE_1,
        roleId: SEED_IDS.ROLE_PLATFORM_SUPPORT,
        createdBy: userId,
        updatedBy: userId,
      });

      await runBackfill(tx);

      expect(await platformRows(tx, userId)).toEqual([
        { roleId: SEED_IDS.ROLE_PLATFORM_ADMIN, abilities: [], isActive: true, createdBy: userId },
      ]);
      expect(await instituteRows(tx, userId)).toEqual([]);
    });
  });

  it('should leave institute-role memberships untouched', async () => {
    await inRolledBackTx(async (tx) => {
      const before = await tx.select({ id: memberships.id }).from(memberships);
      expect(before.length).toBeGreaterThanOrEqual(1);

      await runBackfill(tx);

      const after = await tx.select({ id: memberships.id }).from(memberships);
      expect(after).toEqual(before);
    });
  });
});
