// libs/database/src/seed/e2e/index.ts
import { count, eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../providers';
import { studentProfiles } from '../../schema';
import { mkAdminCtx, withAdmin } from '../../tenant-db';
import { seedDemo } from '../demo';
import { SEED_IDS } from '../ids';
import { seedE2eGuardians } from './guardians';
import { seedE2eStaff } from './staff';
import { seedE2eStudents } from './students';

export async function seedE2e(db: DrizzleDB): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Safety violation: E2E seed cannot run in production');
  }

  await seedDemo(db);

  await withAdmin(db, mkAdminCtx('seeder:e2e'), async (tx) => {
    // Demo seeds 1 student (student1). E2E adds 4 more — final count is 5.
    const [{ value: existingCount }] = await tx
      .select({ value: count() })
      .from(studentProfiles)
      .where(eq(studentProfiles.tenantId, SEED_IDS.INSTITUTE_1));

    if (existingCount > 1) {
      console.log('⏭ e2e already seeded, skipping');
      return;
    }

    console.log('Seeding e2e people fixtures...');

    await seedE2eStaff(tx, SEED_IDS.INSTITUTE_1);
    await seedE2eStudents(tx, SEED_IDS.INSTITUTE_1, SEED_IDS.ACADEMIC_YEAR_INST1);
    await seedE2eGuardians(tx, SEED_IDS.INSTITUTE_1);

    console.log('✓ e2e seed complete');
  });
}
