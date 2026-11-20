import { sql } from 'drizzle-orm';
import { foreignKey, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { institutes } from './institutes';

export const instituteBranding = pgTable(
  'institute_branding',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    /** Public images (purposes INSTITUTE_LOGO, INSTITUTE_FAVICON, INSTITUTE_COVER). */
    logoFileId: uuid('logo_file_id').references(() => files.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    faviconFileId: uuid('favicon_file_id').references(() => files.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    coverImageFileId: uuid('cover_image_file_id').references(() => files.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    primaryColor: text('primary_color'),
    secondaryColor: text('secondary_color'),
    themeIdentifier: text('theme_identifier'),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('institute_branding_tenant_id_key')
      .on(table.tenantId)
      .where(sql`${table.deletedAt} IS NULL`),
    ...tenantPolicies('institute_branding'),
  ],
);
