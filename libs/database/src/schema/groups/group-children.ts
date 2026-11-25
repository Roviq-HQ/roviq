import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';
import { groups } from './groups';

/**
 * Composite group parent-child relationships.
 *
 * Allows a composite group to combine multiple child groups. Members of
 * child groups are inherited into the parent group during resolution.
 * CHECK constraint prevents self-referencing (parent != child).
 *
 * Three-tier RLS enforced.
 */
export const groupChildren = pgTable(
  'group_children',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    parentGroupId: uuid('parent_group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    childGroupId: uuid('child_group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ...tenantColumns,
  },
  (table) => [
    uniqueIndex('uq_group_child')
      .on(table.parentGroupId, table.childGroupId)
      .where(sql`${table.deletedAt} IS NULL`),

    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Prevent a group from being its own child */
    check('chk_no_self_ref', sql`${table.parentGroupId} != ${table.childGroupId}`),

    index('idx_group_children_tenant').on(table.tenantId),

    ...tenantPolicies('group_children'),
  ],
);
