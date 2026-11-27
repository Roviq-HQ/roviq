import { sql } from 'drizzle-orm';
import { index, jsonb, pgPolicy, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { roviqAdmin, selfPolicies } from '../common/rls-policies';
import { users } from './users';

export const authProviders = pgTable(
  'auth_providers',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    provider: text().notNull(),
    providerUserId: text('provider_user_id'),
    providerData: jsonb('provider_data'),
    ...entityColumns,
  },
  (table) => [
    uniqueIndex('auth_providers_provider_provider_user_id_key')
      .using('btree', table.provider.asc().nullsLast(), table.providerUserId.asc().nullsLast())
      .where(sql`${table.deletedAt} IS NULL`),
    index('auth_providers_user_id_idx').using('btree', table.userId.asc().nullsLast()),
    // Passkeys and sign-in providers are read and written only by the platform role.
    // A signed-in person lists, adds and removes their own passkeys.
    ...selfPolicies('auth_providers', 'user_id', ['select', 'insert', 'update']),
    pgPolicy('auth_providers_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
