import { academicYearsLive, type DrizzleDB, sectionsLive, standardsLive } from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import type { ClassLookupFailure } from './types';

export type YearClassLookup =
  | { kind: 'year_not_found' }
  | ClassLookupFailure
  | { kind: 'ok'; numericOrder: number };

/**
 * The standard must be of the year and the section of the standard. Must run inside
 * `withTenant`: RLS hides other institutes' rows, so a foreign id fails here as not found.
 * A foreign key alone would accept it.
 */
export async function findClassInYear(
  tx: DrizzleDB,
  academicYearId: string,
  standardId: string,
  sectionId: string,
): Promise<ClassLookupFailure | { kind: 'ok'; numericOrder: number }> {
  const [standard] = await tx
    .select({ numericOrder: standardsLive.numericOrder })
    .from(standardsLive)
    .where(and(eq(standardsLive.id, standardId), eq(standardsLive.academicYearId, academicYearId)))
    .limit(1);
  if (!standard) return { kind: 'standard_not_found' };

  const [section] = await tx
    .select({ id: sectionsLive.id })
    .from(sectionsLive)
    .where(and(eq(sectionsLive.id, sectionId), eq(sectionsLive.standardId, standardId)))
    .limit(1);
  if (!section) return { kind: 'section_not_found' };
  return { kind: 'ok', numericOrder: standard.numericOrder };
}

/** `findClassInYear`, after reading the year itself under the caller's institute. */
export async function findYearAndClass(
  tx: DrizzleDB,
  academicYearId: string,
  standardId: string,
  sectionId: string,
): Promise<YearClassLookup> {
  const [year] = await tx
    .select({ id: academicYearsLive.id })
    .from(academicYearsLive)
    .where(eq(academicYearsLive.id, academicYearId))
    .limit(1);
  if (!year) return { kind: 'year_not_found' };
  return findClassInYear(tx, academicYearId, standardId, sectionId);
}
