import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { weekday } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { sections } from '../sections';
import { subjects } from '../subjects';
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
    timetableId: uuid('timetable_id')
      .notNull()
      .references(() => timetables.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => timetablePeriods.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dayOfWeek: weekday('day_of_week').notNull(),
    splitIndex: integer('split_index').default(0).notNull(),
    /** Optional label for a class-split group, e.g. "Group A". Null = whole class. */
    splitLabel: text('split_label'),
    subjectId: uuid('subject_id').references(() => subjects.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    teacherId: uuid('teacher_id').references(() => memberships.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    room: text(),
    notes: text(),
    ...tenantColumns,
  },
  (table) => [
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
