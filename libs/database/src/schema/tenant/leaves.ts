import { sql } from 'drizzle-orm';
import { date, foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { leaveStatus, leaveType } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from './institutes';
import { memberships } from './memberships';

/**
 * Lightweight leave application for staff and students.
 *
 * The attendance module consults this table at session-open time: when a
 * student has an APPROVED leave covering that date, their roster entry is
 * seeded with status=LEAVE instead of PRESENT.
 */
export const leaves = pgTable(
  'leaves',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    /** Membership the leave is for — student or staff. */
    userId: uuid('user_id').notNull(),
    /** Inclusive start date (YYYY-MM-DD). */
    startDate: date('start_date').notNull(),
    /** Inclusive end date (YYYY-MM-DD). Single-day leaves set startDate = endDate. */
    endDate: date('end_date').notNull(),
    type: leaveType('type').notNull(),
    reason: text('reason').notNull(),
    status: leaveStatus('status').default('PENDING').notNull(),
    /** Membership who approved / rejected. Null until a decision is taken. */
    // Same-institute key with ON DELETE SET NULL (decided_by): custom SQL, Drizzle cannot declare it.
    decidedBy: uuid('decided_by'),
    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('leaves_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'leaves_user_id_tenant_fkey',
      [table.userId, table.tenantId],
      [memberships.id, memberships.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('leaves_tenant_id_idx').on(table.tenantId),
    index('leaves_user_id_idx').on(table.userId),
    index('leaves_status_idx').on(table.status),
    // Typical lookup: "does this user have an approved leave covering date X?"
    index('leaves_user_range_idx').on(table.userId, table.startDate, table.endDate),
    ...tenantPolicies('leaves'),
  ],
);
