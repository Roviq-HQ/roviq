import { and, eq, inArray } from 'drizzle-orm';
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

const SEEDED_STUDENT_PROFILE_IDS = [
  SEED_IDS.STUDENT_PROFILE_1,
  SEED_IDS.STUDENT_PROFILE_2,
  SEED_IDS.STUDENT_PROFILE_3,
  SEED_IDS.STUDENT_PROFILE_4,
  SEED_IDS.STUDENT_PROFILE_5,
] as const;

const SEEDED_STAFF_PROFILE_IDS = [
  SEED_IDS.STAFF_PROFILE_1,
  SEED_IDS.STAFF_PROFILE_2,
  SEED_IDS.STAFF_PROFILE_3,
] as const;

const SEEDED_GUARDIAN_PROFILE_IDS = [
  SEED_IDS.GUARDIAN_PROFILE_1,
  SEED_IDS.GUARDIAN_PROFILE_2,
  SEED_IDS.GUARDIAN_PROFILE_3,
] as const;

const SEEDED_E2E_LINK_IDS = [
  SEED_IDS.LINK_G1_S2,
  SEED_IDS.LINK_G2_S2,
  SEED_IDS.LINK_G2_S3,
  SEED_IDS.LINK_G3_S4,
] as const;

describe('seedE2e', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await seedE2e(db);
  });

  it('creates the seed-owned student_profiles in Institute 1', async () => {
    const rows = await db
      .select({ id: studentProfiles.id, tenantId: studentProfiles.tenantId })
      .from(studentProfiles)
      .where(inArray(studentProfiles.id, [...SEEDED_STUDENT_PROFILE_IDS]));

    expect(rows.map((row) => row.id).sort()).toEqual([...SEEDED_STUDENT_PROFILE_IDS].sort());
    expect(rows.every((row) => row.tenantId === SEED_IDS.INSTITUTE_1)).toBe(true);
  });

  it('creates the seed-owned staff_profiles in Institute 1', async () => {
    const rows = await db
      .select({ id: staffProfiles.id, tenantId: staffProfiles.tenantId })
      .from(staffProfiles)
      .where(inArray(staffProfiles.id, [...SEEDED_STAFF_PROFILE_IDS]));

    expect(rows.map((row) => row.id).sort()).toEqual([...SEEDED_STAFF_PROFILE_IDS].sort());
    expect(rows.every((row) => row.tenantId === SEED_IDS.INSTITUTE_1)).toBe(true);
  });

  it('creates the seed-owned guardian_profiles in Institute 1', async () => {
    const rows = await db
      .select({ id: guardianProfiles.id, tenantId: guardianProfiles.tenantId })
      .from(guardianProfiles)
      .where(inArray(guardianProfiles.id, [...SEEDED_GUARDIAN_PROFILE_IDS]));

    expect(rows.map((row) => row.id).sort()).toEqual([...SEEDED_GUARDIAN_PROFILE_IDS].sort());
    expect(rows.every((row) => row.tenantId === SEED_IDS.INSTITUTE_1)).toBe(true);
  });

  it('creates the seed-owned student-guardian links', async () => {
    const e2eLinks = await db
      .select({ id: studentGuardianLinks.id, tenantId: studentGuardianLinks.tenantId })
      .from(studentGuardianLinks)
      .where(inArray(studentGuardianLinks.id, [...SEEDED_E2E_LINK_IDS]));

    const demoLink = await db
      .select({ id: studentGuardianLinks.id })
      .from(studentGuardianLinks)
      .where(
        and(
          eq(studentGuardianLinks.studentProfileId, SEED_IDS.STUDENT_PROFILE_1),
          eq(studentGuardianLinks.guardianProfileId, SEED_IDS.GUARDIAN_PROFILE_1),
        ),
      );

    expect(e2eLinks.map((row) => row.id).sort()).toEqual([...SEEDED_E2E_LINK_IDS].sort());
    expect(e2eLinks.every((row) => row.tenantId === SEED_IDS.INSTITUTE_1)).toBe(true);
    expect(demoLink.length).toBeGreaterThanOrEqual(1);
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
    const rows = await db
      .select({ id: studentProfiles.id })
      .from(studentProfiles)
      .where(inArray(studentProfiles.id, [...SEEDED_STUDENT_PROFILE_IDS]));

    expect(rows.map((row) => row.id).sort()).toEqual([...SEEDED_STUDENT_PROFILE_IDS].sort());
  });
});
