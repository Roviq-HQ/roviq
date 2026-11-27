import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { coScholasticAreas } from './co-scholastic-areas';
import { examTerms } from './exam-terms';

/**
 * A student's grade for one {@link coScholasticAreas} domain in one term.
 * Pulled into the report-card snapshot at generation time.
 */
export const coScholasticAssessments = pgTable(
  'co_scholastic_assessments',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    coScholasticAreaId: uuid('co_scholastic_area_id').notNull(),
    studentId: uuid('student_id').notNull(),
    examTermId: uuid('exam_term_id').notNull(),
    /** Grade label from the area's co-scholastic scheme, e.g. "A". */
    grade: text().notNull(),
    descriptor: text(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'co_scholastic_assessments_exam_term_id_tenant_fkey',
      [table.examTermId, table.tenantId],
      [examTerms.id, examTerms.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'co_scholastic_assessments_co_scholastic_area_id_tenant_fkey',
      [table.coScholasticAreaId, table.tenantId],
      [coScholasticAreas.id, coScholasticAreas.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'co_scholastic_assessments_student_id_tenant_fkey',
      [table.studentId, table.tenantId],
      [memberships.id, memberships.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('co_scholastic_assessments_key')
      .on(table.coScholasticAreaId, table.studentId, table.examTermId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('co_scholastic_assessments_tenant_id_idx').on(table.tenantId),
    index('co_scholastic_assessments_student_id_idx').on(table.studentId),
    ...tenantPolicies('co_scholastic_assessments'),
  ],
);
