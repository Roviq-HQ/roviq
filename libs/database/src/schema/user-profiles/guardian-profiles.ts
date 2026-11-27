import { sql } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { guardianEducationLevel } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';
import { memberships } from '../tenant/memberships';

/**
 * Tenant-scoped guardian domain data — one row per membership (one guardian per institute).
 *
 * Three-tier RLS enforced. Annual income stored in paise (BIGINT)
 * for RTE eligibility verification — no decimal truncation.
 */
export const guardianProfiles = pgTable(
  'guardian_profiles',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    membershipId: uuid('membership_id').notNull().unique(),

    occupation: varchar('occupation', { length: 100 }),
    /** Employer name */
    organization: varchar('organization', { length: 200 }),
    /** Job title */
    designation: varchar('designation', { length: 100 }),
    /**
     * Annual household income in **paise** (1/100th of ₹).
     * BIGINT to avoid decimal truncation for RTE income threshold verification.
     * Example: ₹3,00,000 = 30000000 paise.
     */
    annualIncome: bigint('annual_income', { mode: 'bigint' }),
    /**
     * Highest education level. Allowed values are declared once in the
     * `guardianEducationLevel` pgEnum (`libs/database/src/schema/common/enums.ts`)
     * and enforced natively by Postgres — no manual CHECK constraint needed.
     * The frontend Select iterates `guardianEducationLevel.enumValues`; the
     * api-gateway derives a dual-namespace TS type + const alias from the
     * same pgEnum so `registerEnumType`/`@IsEnum` have a runtime value.
     */
    educationLevel: guardianEducationLevel('education_level'),

    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('guardian_profiles_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'guardian_profiles_membership_id_tenant_fkey',
      [table.membershipId, table.tenantId],
      [memberships.id, memberships.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('idx_guardian_profiles_tenant').on(table.tenantId).where(sql`${table.deletedAt} IS NULL`),

    ...tenantPolicies('guardian_profiles'),
  ],
);
