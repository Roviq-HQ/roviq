// libs/database/src/seed/demo/populated-section.ts
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { sections, studentAcademics, studentProfiles } from '../..';
import type { DrizzleDB } from '../../providers';

export interface PopulatedSection {
  id: string;
  academicYearId: string;
  standardId: string;
}

/**
 * The institute section with the most students enrolled (stable tie-break by
 * id). Timetable + examination seeders target this so marks, rosters, and the
 * weekly grid render against a section that actually has students — the
 * first-by-displayOrder section can be empty.
 */
export async function pickPopulatedSection(
  tx: DrizzleDB,
  tenantId: string,
): Promise<PopulatedSection | null> {
  const [top] = await tx
    .select({ sectionId: studentAcademics.sectionId })
    .from(studentAcademics)
    .innerJoin(studentProfiles, eq(studentProfiles.id, studentAcademics.studentProfileId))
    .innerJoin(sections, eq(sections.id, studentAcademics.sectionId))
    .where(
      and(
        eq(sections.tenantId, tenantId),
        isNull(studentProfiles.deletedAt),
        isNull(sections.deletedAt),
      ),
    )
    .groupBy(studentAcademics.sectionId)
    .orderBy(desc(count()), asc(studentAcademics.sectionId))
    .limit(1);
  if (!top) return null;

  const [section] = await tx
    .select({
      id: sections.id,
      academicYearId: sections.academicYearId,
      standardId: sections.standardId,
    })
    .from(sections)
    .where(eq(sections.id, top.sectionId))
    .limit(1);
  return section ?? null;
}
