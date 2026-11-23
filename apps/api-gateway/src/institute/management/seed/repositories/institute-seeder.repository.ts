import type { SubjectTemplate } from '../board-templates';
import type { StandardSeed } from './types';

/**
 * Seeding writes, each method one transaction as the institute. Every row is looked up
 * before it is inserted, so a retried step creates nothing twice.
 */
export abstract class InstituteSeederRepository {
  /** Ids of the standards of the year, existing or created, in `seeds` order. */
  abstract seedStandards(
    tenantId: string,
    academicYearId: string,
    userId: string,
    seeds: StandardSeed[],
  ): Promise<string[]>;
  /** Ids of the sections, existing (by English name) or created with display order = index. */
  abstract seedSections(
    tenantId: string,
    standardId: string,
    academicYearId: string,
    userId: string,
    names: string[],
  ): Promise<string[]>;
  /** Ids of the subjects, existing or created, linked to the year's standards they apply to. */
  abstract seedSubjects(
    tenantId: string,
    academicYearId: string,
    userId: string,
    templates: SubjectTemplate[],
  ): Promise<string[]>;
  /** The year's standard with this English name, created when missing. */
  abstract findOrCreateNamedStandard(
    tenantId: string,
    academicYearId: string,
    userId: string,
    standard: { name: string; numericOrder: number },
  ): Promise<string>;
}
