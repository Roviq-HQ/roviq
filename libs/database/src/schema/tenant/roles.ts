import type { AbilityRule } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { entityColumns, i18nText } from '../common/columns';
import { roleStatus } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { resellers } from '../reseller/resellers';
import { institutes } from './institutes';

export const roles = pgTable(
  'roles',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    // Nullable for platform/reseller scoped roles
    tenantId: uuid('tenant_id'),
    scope: varchar({ length: 20 }).default('institute').notNull(),
    resellerId: uuid('reseller_id').references(() => resellers.id),
    name: i18nText('name').notNull(),
    /**
     * CASL ability rules attached to this role. Typed via `$type<AbilityRule[]>`
     * so service-layer inserts (e.g. `seedDefaultRoles`) don't need an
     * `abilities as unknown[]` escape hatch (CR-004).
     */
    abilities: jsonb().$type<AbilityRule[]>().default([]).notNull(),
    /**
     * Symbolic NavSlug list (max 4) promoted to the phone bottom tab bar for
     * users assigned to this role. Empty → frontend falls back to per-portal
     * defaultSlugs. See @roviq/common-types NAV_SLUGS.
     */
    primaryNavSlugs: jsonb('primary_nav_slugs').$type<string[]>().default([]).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    isSystem: boolean('is_system').default(false).notNull(),
    status: roleStatus().default('ACTIVE').notNull(),
    ...entityColumns,
  },
  (table) => [
    index('idx_roles_name_gin').using('gin', table.name),
    index('idx_roles_name_trgm').using('gin', sql`i18n_text_to_string(${table.name}) gin_trgm_ops`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    // ELSE FALSE: a CASE with no match yields NULL, which a CHECK accepts
    check(
      'chk_role_scope',
      sql`CASE ${table.scope}
        WHEN 'platform'  THEN ${table.tenantId} IS NULL AND ${table.resellerId} IS NULL
        WHEN 'reseller'  THEN ${table.tenantId} IS NULL AND ${table.resellerId} IS NOT NULL
        WHEN 'institute' THEN ${table.tenantId} IS NOT NULL AND ${table.resellerId} IS NULL
        ELSE FALSE
      END`,
    ),
    uniqueIndex('roles_tenant_id_name_key').using(
      'btree',
      table.tenantId.asc().nullsLast(),
      table.name.asc().nullsLast(),
    ),
    // roles_tenant_id_name_key cannot cover these: tenant_id is NULL and NULLs are distinct
    uniqueIndex('roles_platform_name_key')
      .on(table.name)
      .where(sql`${table.scope} = 'platform' AND ${table.deletedAt} IS NULL`),
    uniqueIndex('roles_reseller_id_name_key')
      .on(table.resellerId, table.name)
      .where(sql`${table.scope} = 'reseller' AND ${table.deletedAt} IS NULL`),
    index('roles_tenant_id_idx').using('btree', table.tenantId.asc().nullsLast()),
    index('roles_scope_idx').on(table.scope),
    index('roles_reseller_id_idx').on(table.resellerId),
    ...tenantPolicies('roles'),
  ],
);
