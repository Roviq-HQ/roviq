import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { sections } from '../sections';
import { timetables } from './timetables';

/** Which class sections a timetable covers. The grid (entries) is generated per covered section. */
export const timetableSections = pgTable(
  'timetable_sections',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    timetableId: uuid('timetable_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'timetable_sections_timetable_id_tenant_fkey',
      [table.timetableId, table.tenantId],
      [timetables.id, timetables.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'timetable_sections_section_id_tenant_fkey',
      [table.sectionId, table.tenantId],
      [sections.id, sections.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('timetable_sections_timetable_section_key')
      .on(table.timetableId, table.sectionId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('timetable_sections_tenant_id_idx').on(table.tenantId),
    index('timetable_sections_timetable_id_idx').on(table.timetableId),
    index('timetable_sections_section_id_idx').on(table.sectionId),
    ...tenantPolicies('timetable_sections'),
  ],
);
