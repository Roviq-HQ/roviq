import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantColumns } from '../common/columns';
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
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    guardianProfileId: uuid('guardian_profile_id')
      .notNull()
      .references(() => guardianProfiles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

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

    ...tenantColumns,
  },
  (table) => [
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

    ...tenantPolicies('student_guardian_links'),
  ],
);
