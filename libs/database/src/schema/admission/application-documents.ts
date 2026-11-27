import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../auth/users';
import { sameTenantForeignKey, tenantColumns } from '../common/columns';
import { tenantPolicies } from '../common/rls-policies';
import { institutes } from '../tenant/institutes';
import { admissionApplications } from './admission-applications';

/**
 * Documents submitted with an admission application — per-document verification tracking.
 * The scanned pages live in `application_document_files`.
 *
 * Three-tier RLS enforced.
 */
export const applicationDocuments = pgTable(
  'application_documents',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    applicationId: uuid('application_id').notNull(),
    /** Document type — same enum as user_documents.type (birth_certificate, aadhaar_card, etc.) */
    type: varchar('type', { length: 50 }).notNull(),
    /** Whether this document has been verified by an admin */
    isVerified: boolean('is_verified').default(false),
    /** Admin who verified (or rejected) this document */
    verifiedBy: uuid('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Reason for rejection — populated when admin rejects a document */
    rejectionReason: varchar('rejection_reason', { length: 255 }),

    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('application_documents_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'application_documents_application_id_tenant_fkey',
      [table.applicationId, table.tenantId],
      [admissionApplications.id, admissionApplications.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('idx_application_documents_app').on(table.applicationId),

    ...tenantPolicies('application_documents'),
  ],
);
