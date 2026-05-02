import { count, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { institutes, studentProfiles, users } from '../../schema';
import { seedDemo, seedE2e, seedEssential } from '../';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

describe('Seed tier idempotency + cumulative chaining', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  it('seedEssential x3 → still exactly one system user', async () => {
    await seedEssential(db);
    await seedEssential(db);
    await seedEssential(db);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, 'system'));
    expect(rows).toHaveLength(1);
  });

  it('seedDemo invokes seedEssential — system user exists after seedDemo only', async () => {
    await seedDemo(db);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, 'system'));
    expect(rows).toHaveLength(1);
  });

  it('seedE2e invokes seedDemo — institute1 exists after seedE2e only', async () => {
    await seedE2e(db);
    const rows = await db
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.id, SEED_IDS.INSTITUTE_1));
    expect(rows).toHaveLength(1);
  });

  it('seedE2e x3 → still exactly 5 students in Institute 1', async () => {
    await seedE2e(db);
    await seedE2e(db);
    await seedE2e(db);
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(studentProfiles)
      .where(eq(studentProfiles.tenantId, SEED_IDS.INSTITUTE_1));
    expect(total).toBe(5);
  });
});
