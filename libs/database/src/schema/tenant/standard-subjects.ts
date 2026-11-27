import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from './institutes';
import { standards } from './standards';
import { subjects } from './subjects';

export const standardSubjects = pgTable(
  'standard_subjects',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    subjectId: uuid('subject_id').notNull(),
    standardId: uuid('standard_id').notNull(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'standard_subjects_subject_id_tenant_fkey',
      [table.subjectId, table.tenantId],
      [subjects.id, subjects.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'standard_subjects_standard_id_tenant_fkey',
      [table.standardId, table.tenantId],
      [standards.id, standards.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('standard_subjects_subject_standard_key')
      .on(table.subjectId, table.standardId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('standard_subjects_tenant_id_idx').on(table.tenantId),
    index('standard_subjects_standard_id_idx').on(table.standardId),
    ...tenantPolicies('standard_subjects'),
  ],
);
