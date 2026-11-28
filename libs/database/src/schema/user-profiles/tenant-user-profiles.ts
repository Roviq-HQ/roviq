import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  foreignKey,
  index,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { i18nText, sameTenantOrNoneForeignKey, tenantColumns } from '../common/columns';
import { gender } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { institutes } from '../tenant/institutes';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * What one institute records about one person: the name, demographics and picture in its
 * admission register. One row per institute and user, whatever roles the person holds there.
 * Another institute of the same person has its own row and cannot read or change this one.
 */
export const tenantUserProfiles = pgTable(
  'tenant_user_profiles',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    firstName: i18nText('first_name').notNull(),
    lastName: i18nText('last_name'),
    gender: gender('gender'),
    dateOfBirth: date('date_of_birth'),
    bloodGroup: varchar('blood_group', { length: 5 }),
    nationality: varchar('nationality', { length: 50 }).default('Indian'),
    religion: varchar('religion', { length: 30 }),
    motherTongue: varchar('mother_tongue', { length: 50 }),

    /** The picture this institute holds of the person (`files`, purpose PROFILE_PHOTO). */
    profileImageFileId: uuid('profile_image_file_id'),

    // Same expression as user_profiles.search_vector; needs i18n_text_to_string().
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(i18n_text_to_string(first_name), '')), 'A') || setweight(to_tsvector('simple', coalesce(i18n_text_to_string(last_name), '')), 'B')`,
    ),

    ...tenantColumns,
  },
  (table) => [
    sameTenantOrNoneForeignKey(
      'tenant_user_profiles_profile_image_file_id_tenant_or_none_fkey',
      table.profileImageFileId,
      files.id,
    )
      .onDelete('set null')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    check(
      'chk_tenant_user_profiles_blood_group',
      sql`${table.bloodGroup} IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')`,
    ),
    uniqueIndex('tenant_user_profiles_tenant_user_key')
      .on(table.tenantId, table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_tenant_user_profiles_user_id').on(table.userId),
    // The file sweeper asks whether any profile still uses a file.
    index('idx_tenant_user_profiles_profile_image_file')
      .on(table.profileImageFileId)
      .where(sql`profile_image_file_id IS NOT NULL`),
    index('idx_tenant_user_profiles_search').using('gin', sql`search_vector`),
    ...tenantPolicies('tenant_user_profiles'),
  ],
);
