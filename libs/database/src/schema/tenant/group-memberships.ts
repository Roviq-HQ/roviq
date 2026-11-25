import { sql } from 'drizzle-orm';
import { boolean, pgPolicy, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { entityColumns } from '../common/columns';
import { roviqAdmin } from '../common/rls-policies';
import { instituteGroups } from './institute-groups';
import { roles } from './roles';

export const groupMemberships = pgTable(
  'group_memberships',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => instituteGroups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    isActive: boolean('is_active').default(true).notNull(),
    ...entityColumns,
  },
  (table) => [
    uniqueIndex('group_memberships_user_group_key')
      .on(table.userId, table.groupId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Groups are managed by platform admins only — no roviq_app or roviq_reseller policy
    pgPolicy('group_memberships_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
