import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardianProfiles, staffProfiles, studentProfiles } from '../../schema';
import { seedE2e } from '../e2e';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

describe('Institute 2 stays people-free after seedE2e', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await seedE2e(db);
  });

  it('Institute 2 has zero student_profiles', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(studentProfiles)
      .where(eq(studentProfiles.tenantId, SEED_IDS.INSTITUTE_2));
    expect(total).toBe(0);
  });

  it('Institute 2 has zero staff_profiles', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(staffProfiles)
      .where(eq(staffProfiles.tenantId, SEED_IDS.INSTITUTE_2));
    expect(total).toBe(0);
  });

  it('Institute 2 has zero guardian_profiles', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(guardianProfiles)
      .where(eq(guardianProfiles.tenantId, SEED_IDS.INSTITUTE_2));
    expect(total).toBe(0);
  });
});
