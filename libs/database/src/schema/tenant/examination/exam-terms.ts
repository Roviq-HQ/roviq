import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { academicYears } from '../academic-years';
import { institutes } from '../institutes';

/**
 * A term within an academic year (e.g. "Term 1", "Term 2") that report cards
 * aggregate over. `weightInFinal` lets an annual report card roll terms up with
 * weightage. Promoted to a first-class row (vs the `academic_years.termStructure`
 * jsonb) so exams and report cards can FK to it.
 */
export const examTerms = pgTable(
  'exam_terms',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: i18nText('name').notNull(),
    sequence: integer().default(0).notNull(),
    /** Weight of this term in an annual roll-up (percent). */
    weightInFinal: numeric('weight_in_final', { precision: 5, scale: 2, mode: 'number' })
      .default(0)
      .notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('exam_terms_year_name_key')
      .on(table.tenantId, table.academicYearId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('exam_terms_tenant_id_idx').on(table.tenantId),
    index('exam_terms_academic_year_id_idx').on(table.academicYearId),
    ...tenantPolicies('exam_terms'),
  ],
);
