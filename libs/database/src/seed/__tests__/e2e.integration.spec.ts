import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  guardianProfiles,
  staffProfiles,
  studentGuardianLinks,
  studentProfiles,
} from '../../schema';
import { seedE2e } from '../e2e';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

describe('seedE2e', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await seedE2e(db);
  });

  it('creates 5 student_profiles in Institute 1', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(studentProfiles)
      .where(eq(studentProfiles.tenantId, SEED_IDS.INSTITUTE_1));
    expect(total).toBe(5);
  });

  it('creates 3 staff_profiles in Institute 1', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(staffProfiles)
      .where(eq(staffProfiles.tenantId, SEED_IDS.INSTITUTE_1));
    expect(total).toBe(3);
  });

  it('creates 3 guardian_profiles in Institute 1', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(guardianProfiles)
      .where(eq(guardianProfiles.tenantId, SEED_IDS.INSTITUTE_1));
    expect(total).toBe(3);
  });

  it('creates 5 student-guardian links (1 demo + 4 e2e)', async () => {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(studentGuardianLinks)
      .where(eq(studentGuardianLinks.tenantId, SEED_IDS.INSTITUTE_1));
    expect(total).toBe(5);
  });

  it('links guardian1 to both student1 and student2 (cross-family)', async () => {
    const links = await db
      .select({ studentProfileId: studentGuardianLinks.studentProfileId })
      .from(studentGuardianLinks)
      .where(eq(studentGuardianLinks.guardianProfileId, SEED_IDS.GUARDIAN_PROFILE_1));
    const studentIds = links.map((l) => l.studentProfileId).sort();
    expect(studentIds).toEqual([SEED_IDS.STUDENT_PROFILE_1, SEED_IDS.STUDENT_PROFILE_2].sort());
  });

  it('is idempotent — running twice yields same row counts', async () => {
    await seedE2e(db);
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(studentProfiles)
      .where(eq(studentProfiles.tenantId, SEED_IDS.INSTITUTE_1));
    expect(total).toBe(5);
  });
});
