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
import { sameTenantForeignKey, tenantColumns } from '../../common/columns';
import { assessmentComponent } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
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
    examId: uuid('exam_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    component: assessmentComponent().default('THEORY').notNull(),
    examDate: date('exam_date'),
    startTime: time('start_time'),
    endTime: time('end_time'),
    maxMarks: numeric('max_marks', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    passMarks: numeric('pass_marks', { precision: 6, scale: 2, mode: 'number' }),
    room: text(),
    // Same-institute key with ON DELETE SET NULL (invigilator_id): custom SQL, Drizzle cannot declare it.
    invigilatorId: uuid('invigilator_id'),
    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('exam_schedules_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'exam_schedules_subject_id_tenant_fkey',
      [table.subjectId, table.tenantId],
      [subjects.id, subjects.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'exam_schedules_exam_id_tenant_fkey',
      [table.examId, table.tenantId],
      [exams.id, exams.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'exam_schedules_section_id_tenant_fkey',
      [table.sectionId, table.tenantId],
      [sections.id, sections.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
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
