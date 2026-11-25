import { type DrizzleDB, instituteConfigsLive, sectionsLive } from '@roviq/database';
import { asc, eq, inArray } from 'drizzle-orm';
import type { SectionCapacityRecord, SectionStrengthChange } from './types';

/** The target section's strength and norms, read under its row lock before the write. */
export type LockedSection = SectionCapacityRecord & { sectionId: string };

/**
 * Locks the target section, and any other section the write moves a student out of, for the
 * rest of the transaction, the way `refresh_section_strength` does and in its ascending order.
 * Placements into one section then take turns, and each sees the count the one before left.
 * Null when the target section is gone.
 */
export async function lockSectionForPlacement(
  tx: DrizzleDB,
  sectionId: string,
  alsoTouched: Array<string | null> = [],
): Promise<LockedSection | null> {
  const ids = [
    ...new Set([sectionId, ...alsoTouched.filter((id): id is string => id !== null)]),
  ].sort();
  const rows = await tx
    .select({
      id: sectionsLive.id,
      currentStrength: sectionsLive.currentStrength,
      capacity: sectionsLive.capacity,
    })
    .from(sectionsLive)
    .where(inArray(sectionsLive.id, ids))
    .orderBy(asc(sectionsLive.id))
    .for('no key update');
  const target = rows.find((row) => row.id === sectionId);
  if (!target) return null;

  const [config] = await tx
    .select({ sectionStrengthNorms: instituteConfigsLive.sectionStrengthNorms })
    .from(instituteConfigsLive)
    .limit(1);
  return {
    sectionId,
    section: { currentStrength: target.currentStrength, capacity: target.capacity },
    norms: config?.sectionStrengthNorms ?? null,
  };
}

/** Before and after this transaction's own write, as the trigger counted them. */
export async function strengthChange(
  tx: DrizzleDB,
  locked: LockedSection,
): Promise<SectionStrengthChange> {
  const [section] = await tx
    .select({ currentStrength: sectionsLive.currentStrength })
    .from(sectionsLive)
    .where(eq(sectionsLive.id, locked.sectionId));
  return {
    sectionId: locked.sectionId,
    before: locked.section.currentStrength,
    after: section.currentStrength,
    norms: locked.norms,
  };
}
