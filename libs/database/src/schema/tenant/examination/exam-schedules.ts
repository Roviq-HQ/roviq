import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { assessmentComponent } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { sections } from '../sections';
import { subjects } from '../subjects';
import { exams } from './exams';

/**
 * One datesheet row: what is being examined and when. A subject may carry
 * several rows per exam — one per {@link assessmentComponent} (theory /
 * practical / internal). `maxMarks` defaults from the subject's component cap.
 */
export const examSchedules = pgTable(
  'exam_schedules',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    component: assessmentComponent().default('THEORY').notNull(),
    examDate: date('exam_date'),
    startTime: time('start_time'),
    endTime: time('end_time'),
    maxMarks: numeric('max_marks', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    passMarks: numeric('pass_marks', { precision: 6, scale: 2, mode: 'number' }),
    room: text(),
    invigilatorId: uuid('invigilator_id').references(() => memberships.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('exam_schedules_cell_key')
      .on(table.examId, table.sectionId, table.subjectId, table.component)
      .where(sql`${table.deletedAt} IS NULL`),
    index('exam_schedules_tenant_id_idx').on(table.tenantId),
    index('exam_schedules_exam_id_idx').on(table.examId),
    index('exam_schedules_section_id_idx').on(table.sectionId),
    index('exam_schedules_subject_id_idx').on(table.subjectId),
    ...tenantPolicies('exam_schedules'),
  ],
);
