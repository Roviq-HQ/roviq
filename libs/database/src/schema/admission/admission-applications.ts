import { AdmissionApplicationStatus, REJECTION_REASON_MAX_LENGTH } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { admissionApplicationStatus } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { academicYears } from '../tenant/academic-years';
import { institutes } from '../tenant/institutes';
import { sections } from '../tenant/sections';
import { standards } from '../tenant/standards';
import { studentProfiles } from '../user-profiles/student-profiles';
import { enquiries } from './enquiries';

/**
 * Formal admission application — created after enquiry conversion or submitted directly.
 *
 * Tracks the full application lifecycle from submission through document verification,
 * testing, offer, and enrollment. form_data JSONB stores institute-specific form fields.
 *
 * Three-tier RLS enforced.
 */
export const admissionApplications = pgTable(
  'admission_applications',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    /** Nullable — NULL for direct applications that skip the enquiry step */
    enquiryId: uuid('enquiry_id'),
    academicYearId: uuid('academic_year_id').notNull(),
    standardId: uuid('standard_id').notNull(),
    /** Nullable until section is assigned during admission processing */
    sectionId: uuid('section_id'),

    // ── Application form data ───────────────────────────
    /**
     * Institute-specific admission form data stored as JSONB.
     * Structure varies per institute's admission form configuration.
     * Contains: student personal info, parent info, academic history, etc.
     */
    formData: jsonb('form_data').notNull().default({}).$type<Record<string, unknown>>(),

    // ── Status ──────────────────────────────────────────
    /**
     * Application lifecycle state:
     * - `draft`: application started but not yet submitted
     * - `submitted`: formally submitted by parent/guardian
     * - `under_review`: institute staff are reviewing the submitted application
     * - `documents_pending`: awaiting required document uploads
     * - `documents_verified`: all documents verified by admin
     * - `test_scheduled`: entrance test date assigned
     * - `test_completed`: entrance test taken
     * - `interview_scheduled`: interview date assigned
     * - `interview_completed`: interview conducted
     * - `merit_listed`: placed on merit list based on scores/criteria
     * - `offer_made`: seat offered to the applicant
     * - `offer_accepted`: parent accepted the seat offer
     * - `fee_pending`: offer accepted, awaiting fee payment
     * - `fee_paid`: admission fee received
     * - `enrolled`: student formally enrolled (terminal success state)
     * - `waitlisted`: on waiting list (no seat available, may get offer later)
     * - `rejected`: application rejected by institute
     * - `withdrawn`: application withdrawn by parent
     * - `expired`: offer expired without acceptance
     */
    status: admissionApplicationStatus('status')
      .notNull()
      .default(AdmissionApplicationStatus.SUBMITTED),

    // ── RTE specific ────────────────────────────────────
    /** Whether this is an application under RTE Act Section 12(1)(c) 25% reservation */
    isRteApplication: boolean('is_rte_application').notNull().default(false),
    /** Rank assigned in the RTE lottery draw (NULL if not RTE or lottery not conducted) */
    rteLotteryRank: integer('rte_lottery_rank'),

    // ── Test / Interview ────────────────────────────────
    /** Entrance test score — DECIMAL(5,2) for scores like 95.50 */
    testScore: numeric('test_score', { precision: 5, scale: 2 }),
    /** Interview score — DECIMAL(5,2) */
    interviewScore: numeric('interview_score', { precision: 5, scale: 2 }),
    /** Overall merit rank computed from test + interview + other criteria */
    meritRank: integer('merit_rank'),

    // ── Offer tracking ──────────────────────────────────
    /** Timestamp when the seat offer was made */
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    /** Deadline for accepting the offer — auto-expires to 'expired' after this */
    offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
    /** Timestamp when the parent accepted the offer */
    offerAcceptedAt: timestamp('offer_accepted_at', { withTimezone: true }),

    // ── Rejection ───────────────────────────────────────
    /** Reason recorded when the institute rejects the application (NULL if none given) */
    rejectionReason: varchar('rejection_reason', { length: REJECTION_REASON_MAX_LENGTH }),
    /** Timestamp when the application moved to `rejected` */
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),

    // ── Conversion to student ───────────────────────────
    /** FK to student_profiles — set after successful enrollment */
    studentProfileId: uuid('student_profile_id'),

    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('admission_applications_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'admission_applications_enquiry_id_tenant_fkey',
      [table.enquiryId, table.tenantId],
      [enquiries.id, enquiries.tenantId],
    ),
    sameTenantForeignKey(
      'admission_applications_academic_year_id_tenant_fkey',
      [table.academicYearId, table.tenantId],
      [academicYears.id, academicYears.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'admission_applications_standard_id_tenant_fkey',
      [table.standardId, table.tenantId],
      [standards.id, standards.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'admission_applications_section_id_tenant_fkey',
      [table.sectionId, table.tenantId],
      [sections.id, sections.tenantId],
    ),
    sameTenantForeignKey(
      'admission_applications_student_profile_id_tenant_fkey',
      [table.studentProfileId, table.tenantId],
      [studentProfiles.id, studentProfiles.tenantId],
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('idx_applications_status')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_applications_academic_year')
      .on(table.tenantId, table.academicYearId)
      .where(sql`${table.deletedAt} IS NULL`),

    ...tenantPolicies('admission_applications'),
  ],
);
