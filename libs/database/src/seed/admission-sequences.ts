// Seeded students carry admission numbers from the runtime's series. Each series counter
// is set to the highest seeded value so the first generated number follows them (ROV-276).
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../providers';
import { tenantSequences } from '../schema/sequences/tenant-sequences';
import type { AdmissionNumberConfig } from '../schema/tenant/institute-configs';
import type { SeedAdmission } from './fixtures';

export async function seedAdmissionSequences(
  tx: DrizzleDB,
  tenantId: string,
  config: AdmissionNumberConfig,
  admissions: readonly SeedAdmission[],
): Promise<void> {
  const highest = new Map<string, SeedAdmission>();
  for (const a of admissions) {
    const seen = highest.get(a.series);
    if (!seen || a.value > seen.value) highest.set(a.series, a);
  }
  for (const a of highest.values()) {
    await tx
      .insert(tenantSequences)
      .values({
        tenantId,
        sequenceName: a.series,
        currentValue: BigInt(a.value),
        prefix: a.prefix || null,
        formatTemplate: config.format,
      })
      .onConflictDoUpdate({
        target: [tenantSequences.tenantId, tenantSequences.sequenceName],
        // Never lower a counter that has already issued numbers on this database.
        set: {
          currentValue: sql`GREATEST(${tenantSequences.currentValue}, excluded.current_value)`,
        },
      });
  }
}
