import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { reportCardStatus } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { academicYears } from '../academic-years';
import { institutes } from '../institutes';
import { examTerms } from './exam-terms';
import { gradingSchemes } from './grading-schemes';

/**
 * A report-card template/config. `examTermId` null = annual (rolls up terms).
 * Per-student computed cards are materialised in `report_card_instances`.
 */
export const reportCards = pgTable(
  'report_cards',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** The term this card covers; null = annual aggregate across terms. */
    examTermId: uuid('exam_term_id').references(() => examTerms.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    name: i18nText('name').notNull(),
    /** Scheme used to render aggregate grade/GPA; null falls back to default. */
    gradingSchemeId: uuid('grading_scheme_id').references(() => gradingSchemes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    includeAttendance: boolean('include_attendance').default(true).notNull(),
    includeCoScholastic: boolean('include_co_scholastic').default(true).notNull(),
    includeTopicWise: boolean('include_topic_wise').default(false).notNull(),
    status: reportCardStatus().default('DRAFT').notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('report_cards_year_name_key')
      .on(table.tenantId, table.academicYearId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('report_cards_tenant_id_idx').on(table.tenantId),
    index('report_cards_academic_year_id_idx').on(table.academicYearId),
    index('report_cards_status_idx').on(table.status),
    ...tenantPolicies('report_cards'),
  ],
);
