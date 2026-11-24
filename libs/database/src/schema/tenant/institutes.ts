import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { entityColumns, i18nText } from '../common/columns';
import {
  educationLevel,
  instituteStatus,
  instituteType,
  setupStatus,
  structureFramework,
} from '../common/enums';
import { roviqAdmin, roviqApp, roviqReseller } from '../common/rls-policies';
import { resellers } from '../reseller/resellers';
import { instituteGroups } from './institute-groups';

/** Derived type from the pgEnum — 'PENDING_APPROVAL' | 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REJECTED' */
export type InstituteStatus = (typeof instituteStatus.enumValues)[number];

// ── JSONB type definitions ─────────────────────────────

export type InstitutePhone = {
  countryCode: string;
  number: string;
  isPrimary: boolean;
  isWhatsappEnabled: boolean;
  label: string;
};

export type InstituteEmail = {
  address: string;
  isPrimary: boolean;
  label: string;
};

export type InstituteContact = {
  phones: InstitutePhone[];
  emails: InstituteEmail[];
};

export type InstituteAddress = {
  line1: string;
  line2?: string;
  line3?: string;
  city: string;
  district: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates?: { lat: number; lng: number };
};

// ── Table definition ───────────────────────────────────

export const institutes = pgTable(
  'institutes',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    name: i18nText('name').notNull(),
    slug: text().notNull(),
    code: varchar({ length: 50 }),
    type: instituteType().default('SCHOOL').notNull(),
    structureFramework: structureFramework('structure_framework').default('TRADITIONAL').notNull(),
    setupStatus: setupStatus('setup_status').default('PENDING').notNull(),
    contact: jsonb().$type<InstituteContact>().default({ phones: [], emails: [] }).notNull(),
    address: jsonb().$type<InstituteAddress>(),
    /**
     * The user named as first admin when the institute was requested or created. Setup gives
     * this user the institute admin membership. Only the id lives here: the person's details
     * are in the platform-level user tables, which institute roles cannot read.
     */
    firstAdminUserId: uuid('first_admin_user_id').references(() => users.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    timezone: text().default('Asia/Kolkata').notNull(),
    currency: text().default('INR').notNull(),
    supportedLocales: jsonb('supported_locales').$type<string[]>().default(['en']).notNull(),
    defaultLocale: text('default_locale').default('en').notNull(),
    settings: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    /** Whether this is a demo institute — sample data seeded, notifications disabled */
    isDemo: boolean('is_demo').default(false).notNull(),
    /** When true, cross-scope impersonation (platform/reseller -> this institute) requires OTP from the institute admin. */
    requireImpersonationConsent: boolean('require_impersonation_consent').default(false).notNull(),
    /** Education levels offered by this institute (e.g., primary + secondary) */
    departments: educationLevel().array().notNull().default(sql`'{}'::\"EducationLevel\"[]`),
    status: instituteStatus().default('ACTIVE').notNull(),
    resellerId: uuid('reseller_id')
      .default(sql`'00000000-0000-7000-a000-000000000011'`)
      .notNull()
      .references(() => resellers.id),
    groupId: uuid('group_id').references(() => instituteGroups.id),
    ...entityColumns,
  },
  (table) => [
    check(
      'institutes_locales_valid',
      sql`jsonb_typeof(${table.supportedLocales}) = 'array'
      AND ${table.supportedLocales} @> '["en"]'::jsonb
      AND ${table.supportedLocales} ? ${table.defaultLocale}`,
    ),
    index('idx_institutes_name_gin').using('gin', table.name),
    index('idx_institutes_name_trgm').using(
      'gin',
      sql`i18n_text_to_string(${table.name}) gin_trgm_ops`,
    ),
    // Search matches the code with ILIKE '%…%'.
    index('idx_institutes_code_trgm').using('gin', sql`${table.code} gin_trgm_ops`),
    uniqueIndex('institutes_slug_key').using('btree', table.slug.asc().nullsLast()),
    index('institutes_group_id_idx').on(table.groupId),
    uniqueIndex('institutes_code_key')
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL AND ${table.code} IS NOT NULL`),
    index('institutes_type_idx').on(table.type),
    index('institutes_reseller_id_idx').on(table.resellerId),
    index('institutes_status_idx').on(table.status),
    // ── RLS policies (PRD §9.3 — institutes is the tenant root, special case) ──
    // Soft-delete visibility is handled in the application layer (see
    // libs/database/src/schema/common/rls-policies.ts header).

    // roviq_app: SELECT only — institute users can read their own institute
    pgPolicy('institutes_app_select', {
      for: 'select',
      to: roviqApp,
      using: sql`id = current_setting('app.current_tenant_id', true)::uuid`,
    }),

    // roviq_reseller: its own institutes.
    // SECURITY: no DELETE policy — removing an institute is a platform decision (ROV-102).
    // The `institutes_delete_admin_only` trigger refuses a reseller soft-delete as well.
    pgPolicy('institutes_reseller_select', {
      for: 'select',
      to: roviqReseller,
      using: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
    }),
    pgPolicy('institutes_reseller_insert', {
      for: 'insert',
      to: roviqReseller,
      withCheck: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
    }),
    pgPolicy('institutes_reseller_update', {
      for: 'update',
      to: roviqReseller,
      using: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
      withCheck: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
    }),

    // roviq_admin: full access
    pgPolicy('institutes_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
