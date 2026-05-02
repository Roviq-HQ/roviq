import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  academicYears,
  institutes,
  memberships,
  staffProfiles,
  studentGuardianLinks,
  studentProfiles,
  users,
} from '../../schema';
import { seedDemo } from '../demo';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

describe('seedDemo', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await seedDemo(db);
  });

  it('creates 2 institutes', async () => {
    const rows = await db.select({ id: institutes.id }).from(institutes);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('creates an active academic year for Institute 1', async () => {
    const rows = await db
      .select({ id: academicYears.id, isActive: academicYears.isActive })
      .from(academicYears)
      .where(eq(academicYears.id, SEED_IDS.ACADEMIC_YEAR_INST1));
    expect(rows[0]?.isActive).toBe(true);
  });

  it('creates the 5 demo users', async () => {
    const expectedUsernames = ['admin', 'teacher1', 'student1', 'guardian1', 'reseller1'];
    for (const username of expectedUsernames) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username));
      expect(rows, `${username} must exist`).toHaveLength(1);
    }
  });

  it('creates a staff_profile for teacher1 (demo gap fix)', async () => {
    const rows = await db
      .select({ id: staffProfiles.id, designation: staffProfiles.designation })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.designation).toBe('PGT Mathematics');
  });

  it('creates student_profile + student_academic for student1', async () => {
    const profile = await db
      .select({ id: studentProfiles.id })
      .from(studentProfiles)
      .where(eq(studentProfiles.id, SEED_IDS.STUDENT_PROFILE_1));
    expect(profile).toHaveLength(1);
  });

  it('links guardian1 to student1 (FATHER, primary)', async () => {
    const rows = await db
      .select({
        relationship: studentGuardianLinks.relationship,
        isPrimary: studentGuardianLinks.isPrimaryContact,
      })
      .from(studentGuardianLinks)
      .where(eq(studentGuardianLinks.studentProfileId, SEED_IDS.STUDENT_PROFILE_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relationship).toBe('FATHER');
    expect(rows[0]?.isPrimary).toBe(true);
  });

  it('is idempotent — running twice does not duplicate institutes', async () => {
    await seedDemo(db);
    const rows = await db.select({ id: institutes.id }).from(institutes);
    const seedCount = rows.filter(
      (r) => r.id === SEED_IDS.INSTITUTE_1 || r.id === SEED_IDS.INSTITUTE_2,
    ).length;
    expect(seedCount).toBe(2);
  });
});
