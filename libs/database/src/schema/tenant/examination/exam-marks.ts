import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { examSchedules } from './exam-schedules';

/**
 * A student's marks for one {@link examSchedules} row (one component of one
 * subject in one exam). `obtainedMarks` null = not yet entered or absent.
 * `version` (from tenantColumns) backs optimistic concurrency on marks entry.
 */
export const examMarks = pgTable(
  'exam_marks',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    examScheduleId: uuid('exam_schedule_id')
      .notNull()
      .references(() => examSchedules.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** The student's membership id (matches `student_academics` rosters). */
    studentId: uuid('student_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    obtainedMarks: numeric('obtained_marks', { precision: 6, scale: 2, mode: 'number' }),
    isAbsent: boolean('is_absent').default(false).notNull(),
    /** Exempted from this component (e.g. medical) — excluded from totals. */
    isExempted: boolean('is_exempted').default(false).notNull(),
    remarks: text(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('exam_marks_schedule_student_key')
      .on(table.examScheduleId, table.studentId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('exam_marks_tenant_id_idx').on(table.tenantId),
    index('exam_marks_schedule_id_idx').on(table.examScheduleId),
    index('exam_marks_student_id_idx').on(table.studentId),
    ...tenantPolicies('exam_marks'),
  ],
);
