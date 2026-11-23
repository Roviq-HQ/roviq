import { Injectable, Logger } from '@nestjs/common';
import {
  BOARD_EXAM_CLASSES,
  BOARD_SUBJECTS,
  DEFAULT_SECTION_NAMES,
  DEFAULT_SECTIONS_PER_STANDARD,
  DEPARTMENT_STANDARDS,
  LIBRARY_SECTIONS,
  LIBRARY_STANDARD,
} from './board-templates';
import { InstituteSeederRepository } from './repositories/institute-seeder.repository';
import type { StandardSeed } from './repositories/types';

@Injectable()
export class InstituteSeederService {
  private readonly logger = new Logger(InstituteSeederService.name);

  constructor(private readonly repo: InstituteSeederRepository) {}

  /**
   * Seed standards for selected departments using board-appropriate templates.
   * Idempotent: checks existence before creating.
   */
  async seedStandards(
    tenantId: string,
    academicYearId: string,
    departments: readonly string[],
    board: string | undefined,
    userId: string,
  ): Promise<string[]> {
    const seeds: StandardSeed[] = [];
    for (const dept of departments) {
      const templates = DEPARTMENT_STANDARDS[dept];
      if (!templates) {
        this.logger.warn(`Unknown department: ${dept}, skipping`);
        continue;
      }
      for (const tmpl of templates) {
        const isBoardExamClass = board
          ? (BOARD_EXAM_CLASSES[board] ?? []).includes(tmpl.numericOrder)
          : tmpl.isBoardExamClass;
        seeds.push({ template: tmpl, isBoardExamClass });
      }
    }

    const createdIds = await this.repo.seedStandards(tenantId, academicYearId, userId, seeds);

    this.logger.log(`Seeded ${createdIds.length} standards for ${departments.join(', ')}`);
    return createdIds;
  }

  /**
   * Seed default sections for a standard.
   * Idempotent: checks existence before creating.
   */
  async seedSections(
    tenantId: string,
    standardId: string,
    academicYearId: string,
    userId: string,
    count = DEFAULT_SECTIONS_PER_STANDARD,
    names = DEFAULT_SECTION_NAMES,
  ): Promise<string[]> {
    const sectionNames = Array.from(
      { length: count },
      (_, i) => names[i] ?? String.fromCodePoint(65 + i), // A, B, C, D...
    );
    return this.repo.seedSections(tenantId, standardId, academicYearId, userId, sectionNames);
  }

  /**
   * Seed subjects for a board and link them to standards.
   * Idempotent: checks existence before creating.
   */
  async seedSubjects(
    tenantId: string,
    academicYearId: string,
    board: string,
    userId: string,
  ): Promise<string[]> {
    const templates = BOARD_SUBJECTS[board];
    if (!templates) {
      this.logger.warn(`No subject templates for board: ${board}`);
      return [];
    }

    const createdIds = await this.repo.seedSubjects(tenantId, academicYearId, userId, templates);

    this.logger.log(`Seeded ${createdIds.length} subjects for board ${board}`);
    return createdIds;
  }

  /**
   * Seed library structure: single standard + 2 sections.
   */
  async seedLibrary(tenantId: string, academicYearId: string, userId: string): Promise<void> {
    const libraryStandardId = await this.repo.findOrCreateNamedStandard(
      tenantId,
      academicYearId,
      userId,
      LIBRARY_STANDARD,
    );

    await this.seedSections(
      tenantId,
      libraryStandardId,
      academicYearId,
      userId,
      2,
      LIBRARY_SECTIONS,
    );
    this.logger.log('Seeded library structure');
  }
}
