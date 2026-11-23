import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { notificationChannel } from '../common/enums';
import { roviqAdmin } from '../common/rls-policies';
import { messagingSenders } from './messaging-senders';

/**
 * A person asked a sender to stop. Append-only and platform role only: no role updates or
 * deletes a row, and request roles hold no right on the table. The inbound event can arrive
 * without a phone number, so the provider's user id is kept beside it.
 */
export const messagingOptOuts = pgTable(
  'messaging_opt_outs',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => messagingSenders.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    channel: notificationChannel().notNull(),
    /** With country code, e.g. '+919876543210'. */
    recipientPhone: text('recipient_phone'),
    providerUserId: text('provider_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'chk_messaging_opt_outs_recipient',
      sql`"recipient_phone" IS NOT NULL OR "provider_user_id" IS NOT NULL`,
    ),
    index('messaging_opt_outs_sender_phone_idx')
      .using('btree', table.senderId.asc().nullsLast(), table.recipientPhone.asc().nullsLast())
      .where(sql`recipient_phone IS NOT NULL`),
    index('messaging_opt_outs_sender_user_idx')
      .using('btree', table.senderId.asc().nullsLast(), table.providerUserId.asc().nullsLast())
      .where(sql`provider_user_id IS NOT NULL`),
    pgPolicy('messaging_opt_outs_admin_select', {
      for: 'select',
      to: roviqAdmin,
      using: sql`true`,
    }),
    pgPolicy('messaging_opt_outs_admin_insert', {
      for: 'insert',
      to: roviqAdmin,
      withCheck: sql`true`,
    }),
  ],
);
