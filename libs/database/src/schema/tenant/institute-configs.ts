import { sql } from 'drizzle-orm';
import { foreignKey, jsonb, pgTable, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
import { attendanceType } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from './institutes';

// ── JSONB type definitions ─────────────────────────────

export type ShiftConfig = {
  name: string;
  /** ISO time format: HH:MM (e.g., "07:30") */
  start: string;
  /** ISO time format: HH:MM (e.g., "13:00") */
  end: string;
};

export type TermConfig = {
  label: string;
  /** ISO date format: YYYY-MM-DD */
  startDate: string;
  /** ISO date format: YYYY-MM-DD */
  endDate: string;
};

// ── Table definition ───────────────────────────────────

export const instituteConfigs = pgTable(
  'institute_configs',
  {
    id: uuid().defaultRandom().primaryKey(),
    attendanceType: attendanceType('attendance_type').default('DAILY').notNull(),
    openingTime: time('opening_time'),
    closingTime: time('closing_time'),
    shifts: jsonb().$type<ShiftConfig[]>().default([]),
    notificationPreferences: jsonb('notification_preferences')
      .$type<Record<string, unknown>>()
      .default({}),
    payrollConfig: jsonb('payroll_config').$type<Record<string, unknown>>().default({}),
    gradingSystem: jsonb('grading_system').$type<Record<string, unknown>>().default({}),
    termStructure: jsonb('term_structure').$type<TermConfig[]>().default([]),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('institute_configs_tenant_id_key')
      .on(table.tenantId)
      .where(sql`${table.deletedAt} IS NULL`),
    ...tenantPolicies('institute_configs'),
  ],
);
