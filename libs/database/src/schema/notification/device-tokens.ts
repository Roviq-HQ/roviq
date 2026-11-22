import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { entityColumns } from '../common/columns';
import { devicePlatform } from '../common/enums';
import { roviqAdmin } from '../common/rls-policies';

/**
 * Push tokens of a user's devices. Platform-role only: a token registered for the wrong
 * user would deliver that user's push messages to someone else's device, so request
 * roles get no policy and no table rights. Callers key every write by the token's user id.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    token: text().notNull(),
    platform: devicePlatform().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    ...entityColumns,
  },
  (table) => [
    uniqueIndex('device_tokens_token_key')
      .using('btree', table.token.asc().nullsLast())
      .where(sql`deleted_at IS NULL`),
    index('device_tokens_user_id_idx').using('btree', table.userId.asc().nullsLast()),
    pgPolicy('device_tokens_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
