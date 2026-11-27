import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../../common/columns';
import { weekday } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { sections } from '../sections';
import { timetablePeriods } from './timetable-periods';
import { timetables } from './timetables';

/**
 * One assignment cell: (timetable, section, period, weekday, split) →
 * subject + teacher + room.
 *
 * - Day-split: different weekdays carry different rows for the same period.
 * - Class-split: parallel groups (e.g. lab batches) share a (period, weekday)
 *   but differ by `splitIndex` (0 = whole class / first group).
 *
 * A teacher cannot be booked twice in the same (timetable, period, weekday) —
 * enforced by the partial-unique index below.
 */
export const timetableEntries = pgTable(
  'timetable_entries',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    timetableId: uuid('timetable_id').notNull(),
    periodId: uuid('period_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    dayOfWeek: weekday('day_of_week').notNull(),
    splitIndex: integer('split_index').default(0).notNull(),
    /** Optional label for a class-split group, e.g. "Group A". Null = whole class. */
    splitLabel: text('split_label'),
    // Same-institute key with ON DELETE SET NULL (subject_id): custom SQL, Drizzle cannot declare it.
    subjectId: uuid('subject_id'),
    // Same-institute key with ON DELETE SET NULL (teacher_id): custom SQL, Drizzle cannot declare it.
    teacherId: uuid('teacher_id'),
    room: text(),
    notes: text(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'timetable_entries_timetable_id_tenant_fkey',
      [table.timetableId, table.tenantId],
      [timetables.id, timetables.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'timetable_entries_period_id_tenant_fkey',
      [table.periodId, table.tenantId],
      [timetablePeriods.id, timetablePeriods.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'timetable_entries_section_id_tenant_fkey',
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
    uniqueIndex('timetable_entries_cell_key')
      .on(table.timetableId, table.sectionId, table.periodId, table.dayOfWeek, table.splitIndex)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('timetable_entries_teacher_slot_key')
      .on(table.timetableId, table.periodId, table.dayOfWeek, table.teacherId)
      .where(sql`${table.teacherId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    index('timetable_entries_tenant_id_idx').on(table.tenantId),
    index('timetable_entries_timetable_section_idx').on(table.timetableId, table.sectionId),
    index('timetable_entries_teacher_id_idx').on(table.teacherId),
    index('timetable_entries_section_id_idx').on(table.sectionId),
    ...tenantPolicies('timetable_entries'),
  ],
);
