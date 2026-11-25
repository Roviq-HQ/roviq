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
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';
import { resellers } from '../reseller/resellers';
import { institutes } from '../tenant/institutes';
import { messagingSenders } from './messaging-senders';
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
    /** The delivery flow (workflow id) the attempt belongs to; a delivery report is signalled to it. */
    flowId: text('flow_id'),
    /** The WhatsApp sender the attempt went through; NULL on other channels and on skips before one is chosen. */
    senderId: uuid('sender_id').references(() => messagingSenders.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    /** The provider's price class of the template sent (a `MessageTemplateCategory`); usage is counted by it. */
    templateCategory: text('template_category'),
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
    // Counts a sender's accepted messages in the last day (the daily cap).
    index('notification_deliveries_sender_sent_idx')
      .using('btree', table.senderId.asc().nullsLast(), table.createdAt.desc().nullsLast())
      .where(sql`sender_id IS NOT NULL AND status = 'SENT'`),
    index('notification_deliveries_provider_message_id_idx')
      .using('btree', table.providerMessageId.asc().nullsLast())
      .where(sql`provider_message_id IS NOT NULL`),
    // Rows are appended in time order: the platform's 24-hour counts and the skip gauge read
    // the latest rows without scanning the whole table.
    index('notification_deliveries_created_at_idx').using('brin', table.createdAt),

    pgPolicy('notification_deliveries_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    // Stated, not implied: a reseller reads no delivery row (its SELECT grant is revoked too).
    pgPolicy('notification_deliveries_reseller_none', {
      for: 'select',
      to: roviqReseller,
      using: sql`false`,
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
