import { count, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  institutes,
  roles,
  staffProfiles,
  studentGuardianLinks,
  studentProfiles,
  users,
} from '../../schema';
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

  it('seedEssential repairs a missing system role after the system user exists', async () => {
    await seedEssential(db);
    await db.delete(roles).where(eq(roles.id, SEED_IDS.ROLE_PLATFORM_SUPPORT));

    await seedEssential(db);

    const rows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.id, SEED_IDS.ROLE_PLATFORM_SUPPORT));
    expect(rows).toHaveLength(1);
  });

  it('seedDemo invokes seedEssential — system user exists after seedDemo only', async () => {
    await seedDemo(db);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, 'system'));
    expect(rows).toHaveLength(1);
  });

  it('seedDemo repairs the teacher staff profile when the institute sentinel already exists', async () => {
    await seedDemo(db);
    await db.delete(staffProfiles).where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_1));

    await seedDemo(db);

    const rows = await db
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_1));
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

  it('seedE2e repairs missing e2e fixtures when student rows already exist', async () => {
    await seedE2e(db);
    await db.delete(staffProfiles).where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_2));
    await db.delete(studentGuardianLinks).where(eq(studentGuardianLinks.id, SEED_IDS.LINK_G2_S3));

    await seedE2e(db);

    const staffRows = await db
      .select({ id: staffProfiles.id })
      .from(staffProfiles)
      .where(eq(staffProfiles.id, SEED_IDS.STAFF_PROFILE_2));
    const linkRows = await db
      .select({ id: studentGuardianLinks.id })
      .from(studentGuardianLinks)
      .where(eq(studentGuardianLinks.id, SEED_IDS.LINK_G2_S3));
    expect(staffRows).toHaveLength(1);
    expect(linkRows).toHaveLength(1);
  });
});
