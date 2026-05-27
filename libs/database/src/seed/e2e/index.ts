import type { DrizzleDB } from '../../providers';
import { mkAdminCtx, withAdmin } from '../../tenant-db';
import { seedDemo } from '../demo';
import { SEED_IDS } from '../ids';
import { seedE2eGuardians } from './guardians';
import { seedE2eImpersonationSessions } from './impersonation';
import { seedE2eStaff } from './staff';
import { seedE2eStudents } from './students';

export async function seedE2e(db: DrizzleDB): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Safety violation: E2E seed cannot run in production');
  }

  await seedDemo(db);

  await withAdmin(db, mkAdminCtx('seeder:e2e'), async (tx) => {
    await seedE2eStaff(tx, SEED_IDS.INSTITUTE_1);
    await seedE2eStudents(tx, SEED_IDS.INSTITUTE_1, SEED_IDS.ACADEMIC_YEAR_INST1);
    await seedE2eGuardians(tx, SEED_IDS.INSTITUTE_1);
    await seedE2eImpersonationSessions(tx);
  });
}
