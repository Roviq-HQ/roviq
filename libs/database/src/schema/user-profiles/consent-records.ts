import {
  CONSENT_PURPOSE_VALUES,
  CONSENT_VERIFICATION_METHOD_VALUES,
  type ConsentPurpose,
  type ConsentVerificationMethod,
} from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  inet,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';
import { guardianProfiles } from './guardian-profiles';
import { privacyNotices } from './privacy-notices';
import { studentProfiles } from './student-profiles';

const PURPOSES = sql.raw(CONSENT_PURPOSE_VALUES.map((v) => `'${v}'`).join(', '));
const VERIFICATION_METHODS = sql.raw(
  CONSENT_VERIFICATION_METHOD_VALUES.map((v) => `'${v}'`).join(', '),
);

/**
 * DPDP Act 2023 verifiable parental consent tracking — APPEND-ONLY.
 *
 * Each consent decision (grant or withdrawal) creates a NEW row.
 * Existing rows are NEVER updated or deleted — this is a legal audit trail.
 * roviq_app gets SELECT + INSERT only (no UPDATE, no DELETE).
 *
 * Consent withdrawal creates a new row with `is_granted=false` + `withdrawn_at`.
 * The latest row per (guardian, student, purpose) determines current consent state.
 *
 * Three-tier RLS with custom append-only policies for roviq_app.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    guardianProfileId: uuid('guardian_profile_id')
      .notNull()
      .references(() => guardianProfiles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    studentProfileId: uuid('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** What the consent covers: one of `CONSENT_PURPOSE_VALUES` (DPDP Section 6). */
    purpose: varchar('purpose', { length: 50 }).$type<ConsentPurpose>().notNull(),

    /** true = consent granted, false = consent withdrawn */
    isGranted: boolean('is_granted').notNull(),
    /** Timestamp when consent was granted (NULL for withdrawal rows) */
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    /** Timestamp when consent was withdrawn (NULL for grant rows) */
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),

    /** How the guardian's identity was checked: one of `CONSENT_VERIFICATION_METHOD_VALUES`. */
    verificationMethod: varchar('verification_method', {
      length: 30,
    }).$type<ConsentVerificationMethod>(),
    /** DigiLocker token ID, Aadhaar OTP transaction ID, etc. */
    verificationReference: varchar('verification_reference', { length: 100 }),
    /** IP address of the device used for consent action */
    ipAddress: inet('ip_address'),
    /** Browser/app user agent string for audit trail */
    userAgent: text('user_agent'),
    /** Privacy notice version that was displayed when consent was given */
    privacyNoticeId: uuid('privacy_notice_id').references(() => privacyNotices.id),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    check('chk_consent_purpose', sql`${table.purpose} IN (${PURPOSES})`),
    check(
      'chk_verification_method',
      sql`${table.verificationMethod} IS NULL OR ${table.verificationMethod} IN (${VERIFICATION_METHODS})`,
    ),

    index('idx_consent_guardian').on(table.guardianProfileId, table.purpose),
    index('idx_consent_student').on(table.studentProfileId, table.purpose),

    // ── APPEND-ONLY RLS: roviq_app can SELECT + INSERT but NOT UPDATE/DELETE ──
    pgPolicy('consent_records_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    pgPolicy('consent_records_app_insert', {
      for: 'insert',
      to: roviqApp,
      withCheck: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    /** BLOCKED: roviq_app cannot UPDATE consent records (append-only for DPDP compliance) */
    pgPolicy('consent_records_app_update', {
      for: 'update',
      to: roviqApp,
      using: sql`false`,
    }),
    /** BLOCKED: roviq_app cannot DELETE consent records (append-only for DPDP compliance) */
    pgPolicy('consent_records_app_delete', {
      for: 'delete',
      to: roviqApp,
      using: sql`false`,
    }),
    pgPolicy('consent_records_reseller_read', {
      for: 'select',
      to: roviqReseller,
      using: sql`tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      )`,
    }),
    pgPolicy('consent_records_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
