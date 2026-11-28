import { type CbseTcData, TcStatus } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { sameTenantForeignKey, sameTenantOrNoneForeignKey, tenantColumns } from '../common/columns';
import { tcStatus } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { files } from '../storage/files';
import { academicYears } from '../tenant/academic-years';
import { institutes } from '../tenant/institutes';
import { studentProfiles } from '../user-profiles/student-profiles';

// ── JSONB type definitions ─────────────────────────────

/** Department clearance record within tc_register.clearances */
export type ClearanceRecord = {
  cleared: boolean;
  by?: string;
  at?: string;
  notes?: string;
};

/** Clearances JSONB: { accounts, library, lab, transport, hostel, ... } */
export type TcClearances = Record<string, ClearanceRecord>;

/**
 * Transfer Certificate register — tracks the full TC lifecycle from request
 * through clearance, generation, review, approval, and issuance.
 *
 * tc_data JSONB snapshots all 20+ CBSE fields at generation time so the TC
 * remains accurate even if the student record is later modified.
 *
 * Supports duplicate TC issuance via self-referencing FK (original_tc_id).
 * Three-tier RLS enforced.
 */
export const tcRegister = pgTable(
  'tc_register',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    studentProfileId: uuid('student_profile_id').notNull(),
    /** TC serial number — e.g., 'TC/2025-26/001'. Unique per tenant. */
    tcSerialNumber: varchar('tc_serial_number', { length: 50 }).notNull(),
    academicYearId: uuid('academic_year_id').notNull(),

    // ── Status workflow ─────────────────────────────────
    /**
     * TC lifecycle state:
     * - `requested`: guardian/admin initiated TC request
     * - `clearance_pending`: awaiting department clearances (accounts, library, lab, transport)
     * - `clearance_complete`: all departments have cleared the student
     * - `generated`: TC document auto-generated from student record snapshot
     * - `review_pending`: awaiting class teacher / section head review
     * - `approved`: principal has approved the TC
     * - `issued`: TC physically/digitally handed to guardian
     * - `cancelled`: TC request cancelled before issuance
     * - `duplicate_requested`: request for a duplicate copy of an already-issued TC
     * - `duplicate_issued`: duplicate TC issued (with fee)
     */
    status: tcStatus('status').notNull().default(TcStatus.REQUESTED),

    // ── TC data (snapshot at generation time) ───────────
    /**
     * All 20+ CBSE Transfer Certificate fields frozen at generation time:
     * name, parents, DOB, nationality, category, admission date, class,
     * subjects, result, dues status, attendance, conduct, NCC, reason for leaving, etc.
     */
    tcData: jsonb('tc_data')
      .$type<CbseTcData>()
      .notNull()
      .default({} as CbseTcData),

    // ── Workflow tracking ────────────────────────────────
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    /** Reason for TC request — shown on the TC document */
    reason: varchar('reason', { length: 200 }).notNull(),
    /**
     * Department clearances — each key is a department, value tracks cleared status:
     * `{ accounts: { cleared: true, by: 'uuid', at: 'timestamp' }, library: { cleared: false }, ... }`
     */
    clearances: jsonb('clearances').$type<TcClearances>().default({}),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    /** Must be Principal — enforced by CASL at application level */
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    /** Name of the person who physically collected the TC */
    issuedTo: varchar('issued_to', { length: 200 }),

    // ── Digital ─────────────────────────────────────────
    /** The rendered PDF (purpose TC_PDF); NULL until issue has rendered it. */
    pdfFileId: uuid('pdf_file_id'),
    /** Opaque token in the QR code; the public page looks the TC up by it. Set on issue. */
    verificationToken: text('verification_token'),
    /** Whether the TC has been counter-signed by DEO (required for inter-district transfers in Haryana) */
    isCounterSigned: boolean('is_counter_signed').default(false),
    counterSignedBy: varchar('counter_signed_by', { length: 200 }),

    // ── Duplicate TC ────────────────────────────────────
    /** Whether this is a duplicate copy of a previously issued TC */
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    /** Self-referencing FK to the original TC — NULL if this is the original */
    originalTcId: uuid('original_tc_id'),
    duplicateReason: text('duplicate_reason'),
    /** Duplicate TC fee in paise (BIGINT to avoid decimal truncation) */
    duplicateFee: bigint('duplicate_fee', { mode: 'bigint' }),

    ...tenantColumns,
  },
  (table) => [
    sameTenantOrNoneForeignKey(
      'tc_register_pdf_file_id_tenant_or_none_fkey',
      table.pdfFileId,
      files.id,
    ).onDelete('restrict'),
    sameTenantForeignKey(
      'tc_register_student_profile_id_tenant_fkey',
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
    // The year must belong to the same institute as the TC.
    foreignKey({
      columns: [table.academicYearId, table.tenantId],
      foreignColumns: [academicYears.id, academicYears.tenantId],
      name: 'tc_register_academic_year_tenant_fkey',
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    /** Self-referencing FK for duplicate TCs */
    // The target of every same-institute foreign key to this table.
    uniqueIndex('tc_register_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'tc_register_original_tc_id_tenant_fkey',
      [table.originalTcId, table.tenantId],
      [table.id, table.tenantId],
    ),

    /** TC serial number unique per tenant */
    uniqueIndex('uq_tc_serial').on(table.tenantId, table.tcSerialNumber),
    uniqueIndex('uq_tc_verification_token').on(table.verificationToken),
    index('idx_tc_register_tenant_status')
      .on(table.tenantId, table.status)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_tc_register_student').on(table.studentProfileId),
    // One TC in progress per student; a cancelled or issued one frees the slot.
    uniqueIndex('uq_tc_register_open_request')
      .on(table.tenantId, table.studentProfileId)
      .where(
        sql`${table.isDuplicate} = false AND ${table.status} NOT IN ('CANCELLED', 'ISSUED') AND ${table.deletedAt} IS NULL`,
      ),

    // One duplicate request in progress per original TC.
    uniqueIndex('uq_tc_register_open_duplicate')
      .on(table.originalTcId)
      .where(sql`${table.status} = 'DUPLICATE_REQUESTED' AND ${table.deletedAt} IS NULL`),

    ...tenantPolicies('tc_register'),
  ],
);
