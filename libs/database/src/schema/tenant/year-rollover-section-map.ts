import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { academicYears } from './academic-years';
import { institutes } from './institutes';
import { sections } from './sections';

/**
 * Where the year rollover sends the students of one section of the previous year, when the admin
 * chose something other than the section of the same name. `academic_year_id` is the year being
 * activated. A trigger (migration `rov-323-year-rollover-section-map`) keeps both sections in
 * the row's institute and the target section in the row's year.
 */
export const yearRolloverSectionMap = pgTable(
  'year_rollover_section_map',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    fromSectionId: uuid('from_section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    toSectionId: uuid('to_section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('year_rollover_section_map_tenant_id_idx').on(table.tenantId),
    index('year_rollover_section_map_to_section_id_idx').on(table.toSectionId),
    index('year_rollover_section_map_from_section_id_idx').on(table.fromSectionId),
    uniqueIndex('year_rollover_section_map_year_from_key')
      .on(table.academicYearId, table.fromSectionId)
      .where(sql`deleted_at IS NULL`),
    ...tenantPolicies('year_rollover_section_map'),
  ],
);
