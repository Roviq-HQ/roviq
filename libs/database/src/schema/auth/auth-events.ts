import { AUTH_FAILURE_REASON_VALUES, AUTH_SCOPE_VALUES } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';

const SCOPES = sql.raw(AUTH_SCOPE_VALUES.map((v) => `'${v}'`).join(', '));
const FAILURE_REASONS = sql.raw(AUTH_FAILURE_REASON_VALUES.map((v) => `'${v}'`).join(', '));

export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    // No foreign key: the security log must outlive the user row it names.
    userId: uuid('user_id'),
    /**
     * Membership of the session, in the table `scope` names (memberships, reseller_memberships or
     * platform_memberships), so no foreign key. Null when no session exists.
     */
    membershipId: uuid('membership_id'),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    /** Entry point the request came through. Known before, and independent of, any authentication. */
    portal: varchar({ length: 20 }),
    /** Scope of the session that was granted. Never set for an attempt that was refused. */
    scope: varchar({ length: 20 }),
    tenantId: uuid('tenant_id'),
    resellerId: uuid('reseller_id'),
    authMethod: varchar('auth_method', { length: 30 }),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    deviceInfo: text('device_info'),
    failureReason: varchar('failure_reason', { length: 40 }),
    metadata: jsonb().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('auth_events_user_id_idx').on(table.userId),
    index('auth_events_membership_id_idx').on(table.membershipId),
    index('auth_events_event_type_idx').on(table.eventType),
    index('auth_events_tenant_id_idx').on(table.tenantId),
    index('auth_events_created_at_idx').on(table.createdAt),
    check('chk_auth_events_portal', sql`${table.portal} IN (${SCOPES})`),
    check('chk_auth_events_scope', sql`${table.scope} IN (${SCOPES})`),
    check('chk_auth_events_failure_reason', sql`${table.failureReason} IN (${FAILURE_REASONS})`),
    check(
      'chk_auth_events_login_portal',
      sql`${table.eventType} NOT IN ('login_success', 'login_failed', 'account_locked') OR ${table.portal} IS NOT NULL`,
    ),
    // A session is only ever issued for the portal that was signed in to.
    check(
      'chk_auth_events_login_success_scope',
      sql`${table.eventType} <> 'login_success' OR ${table.scope} = ${table.portal}`,
    ),
    check(
      'chk_auth_events_refused_attempt',
      sql`${table.eventType} NOT IN ('login_failed', 'account_locked') OR (${table.scope} IS NULL AND ${table.tenantId} IS NULL AND ${table.resellerId} IS NULL AND ${table.failureReason} IS NOT NULL)`,
    ),
    // roviq_app and roviq_reseller: INSERT only (emit events)
    pgPolicy('auth_events_app_insert', {
      for: 'insert',
      to: roviqApp,
      withCheck: sql`true`,
    }),
    pgPolicy('auth_events_reseller_insert', {
      for: 'insert',
      to: roviqReseller,
      withCheck: sql`true`,
    }),
    // roviq_admin reads and writes but never changes a row: the table is append-only.
    pgPolicy('auth_events_admin_select', {
      for: 'select',
      to: roviqAdmin,
      using: sql`true`,
    }),
    pgPolicy('auth_events_admin_insert', {
      for: 'insert',
      to: roviqAdmin,
      withCheck: sql`true`,
    }),
  ],
);
