import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, sameTenantOrNoneForeignKey, tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { institutes } from './institutes';
import { leaves } from './leaves';

/** Supporting documents attached to a leave application. */
export const leaveFiles = pgTable(
  'leave_files',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    leaveId: uuid('leave_id').notNull(),
    fileId: uuid('file_id').notNull(),
    ...tenantColumns,
  },
  (table) => [
    sameTenantOrNoneForeignKey('leave_files_file_id_tenant_or_none_fkey', table.fileId, files.id)
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'leave_files_leave_id_tenant_fkey',
      [table.leaveId, table.tenantId],
      [leaves.id, leaves.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('leave_files_tenant_id_idx').on(table.tenantId),
    index('leave_files_leave_id_idx').on(table.leaveId),
    // Unfiltered: the file sweeper and the foreign-key check on deleting a file look up rows of any state.
    index('leave_files_file_id_idx').on(table.fileId),
    // A file belongs to one record only.
    uniqueIndex('leave_files_file_id_key').on(table.fileId).where(sql`deleted_at IS NULL`),
    ...tenantPolicies('leave_files'),
  ],
);
