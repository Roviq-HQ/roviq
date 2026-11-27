import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';

export const roviqApp = pgRole('roviq_app').existing();
export const roviqReseller = pgRole('roviq_reseller').existing();
export const roviqAdmin = pgRole('roviq_admin').existing();
/** A signed-in person acting on their own account rows (`withUser`). */
export const roviqUser = pgRole('roviq_user').existing();
/** Login role of the audit and dead-letter consumers: INSERT into those two tables only. */
export const roviqAuditWriter = pgRole('roviq_audit_writer').existing();

/**
 * RLS owns **tenant isolation only**. Soft-delete visibility is enforced in
 * the application layer (repositories add `isNull(table.deletedAt)` to reads;
 * `withTrash`/`include_deleted` no longer exist). This keeps soft-delete
 * grep-able, behaves identically across DB roles, and removes the
 * "post-update row invisible to RLS" footgun previously needed during
 * `softDelete()`.
 */

/** Reseller read policy for tenant-scoped tables — sees rows belonging to their institutes */
const resellerTenantRead = (tableName: string) =>
  pgPolicy(`${tableName}_reseller_read`, {
    for: 'select',
    to: roviqReseller,
    using: sql`tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    )`,
  });

/** The signed-in person; NULL, so no row, when `withUser` did not set one. */
export const currentUserId = sql`NULLIF(current_setting('app.current_user_id', true), '')::uuid`;

type SelfCommand = 'select' | 'insert' | 'update';

/**
 * Own-row policies of `roviq_user` on a table keyed by a person: one policy per command
 * listed. The privileges themselves are column grants in custom SQL.
 */
export const selfPolicies = (
  tableName: string,
  column: string,
  commands: readonly SelfCommand[],
) => {
  const own = sql`${sql.identifier(column)} = ${currentUserId}`;
  return commands.map((command) =>
    pgPolicy(`${tableName}_self_${command}`, {
      for: command,
      to: roviqUser,
      ...(command === 'insert' ? { withCheck: own } : { using: own }),
      ...(command === 'update' ? { withCheck: own } : {}),
    }),
  );
};

/** RLS policies for tenant-scoped tables (have `tenant_id`; soft-delete handled in app layer) */
export const tenantPolicies = (tableName: string) => [
  pgPolicy(`${tableName}_app_select`, {
    for: 'select',
    to: roviqApp,
    using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
  }),
  pgPolicy(`${tableName}_app_insert`, {
    for: 'insert',
    to: roviqApp,
    withCheck: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
  }),
  pgPolicy(`${tableName}_app_update`, {
    for: 'update',
    to: roviqApp,
    using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    withCheck: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
  }),
  pgPolicy(`${tableName}_app_delete`, {
    for: 'delete',
    to: roviqApp,
    using: sql`false`,
  }),
  resellerTenantRead(tableName),
  pgPolicy(`${tableName}_admin_all`, {
    for: 'all',
    to: roviqAdmin,
    using: sql`true`,
    withCheck: sql`true`,
  }),
];

/**
 * RLS policies for personal-data tables keyed by `user_id` with no `tenant_id`.
 * A row is readable only where its user holds a membership that is not deleted; writes are
 * admin-only because one user's row is shared by every institute they belong to.
 */
export const userScopedPolicies = (tableName: string) => [
  pgPolicy(`${tableName}_app_select`, {
    for: 'select',
    to: roviqApp,
    using: sql`user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    )`,
  }),
  pgPolicy(`${tableName}_reseller_read`, {
    for: 'select',
    to: roviqReseller,
    using: sql`user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    )`,
  }),
  pgPolicy(`${tableName}_admin_all`, {
    for: 'all',
    to: roviqAdmin,
    using: sql`true`,
    withCheck: sql`true`,
  }),
];

/** A file that belongs to a person, not to an institute or reseller (a profile picture). */
const userLevelFile = sql`tenant_id IS NULL AND reseller_id IS NULL`;
/** The person a user-level file is about is a current member of the current institute. */
const subjectInCurrentTenant = sql`subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    AND m.deleted_at IS NULL
)`;
const ownTenantFile = sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`;
const appFileAccess = sql`${ownTenantFile} OR (${userLevelFile} AND ${subjectInCurrentTenant})`;

/** A file the current reseller owns itself (its branding), not one of its institutes' files. */
const ownResellerFile = sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid
  AND tenant_id IS NULL`;

/**
 * RLS policies for `files`. A row belongs to an institute (`tenant_id`), a reseller
 * (`reseller_id`) or a person (neither set, `subject_user_id` only). An institute reads and
 * writes its own files and the user-level files of its members. A reseller reads its own and
 * its institutes' files, and writes only its own (its branding).
 */
export const filePolicies = (tableName: string) => [
  pgPolicy(`${tableName}_app_select`, { for: 'select', to: roviqApp, using: appFileAccess }),
  pgPolicy(`${tableName}_app_insert`, { for: 'insert', to: roviqApp, withCheck: appFileAccess }),
  pgPolicy(`${tableName}_app_update`, {
    for: 'update',
    to: roviqApp,
    using: appFileAccess,
    withCheck: appFileAccess,
  }),
  pgPolicy(`${tableName}_app_delete`, {
    for: 'delete',
    to: roviqApp,
    using: sql`false`,
  }),
  pgPolicy(`${tableName}_reseller_select`, {
    for: 'select',
    to: roviqReseller,
    using: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid
      OR tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      )
      OR (${userLevelFile} AND (
        subject_user_id IN (
          SELECT m.user_id FROM memberships m
          JOIN institutes i ON i.id = m.tenant_id
          WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
            AND m.deleted_at IS NULL
        )
        OR subject_user_id IN (
          SELECT rm.user_id FROM reseller_memberships rm
          WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        )
      ))`,
  }),
  pgPolicy(`${tableName}_reseller_insert`, {
    for: 'insert',
    to: roviqReseller,
    withCheck: ownResellerFile,
  }),
  pgPolicy(`${tableName}_reseller_update`, {
    for: 'update',
    to: roviqReseller,
    using: ownResellerFile,
    withCheck: ownResellerFile,
  }),
  pgPolicy(`${tableName}_admin_all`, {
    for: 'all',
    to: roviqAdmin,
    using: sql`true`,
    withCheck: sql`true`,
  }),
];
