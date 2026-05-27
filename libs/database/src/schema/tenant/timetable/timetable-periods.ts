import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantColumns } from '../../common/columns';
import { daySession, periodKind } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { timetables } from './timetables';

/**
 * The shared time grid for a timetable: regular periods, breaks (lunch/recess),
 * and morning/evening extra periods. All sections of the timetable share this
 * grid. The number of teaching periods is derived (count of kind='PERIOD'),
 * never stored — so it cannot drift.
 */
export const timetablePeriods = pgTable(
  'timetable_periods',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    timetableId: uuid('timetable_id')
      .notNull()
      .references(() => timetables.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    kind: periodKind().notNull(),
    /** Display label: "1","2",… for periods; the break name; "Morning Extra 1" etc. */
    label: text().notNull(),
    /** Ordering within the day (lower = earlier). */
    sequence: integer().notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    session: daySession().default('MAIN').notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('timetable_periods_timetable_sequence_key')
      .on(table.timetableId, table.sequence)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex('timetable_periods_timetable_label_key')
      .on(table.timetableId, table.label)
      .where(sql`${table.deletedAt} IS NULL`),
    check('timetable_periods_time_order_check', sql`${table.endTime} > ${table.startTime}`),
    index('timetable_periods_tenant_id_idx').on(table.tenantId),
    index('timetable_periods_timetable_id_idx').on(table.timetableId),
    ...tenantPolicies('timetable_periods'),
  ],
);
