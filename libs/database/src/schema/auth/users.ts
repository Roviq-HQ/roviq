import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { formHelpMode, userStatus } from '../common/enums';
import { roviqAdmin, roviqApp, roviqReseller, selfPolicies } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';

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
    /** How much field help forms show this account. Read only by its owner; not on users_live. */
    formHelpMode: formHelpMode('form_help_mode').default('ICON_AND_HINT').notNull(),
    /**
     * The institute whose staff created this account; NULL when the platform or a reseller did.
     * Fixed at insert (trigger `users_keep_origin_tenant`). The institute role may add a
     * membership only for an account it created (trigger `memberships_guard_user`). Granted to
     * no institute or reseller role and not on users_live.
     */
    originTenantId: uuid('origin_tenant_id').references((): AnyPgColumn => institutes.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    ...entityColumns,
  },
  (table) => [
    check('users_preferred_locale_check', sql`${table.preferredLocale} IN ('en', 'hi')`),
    uniqueIndex('users_email_key').using('btree', table.email.asc().nullsLast()),
    uniqueIndex('users_username_key').using('btree', table.username.asc().nullsLast()),
    // An institute reads its current members; a reseller reads its institutes' current members
    // and its team. A deleted membership gives no access.
    // password_hash and token_version are not granted to either role (column grants, ROV-279).
    pgPolicy('users_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`id IN (
        SELECT m.user_id FROM memberships m
        WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND m.deleted_at IS NULL
      )`,
    }),
    pgPolicy('users_reseller_select', {
      for: 'select',
      to: roviqReseller,
      using: sql`id IN (
        SELECT m.user_id FROM memberships m
        JOIN institutes i ON i.id = m.tenant_id
        WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
          AND m.deleted_at IS NULL
      ) OR id IN (
        SELECT rm.user_id FROM reseller_memberships rm
        WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
      )`,
    }),
    // A signed-in person reads and updates their own row; column grants limit the update.
    ...selfPolicies('users', 'id', ['select', 'update']),
    // Only admin can INSERT/DELETE
    pgPolicy('users_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
