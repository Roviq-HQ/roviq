import { sql } from 'drizzle-orm';
import { foreignKey, index, jsonb, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { promotionStatus } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { academicYears } from '../tenant/academic-years';
import { institutes } from '../tenant/institutes';
import { sections } from '../tenant/sections';
import { standards } from '../tenant/standards';
import { studentProfiles } from './student-profiles';

/**
 * One row per student per academic year — tracks section placement,
 * roll number, house assignment, and promotion status.
 *
 * Three-tier RLS enforced (same as student_profiles).
 */
export const studentAcademics = pgTable(
  'student_academics',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    studentProfileId: uuid('student_profile_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    standardId: uuid('standard_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    /** Roll number within the section (institute-assigned) */
    rollNumber: varchar('roll_number', { length: 10 }),
    /** FK to houses table (future module) — for house system / inter-house competitions */
    houseId: uuid('house_id'),
    /** FK to transport routes table (future module) — for bus route assignment */
    routeId: uuid('route_id'),
    /** Student roles within the class: ['class_monitor', 'prefect', 'house_captain', ...] */
    classRoles: jsonb('class_roles').$type<string[]>().default([]),
    /**
     * End-of-year promotion outcome:
     * - `pending`: academic year still active, no decision yet
     * - `promoted`: passed and will move to next standard
     * - `detained`: failed and will repeat current standard
     * - `graduated`: completed final year (Class 10/12 or coaching program)
     * - `transferred`: left this institute before promotion decision
     */
    promotionStatus: promotionStatus('promotion_status'),
    /** Standard the student was promoted to — NULL if pending, detained, or transferred */
    promotedToStandardId: uuid('promoted_to_standard_id'),

    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'student_academics_student_profile_id_tenant_fkey',
      [table.studentProfileId, table.tenantId],
      [studentProfiles.id, studentProfiles.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'student_academics_academic_year_id_tenant_fkey',
      [table.academicYearId, table.tenantId],
      [academicYears.id, academicYears.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'student_academics_standard_id_tenant_fkey',
      [table.standardId, table.tenantId],
      [standards.id, standards.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'student_academics_section_id_tenant_fkey',
      [table.sectionId, table.tenantId],
      [sections.id, sections.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'student_academics_promoted_to_standard_id_tenant_fkey',
      [table.promotedToStandardId, table.tenantId],
      [standards.id, standards.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** One live enrollment per student per academic year; a soft-deleted row releases the key. */
    uniqueIndex('uq_student_academic_year')
      .on(table.studentProfileId, table.academicYearId)
      .where(sql`${table.deletedAt} IS NULL`),
    /** Section roster lookup: all students in a section for an academic year */
    index('idx_student_academics_section')
      .on(table.tenantId, table.academicYearId, table.sectionId)
      .where(sql`${table.deletedAt} IS NULL`),
    /** Standard roster lookup: all students in a standard for an academic year */
    index('idx_student_academics_standard')
      .on(table.tenantId, table.academicYearId, table.standardId)
      .where(sql`${table.deletedAt} IS NULL`),

    ...tenantPolicies('student_academics'),
  ],
);
