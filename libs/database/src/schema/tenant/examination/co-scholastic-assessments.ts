import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
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
    coScholasticAreaId: uuid('co_scholastic_area_id')
      .notNull()
      .references(() => coScholasticAreas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    examTermId: uuid('exam_term_id')
      .notNull()
      .references(() => examTerms.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Grade label from the area's co-scholastic scheme, e.g. "A". */
    grade: text().notNull(),
    descriptor: text(),
    ...tenantColumns,
  },
  (table) => [
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
