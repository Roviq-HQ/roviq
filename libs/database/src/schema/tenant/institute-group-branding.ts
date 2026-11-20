import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { entityPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { instituteGroups } from './institute-groups';

export const instituteGroupBranding = pgTable(
  'institute_group_branding',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => instituteGroups.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Same purposes as an institute's own branding: INSTITUTE_LOGO and INSTITUTE_FAVICON. */
    logoFileId: uuid('logo_file_id').references(() => files.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    faviconFileId: uuid('favicon_file_id').references(() => files.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    primaryColor: text('primary_color'),
    secondaryColor: text('secondary_color'),
    theme: text(),
    ...entityColumns,
  },
  (table) => [
    uniqueIndex('institute_group_branding_group_id_key').on(table.groupId),
    ...entityPolicies('institute_group_branding'),
  ],
);
