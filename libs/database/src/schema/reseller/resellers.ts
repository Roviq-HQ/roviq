import type { ResellerBrandingTheme } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { entityColumns } from '../common/columns';
import { resellerStatus, resellerTier } from '../common/enums';
import { roviqAdmin, roviqReseller } from '../common/rls-policies';
import type { InstituteAddress, InstituteContact } from '../tenant/institutes';

/** Shape of `resellers.branding`. Every key is optional; an absent key means "use the default". */
export interface ResellerBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: ResellerBrandingTheme;
  customCss?: string;
}

export const resellers = pgTable(
  'resellers',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    name: varchar({ length: 255 }).notNull(),
    slug: varchar({ length: 100 }).notNull(),
    tier: resellerTier().default('FULL_MANAGEMENT').notNull(),
    isSystem: boolean('is_system').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    status: resellerStatus().default('ACTIVE').notNull(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    branding: jsonb().$type<ResellerBranding>().default({}),
    customDomain: varchar('custom_domain', { length: 255 }),
    registrationNumber: text('registration_number'),
    registrationState: text('registration_state'),
    contact: jsonb().$type<InstituteContact>().default({ phones: [], emails: [] }).notNull(),
    address: jsonb().$type<InstituteAddress>(),
    ...entityColumns,
  },
  (table) => [
    uniqueIndex('resellers_slug_key').on(table.slug),
    // RLS: reseller can read own record
    pgPolicy('reseller_own_read', {
      for: 'select',
      to: roviqReseller,
      using: sql`id = current_setting('app.current_reseller_id', true)::uuid`,
    }),
    // RLS: reseller can edit own record; column grants limit which fields (ROV-186)
    pgPolicy('reseller_own_update', {
      for: 'update',
      to: roviqReseller,
      using: sql`id = current_setting('app.current_reseller_id', true)::uuid`,
      withCheck: sql`id = current_setting('app.current_reseller_id', true)::uuid`,
    }),
    // RLS: admin has full access
    pgPolicy('reseller_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
).enableRLS();
