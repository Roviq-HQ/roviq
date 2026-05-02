// libs/database/src/seed/essential/index.ts
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../providers';
import { users } from '../../schema';
import { mkAdminCtx, withAdmin } from '../../tenant-db';
import { seedReseller } from './reseller';
import { seedSystemRoles } from './system-roles';
import { seedSystemUser } from './system-user';

export async function seedEssential(db: DrizzleDB): Promise<void> {
  await withAdmin(db, mkAdminCtx('seeder:essential'), async (tx) => {
    const exists = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, 'system'))
      .limit(1);
    if (exists.length > 0) {
      console.log('⏭ essential already seeded, skipping');
      return;
    }
    console.log('Seeding essential...');
    await seedSystemUser(tx);
    await seedSystemRoles(tx);
    await seedReseller(tx);
    console.log('✓ essential seed complete');
  });
}
