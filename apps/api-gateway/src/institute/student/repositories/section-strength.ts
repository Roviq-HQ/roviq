import {
  type DrizzleDB,
  instituteConfigsLive,
  sectionsLive,
  studentAcademicsLive,
} from '@roviq/database';
import { asc, eq, inArray } from 'drizzle-orm';
import type { SectionCapacityRecord, SectionStrengthChange } from './types';

/** A section's strength and norms, read under its row lock before the write. */
export type LockedSection = SectionCapacityRecord & { sectionId: string };

/**
 * Locks the sections for the rest of the transaction, the way `refresh_section_strength` does and
 * in its ascending order, and reads their strength and the institute's norms. Writes into one
 * section then take turns, and each sees the count the one before left.
 */
async function lockSections(
  tx: DrizzleDB,
  sectionIds: Array<string | null>,
): Promise<LockedSection[]> {
  const ids = [...new Set(sectionIds.filter((id): id is string => id !== null))].sort();
  if (ids.length === 0) return [];
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
  if (rows.length === 0) return [];

  const [config] = await tx
    .select({ sectionStrengthNorms: instituteConfigsLive.sectionStrengthNorms })
    .from(instituteConfigsLive)
    .limit(1);
  const norms = config?.sectionStrengthNorms ?? null;
  return rows.map((row) => ({
    sectionId: row.id,
    section: { currentStrength: row.currentStrength, capacity: row.capacity },
    norms,
  }));
}

/**
 * Locks the target section, and any other section the write moves a student out of.
 * Null when the target section is gone.
 */
export async function lockSectionForPlacement(
  tx: DrizzleDB,
  sectionId: string,
  alsoTouched: Array<string | null> = [],
): Promise<LockedSection | null> {
  const locked = await lockSections(tx, [sectionId, ...alsoTouched]);
  return locked.find((section) => section.sectionId === sectionId) ?? null;
}

/**
 * Locks the student's current placements, then their sections, before a write that changes
 * whether the student counts towards them (a status change). Placement rows first, as a section
 * change does, so the two cannot take the locks in opposite orders.
 */
export async function lockStudentSections(
  tx: DrizzleDB,
  studentProfileId: string,
): Promise<LockedSection[]> {
  const placements = await tx
    .select({ sectionId: studentAcademicsLive.sectionId })
    .from(studentAcademicsLive)
    .where(eq(studentAcademicsLive.studentProfileId, studentProfileId))
    .orderBy(asc(studentAcademicsLive.id))
    .for('no key update');
  return lockSections(
    tx,
    placements.map((placement) => placement.sectionId),
  );
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

/** `strengthChange` for every section locked before the write. */
export async function strengthChanges(
  tx: DrizzleDB,
  locked: LockedSection[],
): Promise<SectionStrengthChange[]> {
  const changes: SectionStrengthChange[] = [];
  for (const section of locked) changes.push(await strengthChange(tx, section));
  return changes;
}
