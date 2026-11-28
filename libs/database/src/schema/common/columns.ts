import { type AnyPgColumn, foreignKey, integer, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Multi-language text stored as `{ "en": "Science", "hi": "विज्ञान" }` */
export type I18nContent = Record<string, string>;

/** Building block for the spreads below — tables spread `entityColumns` / `tenantColumns` */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
};

/** Tables that track who created/updated — extends timestamps */
export const trackingColumns = {
  ...timestamps,
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
};

/** Full entity columns — tracking + soft delete + optimistic concurrency */
export const entityColumns = {
  ...trackingColumns,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  version: integer('version').default(1).notNull(),
};

/** Tenant-scoped business tables — most common spread */
export const tenantColumns = {
  tenantId: uuid('tenant_id').notNull(),
  ...entityColumns,
};

/**
 * Type-safe multi-language JSONB column.
 * Stored as `{ "en": "Science", "hi": "विज्ञान" }`
 */
export const i18nText = (columnName: string) => jsonb(columnName).$type<Record<string, string>>();

/**
 * A reference to a row of the same institute. The key carries `tenant_id` on both sides, so
 * PostgreSQL refuses a row that names another institute's row, whichever role writes it. The
 * referenced table needs a unique index on `(id, tenant_id)`. While the referencing column is
 * NULL the key is not checked.
 */
export const sameTenantForeignKey = (
  name: string,
  columns: [reference: AnyPgColumn, tenantId: AnyPgColumn],
  foreignColumns: [id: AnyPgColumn, tenantId: AnyPgColumn],
) => foreignKey({ name, columns, foreignColumns });

/**
 * A reference to a table whose rows may belong to no institute (`tenant_id` NULL: a system
 * role, a platform sender, a person's file). The key cannot carry `tenant_id`, so a trigger
 * holds the rule instead: the referenced row belongs to the referencing row's institute, or
 * to none. The trigger is custom SQL, in the same change as the key
 * (`pnpm check:tenant-foreign-keys` prints the statement).
 */
export const sameTenantOrNoneForeignKey = (
  name: string,
  column: AnyPgColumn,
  foreignId: AnyPgColumn,
) => foreignKey({ name, columns: [column], foreignColumns: [foreignId] });
