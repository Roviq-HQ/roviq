import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { academicYears } from '../academic-years';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { sections } from '../sections';
import { subjects } from '../subjects';

/**
 * One row per (section, date, period) attendance session.
 *
 * Period is nullable — NULL means whole-day attendance (`DAILY` mode).
 * Non-null period means lecture-wise attendance (`LECTURE_WISE` mode).
 *
 * A teacher opens attendance for Section 5-A, Period 2, Math on 2026-04-23
 * → creates one attendance_sessions row + N attendance_entries (one per student).
 */
export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    sectionId: uuid('section_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    /** Date attendance is being taken for (YYYY-MM-DD). */
    date: date('date').notNull(),
    /** Period / lecture slot number (1, 2, 3, …). NULL for whole-day DAILY mode. */
    period: integer('period'),
    /** Subject being taught in this period — optional for DAILY mode. */
    subjectId: uuid('subject_id').references(() => subjects.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Teacher / staff membership who took this attendance session. */
    lecturerId: uuid('lecturer_id').notNull(),
    /**
     * Set to true when another teacher is attempting to override a session.
     * Clients use this as a confirmation flag.
     */
    overrideCheck: boolean('override_check').default(false).notNull(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'attendance_sessions_section_id_tenant_fkey',
      [table.sectionId, table.tenantId],
      [sections.id, sections.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'attendance_sessions_academic_year_id_tenant_fkey',
      [table.academicYearId, table.tenantId],
      [academicYears.id, academicYears.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'attendance_sessions_lecturer_id_tenant_fkey',
      [table.lecturerId, table.tenantId],
      [memberships.id, memberships.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('attendance_sessions_section_date_period_key')
      .on(table.sectionId, table.date, table.period)
      .where(sql`${table.deletedAt} IS NULL`),
    index('attendance_sessions_tenant_id_idx').on(table.tenantId),
    index('attendance_sessions_section_date_idx').on(table.sectionId, table.date),
    index('attendance_sessions_academic_year_id_idx').on(table.academicYearId),
    index('attendance_sessions_date_idx').on(table.date),
    ...tenantPolicies('attendance_sessions'),
  ],
);
