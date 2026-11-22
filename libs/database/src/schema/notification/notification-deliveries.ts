import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { notificationChannel, notificationDeliveryStatus } from '../common/enums';
import { roviqAdmin, roviqApp } from '../common/rls-policies';
import { resellers } from '../reseller/resellers';
import { institutes } from '../tenant/institutes';
import { notifications } from './notifications';

/**
 * Append-only log: one row per attempt on a channel outside the app, written when the
 * attempt ends. A later provider receipt is a new `DELIVERED` row with the same
 * `provider_message_id`. No role may update or delete a row. The recipient's address is
 * not stored; `recipient_user_id` points to it.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    scope: varchar({ length: 20 }).notNull(),
    tenantId: uuid('tenant_id').references(() => institutes.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    resellerId: uuid('reseller_id').references(() => resellers.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    /** NULL for a message with no in-app copy (a verification code, a welcome message). */
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    type: text().notNull(),
    channel: notificationChannel().notNull(),
    /** Adapter that handled the attempt; NULL when it was skipped before reaching one. */
    provider: text(),
    status: notificationDeliveryStatus().notNull(),
    skipReason: text('skip_reason'),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    attempt: integer().default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'chk_notification_deliveries_scope',
      sql`CASE "scope"
        WHEN 'institute' THEN "tenant_id" IS NOT NULL AND "reseller_id" IS NULL
        WHEN 'reseller'  THEN "reseller_id" IS NOT NULL AND "tenant_id" IS NULL
        WHEN 'platform'  THEN "tenant_id" IS NULL AND "reseller_id" IS NULL
        ELSE false
      END`,
    ),
    check(
      'chk_notification_deliveries_outcome',
      sql`("status" <> 'SKIPPED' OR "skip_reason" IS NOT NULL)
        AND ("status" <> 'FAILED' OR "error_code" IS NOT NULL)`,
    ),
    check('chk_notification_deliveries_attempt', sql`"attempt" >= 1`),
    index('notification_deliveries_tenant_id_idx').using(
      'btree',
      table.tenantId.asc().nullsLast(),
      table.id.desc().nullsLast(),
    ),
    index('notification_deliveries_notification_id_idx').using(
      'btree',
      table.notificationId.asc().nullsLast(),
    ),
    index('notification_deliveries_provider_message_id_idx')
      .using('btree', table.providerMessageId.asc().nullsLast())
      .where(sql`provider_message_id IS NOT NULL`),

    pgPolicy('notification_deliveries_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    pgPolicy('notification_deliveries_admin_select', {
      for: 'select',
      to: roviqAdmin,
      using: sql`true`,
    }),
    pgPolicy('notification_deliveries_admin_insert', {
      for: 'insert',
      to: roviqAdmin,
      withCheck: sql`true`,
    }),
  ],
);
