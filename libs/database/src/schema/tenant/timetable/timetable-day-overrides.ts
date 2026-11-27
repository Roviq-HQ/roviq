import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../../common/columns';
import { timetableOverrideType } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { sections } from '../sections';
import { timetablePeriods } from './timetable-periods';
import { timetables } from './timetables';

/**
 * A per-date deviation from the master timetable: substitution, cancellation,
 * room/subject change, or an ad-hoc extra slot. The effective schedule for any
 * date = master entries for that weekday with these overrides layered on.
 *
 * `originalSubjectId`/`originalTeacherId` snapshot the master cell at creation
 * time so history survives later master edits. Replaces the legacy daily
 * full-snapshot table (no cron, no storage bloat, any date queryable).
 */
export const timetableDayOverrides = pgTable(
  'timetable_day_overrides',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    timetableId: uuid('timetable_id').notNull(),
    date: date('date').notNull(),
    sectionId: uuid('section_id').notNull(),
    periodId: uuid('period_id').notNull(),
    splitIndex: integer('split_index').default(0).notNull(),
    overrideType: timetableOverrideType('override_type').notNull(),
    // Same-institute key with ON DELETE SET NULL (subject_id): custom SQL, Drizzle cannot declare it.
    subjectId: uuid('subject_id'),
    // Same-institute key with ON DELETE SET NULL (teacher_id): custom SQL, Drizzle cannot declare it.
    teacherId: uuid('teacher_id'),
    room: text(),
    originalSubjectId: uuid('original_subject_id'),
    originalTeacherId: uuid('original_teacher_id'),
    reason: text(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'timetable_day_overrides_timetable_id_tenant_fkey',
      [table.timetableId, table.tenantId],
      [timetables.id, timetables.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'timetable_day_overrides_period_id_tenant_fkey',
      [table.periodId, table.tenantId],
      [timetablePeriods.id, timetablePeriods.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'timetable_day_overrides_section_id_tenant_fkey',
      [table.sectionId, table.tenantId],
      [sections.id, sections.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('timetable_day_overrides_cell_key')
      .on(table.timetableId, table.date, table.sectionId, table.periodId, table.splitIndex)
      .where(sql`${table.deletedAt} IS NULL`),
    index('timetable_day_overrides_tenant_id_idx').on(table.tenantId),
    index('timetable_day_overrides_timetable_date_idx').on(table.timetableId, table.date),
    index('timetable_day_overrides_section_date_idx').on(table.sectionId, table.date),
    index('timetable_day_overrides_teacher_id_idx').on(table.teacherId),
    ...tenantPolicies('timetable_day_overrides'),
  ],
);
