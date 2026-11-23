import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  sections,
  sectionsLive,
  standardSubjects,
  standards,
  standardsLive,
  subjects,
  subjectsLive,
  withTenant,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';
import type { SubjectTemplate } from '../board-templates';
import { InstituteSeederRepository } from './institute-seeder.repository';
import type { StandardSeed } from './types';

@Injectable()
export class InstituteSeederDrizzleRepository extends InstituteSeederRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async seedStandards(
    tenantId: string,
    academicYearId: string,
    userId: string,
    seeds: StandardSeed[],
  ): Promise<string[]> {
    const createdIds: string[] = [];

    await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'seeder:institute-seeder.service'),
      async (tx) => {
        for (const { template: tmpl, isBoardExamClass } of seeds) {
          const existing = await tx
            .select({ id: standardsLive.id })
            .from(standardsLive)
            .where(
              and(
                eq(standardsLive.academicYearId, academicYearId),
                eq(standardsLive.numericOrder, tmpl.numericOrder),
              ),
            );

          if (existing.length > 0) {
            createdIds.push(existing[0].id);
            continue;
          }

          const rows = await tx
            .insert(standards)
            .values({
              tenantId,
              academicYearId,
              name: { en: tmpl.name },
              numericOrder: tmpl.numericOrder,
              level: tmpl.level as (typeof standards.level.enumValues)[number],
              nepStage: tmpl.nepStage as (typeof standards.nepStage.enumValues)[number],
              department: tmpl.department,
              isBoardExamClass,
              streamApplicable: tmpl.streamApplicable,
              udiseClassCode: tmpl.udiseClassCode,
              maxStudentsPerSection: 40,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning({ id: standards.id });

          createdIds.push(rows[0].id);
        }
      },
    );

    return createdIds;
  }

  async seedSections(
    tenantId: string,
    standardId: string,
    academicYearId: string,
    userId: string,
    names: string[],
  ): Promise<string[]> {
    const createdIds: string[] = [];

    await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'seeder:institute-seeder.service'),
      async (tx) => {
        for (const [i, name] of names.entries()) {
          const existing = await tx
            .select({ id: sectionsLive.id })
            .from(sectionsLive)
            .where(
              and(
                eq(sectionsLive.standardId, standardId),
                sql`${sectionsLive.name}->>'en' = ${name}`,
              ),
            );

          if (existing.length > 0) {
            createdIds.push(existing[0].id);
            continue;
          }

          const rows = await tx
            .insert(sections)
            .values({
              tenantId,
              standardId,
              academicYearId,
              name: { en: name },
              displayOrder: i,
              genderRestriction: 'CO_ED',
              capacity: 40,
              currentStrength: 0,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning({ id: sections.id });

          createdIds.push(rows[0].id);
        }
      },
    );

    return createdIds;
  }

  async seedSubjects(
    tenantId: string,
    academicYearId: string,
    userId: string,
    templates: SubjectTemplate[],
  ): Promise<string[]> {
    const createdIds: string[] = [];

    await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'seeder:institute-seeder.service'),
      async (tx) => {
        // All standards of the year, to map numericOrder → id
        const allStandards = await tx
          .select({ id: standardsLive.id, numericOrder: standardsLive.numericOrder })
          .from(standardsLive)
          .where(eq(standardsLive.academicYearId, academicYearId));

        const orderToId = new Map(allStandards.map((s) => [s.numericOrder, s.id]));

        for (const tmpl of templates) {
          // Idempotency: check by name + boardCode
          const existing = await tx
            .select({ id: subjectsLive.id })
            .from(subjectsLive)
            .where(
              and(
                eq(subjectsLive.name, tmpl.name),
                tmpl.boardCode
                  ? eq(subjectsLive.boardCode, tmpl.boardCode)
                  : eq(subjectsLive.name, tmpl.name),
              ),
            );

          let subjectId: string;

          if (existing.length > 0) {
            subjectId = existing[0].id;
          } else {
            const rows = await tx
              .insert(subjects)
              .values({
                tenantId,
                name: tmpl.name,
                shortName: tmpl.shortName,
                boardCode: tmpl.boardCode,
                type: tmpl.type as (typeof subjects.type.enumValues)[number],
                isMandatory: tmpl.isMandatory,
                hasPractical: tmpl.hasPractical,
                theoryMarks: tmpl.theoryMarks,
                practicalMarks: tmpl.practicalMarks,
                internalMarks: tmpl.internalMarks,
                isElective: false,
                createdBy: userId,
                updatedBy: userId,
              })
              .returning({ id: subjects.id });

            subjectId = rows[0].id;
          }

          createdIds.push(subjectId);

          for (const classNum of tmpl.applicableClasses) {
            const standardId = orderToId.get(classNum);
            if (!standardId) continue;

            await tx
              .insert(standardSubjects)
              .values({
                tenantId,
                subjectId,
                standardId,
                createdBy: userId,
                updatedBy: userId,
              })
              .onConflictDoNothing();
          }
        }
      },
    );

    return createdIds;
  }

  async findOrCreateNamedStandard(
    tenantId: string,
    academicYearId: string,
    userId: string,
    standard: { name: string; numericOrder: number },
  ): Promise<string> {
    return withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'seeder:institute-seeder.service'),
      async (tx) => {
        const existing = await tx
          .select({ id: standardsLive.id })
          .from(standardsLive)
          .where(
            and(
              eq(standardsLive.academicYearId, academicYearId),
              sql`${standardsLive.name}->>'en' = ${standard.name}`,
            ),
          );

        if (existing.length > 0) return existing[0].id;

        const rows = await tx
          .insert(standards)
          .values({
            tenantId,
            academicYearId,
            name: { en: standard.name },
            numericOrder: standard.numericOrder,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning({ id: standards.id });
        return rows[0].id;
      },
    );
  }
}
