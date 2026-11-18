import { sql } from 'drizzle-orm';
import { check, index, inet, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { users } from './users';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    tenantId: uuid('tenant_id'), // nullable for platform admin tokens
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    // References platform_memberships, reseller_memberships, or memberships depending on scope
    // No FK constraint — scope-polymorphic reference
    membershipId: uuid('membership_id').notNull(),
    membershipScope: varchar('membership_scope', { length: 20 }).notNull(),
    tokenHash: text('token_hash').notNull(),
    deviceInfo: text('device_info'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Why the row was revoked. Populated alongside `revokedAt`:
     *  - `rotation`        — replaced by a successor during the refresh flow
     *                        (successor is issued, this row is marked done).
     *                        Reusing a `rotation`-revoked token is the
     *                        canonical "refresh token reuse" signal: we
     *                        cascade-revoke every other token for the user.
     *  - `user_initiated`  — revoked via `revokeAllOtherSessions` or an
     *                        explicit session-kill action. Presenting a
     *                        token revoked this way is NOT stolen-token
     *                        evidence, so the reuse-cascade must be
     *                        skipped — otherwise the user's keep-alive
     *                        session gets killed on the next API call.
     *  - `password_change` — invalidated because the user rotated their
     *                        password; same semantics as user_initiated.
     *  - `admin_revoked`   — platform/reseller admin revoked the session.
     *
     * NULL exactly while the token is live (`chk_refresh_token_revoked_reason`).
     */
    revokedReason: varchar('revoked_reason', { length: 32 }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...entityColumns,
  },
  (table) => [
    check(
      'chk_refresh_token_membership_scope',
      sql`${table.membershipScope} IN ('platform', 'reseller', 'institute')`,
    ),
    // SECURITY: a revoked token with no reason reads as token theft on its next use and
    // revokes every other session of the user (ROV-97), so the database refuses one.
    check(
      'chk_refresh_token_revoked_reason',
      sql`(${table.revokedAt} IS NULL AND ${table.revokedReason} IS NULL)
        OR (${table.revokedAt} IS NOT NULL
          AND ${table.revokedReason} IS NOT NULL
          AND ${table.revokedReason} IN ('rotation', 'user_initiated', 'password_change', 'admin_revoked'))`,
    ),
    index('refresh_tokens_tenant_id_idx').using('btree', table.tenantId.asc().nullsLast()),
    index('refresh_tokens_token_hash_idx').using('btree', table.tokenHash.asc().nullsLast()),
    ...tenantPolicies('refresh_tokens'),
  ],
);
