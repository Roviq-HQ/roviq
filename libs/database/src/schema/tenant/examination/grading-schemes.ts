import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { i18nText, tenantColumns } from '../../common/columns';
import { gradingSchemeKind } from '../../common/enums';
import { tenantPolicies } from '../../common/rls-policies';
import { institutes } from '../institutes';

/**
 * A named grade scheme. SCHOLASTIC schemes map marks→grade via {@link gradeBands}
 * (with grade points); CO_SCHOLASTIC schemes are qualitative grade-only scales
 * (no marks) used for work-education / discipline / co-curricular areas.
 */
export const gradingSchemes = pgTable(
  'grading_schemes',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    name: i18nText('name').notNull(),
    kind: gradingSchemeKind().default('SCHOLASTIC').notNull(),
    /** Optional board label this scheme follows, e.g. "CBSE". */
    board: text(),
    /** The fallback scheme used when an exam/standard does not pin one. */
    isDefault: boolean('is_default').default(false).notNull(),
    ...tenantColumns,
  },
  (table) => [
    foreignKey({ columns: [table.tenantId], foreignColumns: [institutes.id] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('grading_schemes_name_key')
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('grading_schemes_tenant_id_idx').on(table.tenantId),
    ...tenantPolicies('grading_schemes'),
  ],
);
