import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { competencyLevel } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { examSchedules } from './exam-schedules';
import { subjectTopics } from './subject-topics';

/**
 * A student's attainment of one {@link subjectTopics} learning outcome in one
 * exam (NEP topic-wise). The 4-level {@link competencyLevel} plus an optional
 * free-text descriptor feed the report card's topic-wise section.
 */
export const examTopicAssessments = pgTable(
  'exam_topic_assessments',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    examScheduleId: uuid('exam_schedule_id')
      .notNull()
      .references(() => examSchedules.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    subjectTopicId: uuid('subject_topic_id')
      .notNull()
      .references(() => subjectTopics.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    competencyLevel: competencyLevel('competency_level').notNull(),
    descriptor: text(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('exam_topic_assessments_key')
      .on(table.examScheduleId, table.studentId, table.subjectTopicId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('exam_topic_assessments_tenant_id_idx').on(table.tenantId),
    index('exam_topic_assessments_schedule_id_idx').on(table.examScheduleId),
    index('exam_topic_assessments_student_id_idx').on(table.studentId),
    ...tenantPolicies('exam_topic_assessments'),
  ],
);
