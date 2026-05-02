// libs/database/src/seed/essential/reseller.ts
import { ResellerTier } from '@roviq/common-types';
import type { DrizzleDB } from '../../providers';
import { resellers } from '../../schema';
import { SEED_IDS } from '../ids';

export async function seedReseller(tx: DrizzleDB): Promise<void> {
  const [reseller] = await tx
    .insert(resellers)
    .values({
      id: SEED_IDS.RESELLER_DIRECT,
      name: 'Roviq Direct',
      slug: 'roviq-direct',
      isSystem: true,
      tier: ResellerTier.FULL_MANAGEMENT,
    })
    .onConflictDoUpdate({ target: resellers.slug, set: { updatedAt: new Date() } })
    .returning();
  console.log(`  Reseller: ${reseller.name} (${reseller.id})`);
}
