import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { tenantColumns } from '../common/columns';
import { complianceReportType, exportReportStatus } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { academicYears } from './academic-years';
import { institutes } from './institutes';

/** One requested compliance export of an institute, with its progress and its file. */
export const exportReports = pgTable(
  'export_reports',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    reportType: complianceReportType('report_type').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    status: exportReportStatus().default('PENDING').notNull(),
    /** Temporal workflow id; also keeps a retried request from starting a second run. */
    workflowId: text('workflow_id').notNull(),
    fileId: uuid('file_id').references(() => files.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    rowCount: integer('row_count'),
    /** An `ErrorCode` value, never free text: it is shown to the requester. */
    errorCode: text('error_code'),
    /** Platform admin or institute user who asked for the export. */
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    // The year must belong to the same institute as the export.
    foreignKey({
      columns: [table.academicYearId, table.tenantId],
      foreignColumns: [academicYears.id, academicYears.tenantId],
      name: 'export_reports_academic_year_tenant_fkey',
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    index('export_reports_tenant_requested_idx').on(table.tenantId, table.requestedAt.desc()),
    index('export_reports_academic_year_id_idx').on(table.academicYearId),
    // Unfiltered: the file sweeper and the foreign-key check on deleting a file look up rows of any state.
    index('export_reports_file_id_idx').on(table.fileId).where(sql`file_id IS NOT NULL`),
    uniqueIndex('export_reports_workflow_id_key').on(table.workflowId),
    check(
      'chk_export_reports_completed',
      sql`${table.status} <> 'COMPLETED' OR (${table.fileId} IS NOT NULL AND ${table.rowCount} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
    check(
      'chk_export_reports_failed',
      sql`${table.status} <> 'FAILED' OR (${table.errorCode} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
    check(
      'chk_export_reports_file_only_when_completed',
      sql`${table.fileId} IS NULL OR ${table.status} = 'COMPLETED'`,
    ),
    ...tenantPolicies('export_reports'),
  ],
);
