import { sql } from 'drizzle-orm';
import {
  date,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { roviqAdmin } from '../common/rls-policies';
import { messagingSenders } from './messaging-senders';

/**
 * One row per provider webhook event that was acted on, so a repeated event does nothing.
 * Holds who the event was about and what kind it was, never the text of a message.
 * Append-only and platform role only.
 */
export const messagingInboundEvents = pgTable(
  'messaging_inbound_events',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => messagingSenders.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** The provider's id of the event; for a delivery report, the message id and the status. */
    providerEventId: text('provider_event_id').notNull(),
    /** `receipt` (a delivery report), `opt_out` (a stop request) or `message` (anything else). */
    kind: text().notNull(),
    recipientPhone: text('recipient_phone'),
    providerUserId: text('provider_user_id'),
    /** Set on the one inbound message of a person and day that got the automatic reply. */
    autoReplyDay: date('auto_reply_day'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('messaging_inbound_events_event_key').using(
      'btree',
      table.senderId.asc().nullsLast(),
      table.providerEventId.asc().nullsLast(),
    ),
    uniqueIndex('messaging_inbound_events_auto_reply_key')
      .using(
        'btree',
        table.senderId.asc().nullsLast(),
        sql`COALESCE(${table.recipientPhone}, ${table.providerUserId})`,
        table.autoReplyDay.asc().nullsLast(),
      )
      .where(sql`auto_reply_day IS NOT NULL`),
    index('messaging_inbound_events_sender_user_idx')
      .using('btree', table.senderId.asc().nullsLast(), table.providerUserId.asc().nullsLast())
      .where(sql`provider_user_id IS NOT NULL AND recipient_phone IS NOT NULL`),
    pgPolicy('messaging_inbound_events_admin_select', {
      for: 'select',
      to: roviqAdmin,
      using: sql`true`,
    }),
    pgPolicy('messaging_inbound_events_admin_insert', {
      for: 'insert',
      to: roviqAdmin,
      withCheck: sql`true`,
    }),
  ],
);
