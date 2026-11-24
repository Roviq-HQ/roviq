import type { DrizzleDB } from '../../providers';
import { mkAdminCtx, withAdmin } from '../../tenant-db';
import { refreshAllInstituteDefaultRoles } from './institute-roles';
import { seedReseller } from './reseller';
import { seedSystemRoles } from './system-roles';
import { seedSystemUser } from './system-user';

export async function seedEssential(db: DrizzleDB): Promise<void> {
  await withAdmin(db, mkAdminCtx('seeder:essential'), async (tx) => {
    await seedSystemUser(tx);
    await seedReseller(tx);
    await seedSystemRoles(tx);
    await refreshAllInstituteDefaultRoles(tx);
  });
}
