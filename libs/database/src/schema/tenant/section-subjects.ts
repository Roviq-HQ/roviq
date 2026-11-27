import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from './institutes';
import { sections } from './sections';
import { subjects } from './subjects';

export const sectionSubjects = pgTable(
  'section_subjects',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    subjectId: uuid('subject_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'section_subjects_subject_id_tenant_fkey',
      [table.subjectId, table.tenantId],
      [subjects.id, subjects.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'section_subjects_section_id_tenant_fkey',
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
    uniqueIndex('section_subjects_subject_section_key')
      .on(table.subjectId, table.sectionId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('section_subjects_tenant_id_idx').on(table.tenantId),
    index('section_subjects_section_id_idx').on(table.sectionId),
    ...tenantPolicies('section_subjects'),
  ],
);
