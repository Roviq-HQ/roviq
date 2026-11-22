import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { userStatus } from '../common/enums';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';

export const users = pgTable(
  'users',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    email: text().notNull(),
    username: text().notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    preferredLocale: text('preferred_locale'),
    status: userStatus().default('ACTIVE').notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    /** True when the user was created with a system-generated temp password and must change it before any other action. */
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    /**
     * When the user proved they read the mailbox of `email` (a code sent only there). NULL for
     * an address someone else typed: such an account is never reused for a role granted by
     * email, because whoever created it may hold its password.
     */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /**
     * Raised whenever every session of the user must end (password change, temporary password
     * reissue). Access tokens carry the value they were issued with; an older one is refused.
     */
    tokenVersion: integer('token_version').default(0).notNull(),
    ...entityColumns,
  },
  (table) => [
    check('users_preferred_locale_check', sql`${table.preferredLocale} IN ('en', 'hi')`),
    uniqueIndex('users_email_key').using('btree', table.email.asc().nullsLast()),
    uniqueIndex('users_username_key').using('btree', table.username.asc().nullsLast()),
    // All roles can SELECT users
    pgPolicy('users_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`true`,
    }),
    pgPolicy('users_reseller_select', {
      for: 'select',
      to: roviqReseller,
      using: sql`true`,
    }),
    // Only admin can INSERT/UPDATE/DELETE
    pgPolicy('users_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
