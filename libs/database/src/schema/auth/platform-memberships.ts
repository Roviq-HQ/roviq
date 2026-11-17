import type { AbilityRule } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgPolicy, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { roviqAdmin } from '../common/rls-policies';
import { roles } from '../tenant/roles';
import { users } from './users';

export const platformMemberships = pgTable(
  'platform_memberships',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    abilities: jsonb().$type<AbilityRule[]>().default([]),
    isActive: boolean('is_active').default(true).notNull(),
    ...entityColumns,
  },
  (table) => [
    uniqueIndex('uq_platform_membership_user')
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Only admin can access platform memberships — default deny for roviq_app and roviq_reseller
    pgPolicy('platform_membership_admin', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
