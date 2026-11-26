import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { roviqAdmin, roviqApp } from '../common/rls-policies';
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

    // Written by the platform only; an institute reads the branding of its own group.
    pgPolicy('institute_group_branding_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
    pgPolicy('institute_group_branding_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`group_id = (
        SELECT group_id FROM institutes
        WHERE id = current_setting('app.current_tenant_id', true)::uuid
      )`,
    }),
  ],
);
