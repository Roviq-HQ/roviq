import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { standards } from '../standards';
import { subjects } from '../subjects';

/**
 * NEP learning outcomes / topics for a subject (optionally scoped to a standard).
 * Per-student attainment against these is recorded in `exam_topic_assessments`
 * and rendered as the topic-wise / competency section of the report card.
 */
export const subjectTopics = pgTable(
  'subject_topics',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Optional standard scope; null = applies to the subject across standards. */
    standardId: uuid('standard_id').references(() => standards.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    name: i18nText('name').notNull(),
    code: text(),
    /** The expected learning outcome / competency statement. */
    learningOutcome: text('learning_outcome'),
    sequence: integer().default(0).notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('subject_topics_subject_standard_code_key')
      .on(table.subjectId, table.standardId, table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index('subject_topics_tenant_id_idx').on(table.tenantId),
    index('subject_topics_subject_id_idx').on(table.subjectId),
    ...tenantPolicies('subject_topics'),
  ],
);
