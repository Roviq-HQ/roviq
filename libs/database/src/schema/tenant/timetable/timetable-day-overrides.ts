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
import { tenantColumns } from '../../common/columns';
import { timetableOverrideType } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { memberships } from '../memberships';
import { sections } from '../sections';
import { subjects } from '../subjects';
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
    timetableId: uuid('timetable_id')
      .notNull()
      .references(() => timetables.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    date: date('date').notNull(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => timetablePeriods.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    splitIndex: integer('split_index').default(0).notNull(),
    overrideType: timetableOverrideType('override_type').notNull(),
    subjectId: uuid('subject_id').references(() => subjects.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    teacherId: uuid('teacher_id').references(() => memberships.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    room: text(),
    originalSubjectId: uuid('original_subject_id'),
    originalTeacherId: uuid('original_teacher_id'),
    reason: text(),
    ...tenantColumns,
  },
  (table) => [
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
