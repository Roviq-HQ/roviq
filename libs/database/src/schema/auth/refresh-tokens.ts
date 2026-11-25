import { REFRESH_TOKEN_REVOKE_REASON_VALUES } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import { check, index, inet, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { users } from './users';

const REVOKE_REASONS = sql.raw(REFRESH_TOKEN_REVOKE_REASON_VALUES.map((v) => `'${v}'`).join(', '));

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
     * Why the row was revoked: one of `REFRESH_TOKEN_REVOKE_REASON_VALUES`. Presenting a
     * `ROTATION`-revoked token again is the reuse signal that revokes every other session; the
     * other reasons are not. NULL exactly while the token is live (`chk_refresh_token_revoked_reason`).
     */
    revokedReason: varchar('revoked_reason', { length: 32 }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...entityColumns,
  },
  (table) => [
    // auth scope: lowercase by exception (ROV-227)
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
          AND ${table.revokedReason} IN (${REVOKE_REASONS}))`,
    ),
    index('refresh_tokens_tenant_id_idx').using('btree', table.tenantId.asc().nullsLast()),
    index('refresh_tokens_token_hash_idx').using('btree', table.tokenHash.asc().nullsLast()),
    ...tenantPolicies('refresh_tokens'),
  ],
);
