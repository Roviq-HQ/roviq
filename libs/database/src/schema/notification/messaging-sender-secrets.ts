import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, uuid } from 'drizzle-orm/pg-core';
import { trackingColumns } from '../common/columns';
import { roviqAdmin } from '../common/rls-policies';
import { encryptedBytea } from '../user-profiles/user-identifiers';
import { messagingSenders } from './messaging-senders';

/**
 * The provider access token of a sender, encrypted by the application. Platform role only:
 * request roles hold no right on this table at all, and no API returns the value.
 */
export const messagingSenderSecrets = pgTable(
  'messaging_sender_secrets',
  {
    senderId: uuid('sender_id')
      .primaryKey()
      .references(() => messagingSenders.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    accessTokenEncrypted: encryptedBytea('access_token_encrypted').notNull(),
    ...trackingColumns,
  },
  () => [
    pgPolicy('messaging_sender_secrets_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
