import { sql } from 'drizzle-orm';
import { foreignKey, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sameTenantOrNoneForeignKey, tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { institutes } from './institutes';

export const instituteBranding = pgTable(
  'institute_branding',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    /** Public images (purposes INSTITUTE_LOGO, INSTITUTE_FAVICON, INSTITUTE_COVER). */
    logoFileId: uuid('logo_file_id'),
    faviconFileId: uuid('favicon_file_id'),
    coverImageFileId: uuid('cover_image_file_id'),
    primaryColor: text('primary_color'),
    secondaryColor: text('secondary_color'),
    themeIdentifier: text('theme_identifier'),
    ...tenantColumns,
  },
  (table) => [
    sameTenantOrNoneForeignKey(
      'institute_branding_cover_image_file_id_tenant_or_none_fkey',
      table.coverImageFileId,
      files.id,
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantOrNoneForeignKey(
      'institute_branding_favicon_file_id_tenant_or_none_fkey',
      table.faviconFileId,
      files.id,
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantOrNoneForeignKey(
      'institute_branding_logo_file_id_tenant_or_none_fkey',
      table.logoFileId,
      files.id,
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
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
