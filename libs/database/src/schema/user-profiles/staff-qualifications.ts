import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
import { qualificationType } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { institutes } from '../tenant/institutes';
import { staffProfiles } from './staff-profiles';

/**
 * Structured staff qualifications — one row per degree/certification.
 *
 * Replaces unstructured `string[]` for UDISE+ DCF teacher qualification reporting.
 * Three-tier RLS enforced.
 */
export const staffQualifications = pgTable(
  'staff_qualifications',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    staffProfileId: uuid('staff_profile_id')
      .notNull()
      .references(() => staffProfiles.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    /**
     * Qualification category:
     * - `academic`: formal degree (Secondary, Graduate, Post Graduate, M.Phil, Ph.D)
     * - `professional`: teaching certification (D.El.Ed, B.Ed, M.Ed, CTET, HTET, REET, NET, SLET)
     */
    type: qualificationType('type').notNull(),
    /** Name of the degree/certification — e.g., 'B.Ed', 'M.Sc Physics', 'CTET Paper II' */
    degreeName: varchar('degree_name', { length: 100 }).notNull(),
    /** Name of the institution where the qualification was obtained */
    institution: varchar('institution', { length: 200 }),
    /** Examining board or university name */
    boardUniversity: varchar('board_university', { length: 200 }),
    yearOfPassing: integer('year_of_passing'),
    /** Grade or percentage — e.g., '85%', 'First Division', 'A+' */
    gradePercentage: varchar('grade_percentage', { length: 20 }),
    /** Scan of the certificate, if one was uploaded */
    certificateFileId: uuid('certificate_file_id').references(() => files.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

    ...tenantColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('idx_staff_qualifications_profile').on(table.staffProfileId),

    ...tenantPolicies('staff_qualifications'),
  ],
).enableRLS();
