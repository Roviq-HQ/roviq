import { and, eq, inArray, TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../../providers';
import {
  institutes,
  roles,
  staffProfiles,
  studentGuardianLinks,
  studentProfiles,
  tenantSequences,
  users,
} from '../../schema';
import { seedDemo, seedE2e, seedEssential } from '..';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

const SEEDED_STUDENT_PROFILE_IDS = [
  SEED_IDS.STUDENT_PROFILE_1,
  SEED_IDS.STUDENT_PROFILE_2,
  SEED_IDS.STUDENT_PROFILE_3,
  SEED_IDS.STUDENT_PROFILE_4,
  SEED_IDS.STUDENT_PROFILE_5,
  SEED_IDS.STUDENT_PROFILE_6,
  SEED_IDS.STUDENT_PROFILE_7,
] as const;

describe('Seed tier idempotency + cumulative chaining', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  /**
   * Runs a test that removes or changes a seeded row in a transaction that is rolled back.
   * Other spec files read the same seeded rows in parallel; a committed delete, even one the
   * seed puts back a moment later, makes those rows vanish under them.
   *
   * `seed` runs first, inside the transaction, so that this transaction takes the seed's row
   * locks in the seed's own order before it holds the row the test changes. Changing the row
   * first and seeding after takes them in the opposite order to a seed running in another
   * spec file, and the two deadlock.
   */
  async function withoutTouchingSharedRows(
    seed: (tx: DrizzleDB) => Promise<void>,
    fn: (tx: DrizzleDB) => Promise<void>,
  ): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await seed(tx as DrizzleDB);
        await fn(tx as DrizzleDB);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  }

  it('seedEssential x3 → still exactly one system user', async () => {
    await seedEssential(db);
    await seedEssential(db);
    await seedEssential(db);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, 'system'));
    expect(rows).toHaveLength(1);
  });

  it('seedEssential repairs a missing system role after the system user exists', async () => {
    await withoutTouchingSharedRows(seedEssential, async (tx) => {
      const removed = await tx
        .delete(roles)
        .where(eq(roles.id, SEED_IDS.ROLE_PLATFORM_SUPPORT))
        .returning({ id: roles.id });
      expect(removed).toHaveLength(1);

      await seedEssential(tx);

      const rows = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, SEED_IDS.ROLE_PLATFORM_SUPPORT));
      expect(rows).toHaveLength(1);
    });
  });

  it('seedDemo invokes seedEssential — system user exists after seedDemo only', async () => {
    await seedDemo(db);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, 'system'));
    expect(rows).toHaveLength(1);
  });

  it('seedDemo repairs the teacher staff profile when the institute sentinel already exists', async () => {
    await withoutTouchingSharedRows(seedDemo, async (tx) => {
      const removed = await tx
        .delete(staffProfiles)
        .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_1))
        .returning({ id: staffProfiles.id });
      expect(removed).toHaveLength(1);

      await seedDemo(tx);

      const rows = await tx
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_1));
      expect(rows).toHaveLength(1);
    });
  });

  it('seedE2e invokes seedDemo — institute1 exists after seedE2e only', async () => {
    await seedE2e(db);
    const rows = await db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, SEED_IDS.INSTITUTE_1));
    expect(rows).toHaveLength(1);
  });

  it('seedE2e x3 → still has one row for each seed-owned student', async () => {
    await seedE2e(db);
    await seedE2e(db);
    await seedE2e(db);
    const rows = await db
      .select({ id: studentProfiles.id })
      .from(studentProfiles)
      .where(inArray(studentProfiles.id, [...SEEDED_STUDENT_PROFILE_IDS]));

    expect(rows.map((row) => row.id).sort()).toEqual([...SEEDED_STUDENT_PROFILE_IDS].sort());
  });

  it('seedE2e leaves the admission counters as they are and never lowers one (ROV-276)', async () => {
    await seedE2e(db);
    const counters = () =>
      db
        .select({ name: tenantSequences.sequenceName, value: tenantSequences.currentValue })
        .from(tenantSequences)
        .where(eq(tenantSequences.tenantId, SEED_IDS.INSTITUTE_1))
        .orderBy(tenantSequences.sequenceName);
    const before = await counters();
    await seedE2e(db);
    expect(await counters()).toEqual(before);

    const nursery = and(
      eq(tenantSequences.tenantId, SEED_IDS.INSTITUTE_1),
      eq(tenantSequences.sequenceName, 'adm_no:N-'),
    );
    await withoutTouchingSharedRows(seedE2e, async (tx) => {
      const raised = await tx
        .update(tenantSequences)
        .set({ currentValue: 50n })
        .where(nursery)
        .returning({ name: tenantSequences.sequenceName });
      expect(raised).toHaveLength(1);
      await seedE2e(tx);
      const [after] = await tx
        .select({ value: tenantSequences.currentValue })
        .from(tenantSequences)
        .where(nursery);
      expect(after.value).toBe(50n);
    });
  });

  it('seedE2e repairs missing e2e fixtures when student rows already exist', async () => {
    await withoutTouchingSharedRows(seedE2e, async (tx) => {
      const staffRemoved = await tx
        .delete(staffProfiles)
        .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_2))
        .returning({ id: staffProfiles.id });
      const linkRemoved = await tx
        .delete(studentGuardianLinks)
        .where(eq(studentGuardianLinks.id, SEED_IDS.LINK_G2_S3))
        .returning({ id: studentGuardianLinks.id });
      expect(staffRemoved).toHaveLength(1);
      expect(linkRemoved).toHaveLength(1);

      await seedE2e(tx);

      const staffRows = await tx
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_2));
      const linkRows = await tx
        .select({ id: studentGuardianLinks.id })
        .from(studentGuardianLinks)
        .where(eq(studentGuardianLinks.id, SEED_IDS.LINK_G2_S3));
      expect(staffRows).toHaveLength(1);
      expect(linkRows).toHaveLength(1);
    });
  });
});
