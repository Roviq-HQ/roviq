import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';
import { users } from './users';

export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    impersonatorId: uuid('impersonator_id')
      .notNull()
      .references(() => users.id),
    impersonatorScope: varchar('impersonator_scope', { length: 20 }).notNull(),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id),
    targetTenantId: uuid('target_tenant_id').references(() => institutes.id),
    reason: text().notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedReason: varchar('ended_reason', { length: 50 }),
    otpVerified: timestamp('otp_verified', { withTimezone: true }),
    otpVerifiedBy: uuid('otp_verified_by').references(() => users.id),
  },
  (table) => [
    check(
      'chk_impersonator_scope',
      sql`${table.impersonatorScope} IN ('platform', 'reseller', 'institute')`,
    ),
    // Reason must be at least 10 characters
    check('chk_reason_length', sql`length(${table.reason}) >= 10`),
    // Session max 1 hour
    check('chk_max_duration', sql`${table.expiresAt} <= ${table.startedAt} + interval '1 hour'`),
    index('impersonation_sessions_impersonator_idx').on(table.impersonatorId),
    index('impersonation_sessions_target_user_idx').on(table.targetUserId),
    index('impersonation_sessions_target_tenant_idx').on(table.targetTenantId),
    // SECURITY: sessions are written only as roviq_admin (ImpersonationService). The other
    // roles read the sessions on their own institutes and can change nothing, so tenant or
    // reseller code cannot forge, reopen or read another tenant's session (ROV-102).
    pgPolicy('impersonation_sessions_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`target_tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    pgPolicy('impersonation_sessions_reseller_select', {
      for: 'select',
      to: roviqReseller,
      using: sql`target_tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      )`,
    }),
    // roviq_admin: full access
    pgPolicy('impersonation_sessions_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
