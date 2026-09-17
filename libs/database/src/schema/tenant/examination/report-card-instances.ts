import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { reportCardStatus, resultStatus } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { studentProfiles } from '../../user-profiles/student-profiles';
import { academicYears } from '../academic-years';
import { institutes } from '../institutes';
import { sections } from '../sections';
import { reportCards } from './report-cards';

/**
 * A materialised, per-student report card. `payload` holds the immutable
 * computed snapshot (per-subject marks/components/grades, topic-wise competency,
 * co-scholastic grades) so a published card is stable and the PDF renders from
 * one row; regeneration recomputes the snapshot from current marks.
 */
export const reportCardInstances = pgTable(
  'report_card_instances',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    reportCardId: uuid('report_card_id')
      .notNull()
      .references(() => reportCards.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    sectionId: uuid('section_id').references(() => sections.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    status: reportCardStatus().default('DRAFT').notNull(),
    maxMarks: numeric('max_marks', { precision: 8, scale: 2, mode: 'number' }),
    obtainedMarks: numeric('obtained_marks', { precision: 8, scale: 2, mode: 'number' }),
    percentage: numeric({ precision: 5, scale: 2, mode: 'number' }),
    gpa: numeric({ precision: 4, scale: 2, mode: 'number' }),
    grade: text(),
    rank: integer(),
    attendancePercent: numeric('attendance_percent', { precision: 5, scale: 2, mode: 'number' }),
    resultStatus: resultStatus('result_status').default('PENDING').notNull(),
    classTeacherRemark: text('class_teacher_remark'),
    principalRemark: text('principal_remark'),
    /** Immutable computed snapshot of the full card (subjects, topics, co-scholastic). */
    payload: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('report_card_instances_card_student_key')
      .on(table.reportCardId, table.studentProfileId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('report_card_instances_tenant_id_idx').on(table.tenantId),
    index('report_card_instances_report_card_id_idx').on(table.reportCardId),
    index('report_card_instances_student_profile_id_idx').on(table.studentProfileId),
    index('report_card_instances_section_id_idx').on(table.sectionId),
    ...tenantPolicies('report_card_instances'),
  ],
);
