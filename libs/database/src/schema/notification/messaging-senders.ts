import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { messagingSenderStatus, notificationChannel } from '../common/enums';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';

/**
 * A number messages are sent from: the platform's, or one institute's own. An institute's
 * messages use its own ACTIVE sender, else the platform's. Written only by the platform role;
 * an institute may read its own row. The access token is not here: see `messaging_sender_secrets`.
 */
export const messagingSenders = pgTable(
  'messaging_senders',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    scope: varchar({ length: 20 }).notNull(),
    tenantId: uuid('tenant_id').references(() => institutes.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    channel: notificationChannel().notNull(),
    /** Adapter that sends through this number; matches `notification_deliveries.provider`. */
    provider: text().notNull(),
    /** The provider's id of the number; an inbound webhook is mapped to a sender by it. */
    providerNumberId: text('provider_number_id').notNull(),
    /**
     * The provider account the number belongs to: templates are registered per account, not per
     * number (ROV-333). Required when a sender is registered.
     */
    providerAccountId: text('provider_account_id'),
    /** The number as people see it, with country code. */
    displayNumber: text('display_number').notNull(),
    status: messagingSenderStatus().default('ACTIVE').notNull(),
    /** Messages the sender may send in any 24 hours. */
    dailyCap: integer('daily_cap').notNull(),
    /** On the platform's sender: what one institute may use of `daily_cap`. NULL means no share limit. */
    instituteDailyCap: integer('institute_daily_cap'),
    /** The most messages the sender hands the provider in one second, over every instance (ROV-330). */
    messagesPerSecond: integer('messages_per_second').default(10).notNull(),
    ...entityColumns,
  },
  (table) => [
    check(
      'chk_messaging_senders_scope',
      sql`CASE "scope"
        WHEN 'institute' THEN "tenant_id" IS NOT NULL
        WHEN 'platform'  THEN "tenant_id" IS NULL
        ELSE false
      END`,
    ),
    check(
      'chk_messaging_senders_caps',
      sql`"daily_cap" > 0 AND ("institute_daily_cap" IS NULL OR "institute_daily_cap" > 0)`,
    ),
    check('chk_messaging_senders_rate', sql`"messages_per_second" BETWEEN 1 AND 1000`),
    uniqueIndex('messaging_senders_provider_number_key')
      .using('btree', table.provider.asc().nullsLast(), table.providerNumberId.asc().nullsLast())
      .where(sql`deleted_at IS NULL`),
    uniqueIndex('messaging_senders_platform_channel_key')
      .using('btree', table.channel.asc().nullsLast())
      .where(sql`deleted_at IS NULL AND scope = 'platform'`),
    uniqueIndex('messaging_senders_tenant_channel_key')
      .using('btree', table.tenantId.asc().nullsLast(), table.channel.asc().nullsLast())
      .where(sql`deleted_at IS NULL AND scope = 'institute'`),
    index('messaging_senders_tenant_id_idx').using('btree', table.tenantId.asc().nullsLast()),

    pgPolicy('messaging_senders_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    pgPolicy('messaging_senders_reseller_none', {
      for: 'select',
      to: roviqReseller,
      using: sql`false`,
    }),
    pgPolicy('messaging_senders_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
