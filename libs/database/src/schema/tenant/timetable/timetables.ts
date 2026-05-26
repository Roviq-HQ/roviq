import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { timetableStatus, weekday } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { academicYears } from '../academic-years';
import { institutes } from '../institutes';

/**
 * A weekly schedule template for a set of sections, valid over a date range
 * within one academic year. The period grid lives in `timetable_periods`; the
 * per-section/per-weekday assignments live in `timetable_entries`.
 *
 * At most ONE timetable per (institute, academic year) may be ACTIVE — enforced
 * both by the partial-unique index below and transactionally in the service.
 */
export const timetables = pgTable(
  'timetables',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: i18nText('name').notNull(),
    description: text(),
    status: timetableStatus().default('DRAFT').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to').notNull(),
    /** Days the timetable runs. Configurable subset of Mon–Sun (Sunday supported). */
    workingDays: weekday('working_days')
      .array()
      .notNull()
      .default(sql`'{MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY}'`),
    /** Start time of the first regular period — seed for grid generation. */
    dayStartTime: time('day_start_time').notNull(),
    /** Default minutes per regular period — used by generation + add-period. */
    defaultPeriodDurationMins: integer('default_period_duration_mins').notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('timetables_active_per_year_key')
      .on(table.tenantId, table.academicYearId)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.deletedAt} IS NULL`),
    uniqueIndex('timetables_tenant_year_name_key')
      .on(table.tenantId, table.academicYearId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    check('timetables_date_range_check', sql`${table.effectiveFrom} <= ${table.effectiveTo}`),
    index('timetables_tenant_id_idx').on(table.tenantId),
    index('timetables_academic_year_id_idx').on(table.academicYearId),
    index('timetables_status_idx').on(table.status),
    ...tenantPolicies('timetables'),
  ],
);
