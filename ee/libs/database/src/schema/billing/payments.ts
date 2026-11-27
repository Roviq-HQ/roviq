import {
  institutes,
  resellerMemberships,
  resellers,
  roviqAdmin,
  roviqApp,
  roviqReseller,
  sameTenantForeignKey,
  trackingColumns,
} from '@roviq/database';
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { paymentMethod, paymentStatus } from './enums';
import { money } from './helpers';
import { invoices } from './invoices';

export const payments = pgTable(
  'payments',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    invoiceId: uuid('invoice_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    resellerId: uuid('reseller_id')
      .notNull()
      .references(() => resellers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    status: paymentStatus().default('PENDING').notNull(),
    method: paymentMethod().notNull(),
    amountPaise: money('amount_paise'),
    currency: varchar({ length: 3 }).default('INR').notNull(),
    gatewayProvider: varchar('gateway_provider', { length: 50 }),
    gatewayPaymentId: varchar('gateway_payment_id', { length: 255 }),
    gatewayOrderId: varchar('gateway_order_id', { length: 255 }),
    gatewayResponse: jsonb('gateway_response'),
    receiptNumber: varchar('receipt_number', { length: 50 }),
    refundedAmountPaise: money('refunded_amount_paise'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundReason: text('refund_reason'),
    refundGatewayId: varchar('refund_gateway_id', { length: 255 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    notes: text(),
    metadata: jsonb(),

    // --- Cash payment tracking ---
    /** Which reseller field agent collected the cash */
    collectedById: uuid('collected_by_id').references(() => resellerMemberships.id),
    /** When cash was physically collected (may differ from recording date) */
    collectionDate: date('collection_date'),

    // --- UPI P2P verification ---
    /** UTR reference from institute's UPI app */
    utrNumber: varchar('utr_number', { length: 50 }),
    /** PENDING_VERIFICATION → VERIFIED / REJECTED / EXPIRED */
    verificationStatus: varchar('verification_status', { length: 30 }),
    /** 24h after UTR submitted — auto-expires if unverified */
    verificationDeadline: timestamp('verification_deadline', { withTimezone: true }),
    /** When reseller confirmed the UTR */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Which reseller staff verified the UTR */
    verifiedById: uuid('verified_by_id').references(() => resellerMemberships.id),

    ...trackingColumns,
  },
  (table) => [
    sameTenantForeignKey(
      'payments_invoice_id_tenant_fkey',
      [table.invoiceId, table.tenantId],
      [invoices.id, invoices.tenantId],
    )
      .onDelete('restrict')
      .onUpdate('cascade'),
    index('payments_invoice_id_idx').on(table.invoiceId),
    index('payments_tenant_id_idx').on(table.tenantId),
    index('payments_reseller_id_idx').on(table.resellerId),
    index('payments_status_idx').on(table.status),
    index('payments_gateway_order_id_idx').on(table.gatewayOrderId),
    // One row per captured gateway payment, so browser verify and webhook cannot both record it.
    uniqueIndex('payments_gateway_payment_id_key')
      .on(table.gatewayPaymentId)
      .where(sql`gateway_payment_id IS NOT NULL`),
    // App: read own institute's payments
    pgPolicy('pay_app_read', {
      for: 'select',
      to: roviqApp,
      using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    // Reseller: full CRUD on their payments
    pgPolicy('pay_reseller_all', {
      for: 'all',
      to: roviqReseller,
      using: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
      withCheck: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
    }),
    // Admin: break-glass full access
    pgPolicy('pay_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
