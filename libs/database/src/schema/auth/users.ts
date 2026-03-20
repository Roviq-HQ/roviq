import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from '../common/columns';
import { userStatus } from '../common/enums';

export const users = pgTable(
  'users',
  {
    id: uuid().defaultRandom().primaryKey(),
    email: text().notNull(),
    username: text().notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    status: userStatus().default('ACTIVE').notNull(),
    isPlatformAdmin: boolean('is_platform_admin').default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_key').using('btree', table.email.asc().nullsLast()),
    uniqueIndex('users_username_key').using('btree', table.username.asc().nullsLast()),
  ],
);
