import { bigint, foreignKey, pgTable, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';

/**
 * Atomic per-tenant sequence generator.
 *
 * Eliminates the `COUNT(*) + 1` race condition by using a single UPDATE + RETURNING
 * via the `next_sequence_value()` PostgreSQL function. Each row tracks one named
 * counter scoped to a tenant.
 *
 * Each issuer creates its row on first use; nothing seeds them when an institute is set up.
 *
 * Sequence name patterns:
 * - `adm_no:{prefix}` — admission numbers, one series per prefix (`adm_no:` = unprefixed);
 *   legacy shared `adm_no` is read-only, new series start after its value
 * - `roll_no:{section_id}:{academic_year_id}` — roll numbers per section per year
 * - `tc_no:{academic_year_id}` — TC serials per year, formatted `TC/{year label}/0001`
 * - `cert_no:{type}` — certificate serial numbers
 * - `enq_no` — enquiry numbers, `ENQ-000001`, one counter that never resets
 * - `employee_id` — staff employee IDs
 */
export const tenantSequences = pgTable(
  'tenant_sequences',
  {
    tenantId: uuid('tenant_id').notNull(),
    /** Identifies the counter, e.g. `adm_no:N-`, `roll_no:{section_id}:{academic_year_id}` */
    sequenceName: varchar('sequence_name', { length: 120 }).notNull(),
    /**
     * Last issued value, incremented atomically by `next_sequence_value()`. An admission series is
     * also raised to a supplied number that fits it (`recordSuppliedAdmissionNumber`).
     */
    currentValue: bigint('current_value', { mode: 'bigint' }).default(0n).notNull(),
    /** Optional prefix prepended in the formatted output, e.g. `N-` */
    prefix: varchar({ length: 20 }),
    /**
     * Template that `next_sequence_value()` fills: `{prefix}` and `{value:0Nd}` only.
     * Used by enquiry, roll, certificate and staff numbers; admission and TC numbers are
     * formatted in TypeScript (`formatSequenceValue`), which also fills `{year}`.
     */
    formatTemplate: varchar('format_template', { length: 50 }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.sequenceName] }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    ...tenantPolicies('tenant_sequences'),
  ],
);
