import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';
import { gradingSchemes } from './grading-schemes';

/**
 * A configurable co-scholastic domain (e.g. Work Education, Art, Health & PE,
 * Discipline) graded on a CO_SCHOLASTIC {@link gradingSchemes} scale. Per-student
 * grades per term live in `co_scholastic_assessments`.
 */
export const coScholasticAreas = pgTable(
  'co_scholastic_areas',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    name: i18nText('name').notNull(),
    // Same-institute key with ON DELETE SET NULL (grading_scheme_id): custom SQL, Drizzle cannot declare it.
    gradingSchemeId: uuid('grading_scheme_id'),
    sequence: integer().default(0).notNull(),
    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('co_scholastic_areas_id_tenant_key').on(table.id, table.tenantId),
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('co_scholastic_areas_name_key')
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('co_scholastic_areas_tenant_id_idx').on(table.tenantId),
    ...tenantPolicies('co_scholastic_areas'),
  ],
);
