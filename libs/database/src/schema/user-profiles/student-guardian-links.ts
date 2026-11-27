import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { guardianRelationship } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';
import { guardianProfiles } from './guardian-profiles';
import { studentProfiles } from './student-profiles';

/**
 * Junction table linking students to guardians — bidirectional querying.
 * Replaces the old `student_guardians` table dropped in ROV-149.
 *
 * Three-tier RLS enforced. Partial unique index ensures exactly
 * one primary contact per student at the database level.
 */
export const studentGuardianLinks = pgTable(
  'student_guardian_links',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    studentProfileId: uuid('student_profile_id').notNull(),
    guardianProfileId: uuid('guardian_profile_id').notNull(),

    /** Relationship of the guardian to the student — pgEnum enforces membership. */
    relationship: guardianRelationship('relationship').notNull(),
    /** The designated primary contact for school communications and TC issuance */
    isPrimaryContact: boolean('is_primary_contact').notNull().default(false),
    /** Listed as emergency contact — called in medical/safety situations */
    isEmergencyContact: boolean('is_emergency_contact').notNull().default(false),
    /** Authorised to pick up the student from school premises */
    canPickup: boolean('can_pickup').notNull().default(true),
    /** Whether the student resides with this guardian — affects address on records */
    livesWith: boolean('lives_with').notNull().default(true),
    /**
     * When the institute closed this guardian's access to the student. While set, the link
     * stays on the student's record but gives the guardian nothing in the portal: no
     * permission on the student, no consent, no notification about them.
     */
    accessRevokedAt: timestamp('access_revoked_at', { withTimezone: true }),
    /** The staff member who closed the access. */
    accessRevokedBy: uuid('access_revoked_by'),

    ...tenantColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'student_guardian_links_guardian_profile_id_tenant_fkey',
      [table.guardianProfileId, table.tenantId],
      [guardianProfiles.id, guardianProfiles.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'student_guardian_links_student_profile_id_tenant_fkey',
      [table.studentProfileId, table.tenantId],
      [studentProfiles.id, studentProfiles.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** One link per student-guardian pair per institute */
    uniqueIndex('uq_student_guardian')
      .on(table.studentProfileId, table.guardianProfileId)
      .where(sql`${table.deletedAt} IS NULL`),
    /** Exactly one primary contact per student — enforced at DB level */
    uniqueIndex('idx_primary_contact')
      .on(table.studentProfileId)
      .where(sql`${table.isPrimaryContact} = true AND ${table.deletedAt} IS NULL`),
    /** Find all students of a guardian (sibling discovery, parent dashboard) */
    index('idx_guardian_students').on(table.guardianProfileId),

    check(
      'chk_guardian_link_revoked_not_primary',
      sql`${table.accessRevokedAt} IS NULL OR ${table.isPrimaryContact} = false`,
    ),
    check(
      'chk_guardian_link_revoked_by',
      sql`(${table.accessRevokedAt} IS NULL) = (${table.accessRevokedBy} IS NULL)`,
    ),

    ...tenantPolicies('student_guardian_links'),
  ],
);
