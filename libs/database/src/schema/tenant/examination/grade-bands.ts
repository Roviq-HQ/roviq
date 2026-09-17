import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { gradingSchemes } from './grading-schemes';

/**
 * One band of a {@link gradingSchemes} scheme. For SCHOLASTIC schemes
 * `minPercent`/`maxPercent` define the mark range (inclusive) and `gradePoint`
 * the GPA contribution. For CO_SCHOLASTIC schemes the percent columns are null
 * and only `grade` + `descriptor` + `sequence` are used.
 */
export const gradeBands = pgTable(
  'grade_bands',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    gradingSchemeId: uuid('grading_scheme_id')
      .notNull()
      .references(() => gradingSchemes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Grade label, e.g. "A1", "B2", "Pass". */
    grade: text().notNull(),
    /** Inclusive lower bound (0–100). Null for co-scholastic scales. */
    minPercent: numeric('min_percent', { precision: 5, scale: 2, mode: 'number' }),
    /** Inclusive upper bound (0–100). Null for co-scholastic scales. */
    maxPercent: numeric('max_percent', { precision: 5, scale: 2, mode: 'number' }),
    /** GPA contribution, e.g. 10.0 for A1. Null when not GPA-based. */
    gradePoint: numeric('grade_point', { precision: 4, scale: 2, mode: 'number' }),
    /** Descriptive remark shown on the report card, e.g. "Outstanding". */
    descriptor: text(),
    /** Whether a student in this band has passed the subject. */
    isPassing: boolean('is_passing').default(true).notNull(),
    /** Display order (highest grade first). */
    sequence: integer().default(0).notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('grade_bands_scheme_grade_key')
      .on(table.gradingSchemeId, table.grade)
      .where(sql`${table.deletedAt} IS NULL`),
    index('grade_bands_tenant_id_idx').on(table.tenantId),
    index('grade_bands_scheme_id_idx').on(table.gradingSchemeId),
    ...tenantPolicies('grade_bands'),
  ],
);
