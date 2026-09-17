import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { examStatus, examType } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { academicYears } from '../academic-years';
import { institutes } from '../institutes';
import { examTerms } from './exam-terms';
import { gradingSchemes } from './grading-schemes';

/**
 * One assessment event (Unit Test, Mid-Term, Final, Practical, …). Its scope +
 * schedule live in `exam_schedules`, marks in `exam_marks`. `weightInTerm` is
 * this exam's contribution to its term's aggregated report card.
 */
export const exams = pgTable(
  'exams',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    examTermId: uuid('exam_term_id').references(() => examTerms.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    name: i18nText('name').notNull(),
    type: examType().default('UNIT_TEST').notNull(),
    /** Grade scheme for this exam; null falls back to the standard/institute default. */
    gradingSchemeId: uuid('grading_scheme_id').references(() => gradingSchemes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    status: examStatus().default('DRAFT').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    /** This exam's weight within its term's aggregate (percent). */
    weightInTerm: numeric('weight_in_term', { precision: 5, scale: 2, mode: 'number' })
      .default(100)
      .notNull(),
    description: text(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('exams_year_name_key')
      .on(table.tenantId, table.academicYearId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      'exams_date_range_check',
      sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`,
    ),
    index('exams_tenant_id_idx').on(table.tenantId),
    index('exams_academic_year_id_idx').on(table.academicYearId),
    index('exams_exam_term_id_idx').on(table.examTermId),
    index('exams_status_idx').on(table.status),
    ...tenantPolicies('exams'),
  ],
);
