import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resellers, roles, users } from '../../schema';
import { seedEssential } from '../essential';
import { SEED_IDS } from '../ids';
import { makeSeedTestDb } from './seed-test-helpers';

describe('seedEssential', () => {
  const { pool, db } = makeSeedTestDb();
  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await seedEssential(db);
  });

  it('creates the system user', async () => {
    const rows = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.username, 'system'));
    expect(rows).toHaveLength(1);
  });

  it('creates 5 system roles (2 platform + 3 reseller)', async () => {
    const platformRows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.id, SEED_IDS.ROLE_PLATFORM_ADMIN));
    expect(platformRows).toHaveLength(1);

    const resellerFullRows = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.id, SEED_IDS.ROLE_RESELLER_FULL_ADMIN));
    expect(resellerFullRows).toHaveLength(1);
  });

  it('creates the default Roviq Direct reseller', async () => {
    const rows = await db
      .select({ slug: resellers.slug, name: resellers.name })
      .from(resellers)
      .where(eq(resellers.id, SEED_IDS.RESELLER_DIRECT));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe('roviq-direct');
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    await seedEssential(db);
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'system'));
    expect(userRows).toHaveLength(1);
  });
});
