import {
  institutes,
  resellers,
  roviqAdmin,
  roviqApp,
  roviqReseller,
  trackingColumns,
} from '@roviq/database';
import { sql } from 'drizzle-orm';
import {
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
import { invoiceStatus } from './enums';
import { money } from './helpers';
import { subscriptions } from './subscriptions';
import type { InvoiceLineItem } from './types';

export const invoices = pgTable(
  'invoices',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    resellerId: uuid('reseller_id')
      .notNull()
      .references(() => resellers.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    status: invoiceStatus().default('DRAFT').notNull(),
    subtotalAmount: money('subtotal_amount'),
    taxAmount: money('tax_amount'),
    totalAmount: money('total_amount'),
    paidAmount: money('paid_amount'),
    currency: varchar({ length: 3 }).default('INR').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    lineItems: jsonb('line_items').$type<InvoiceLineItem[]>().default([]).notNull(),
    taxBreakdown: jsonb('tax_breakdown'),
    notes: text(),
    metadata: jsonb(),
    ...trackingColumns,
  },
  (table) => [
    // Invoice lists are per institute or per reseller, newest first.
    index('idx_invoices_tenant').on(table.tenantId, table.createdAt.desc()),
    index('invoices_subscription_id_idx').on(table.subscriptionId),
    index('idx_invoices_reseller').on(table.resellerId, table.createdAt.desc()),
    // Only unpaid invoices are looked up by status (reminders, overdue checks).
    index('idx_invoices_status')
      .on(table.status)
      .where(sql`${table.status} IN ('SENT', 'OVERDUE')`),
    uniqueIndex('uq_invoice_number_reseller').on(table.resellerId, table.invoiceNumber),
    // App: read own institute's invoices
    pgPolicy('inv_app_read', {
      for: 'select',
      to: roviqApp,
      using: sql`tenant_id = current_setting('app.current_tenant_id', true)::uuid`,
    }),
    // Reseller: full CRUD on their invoices
    pgPolicy('inv_reseller_all', {
      for: 'all',
      to: roviqReseller,
      using: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
      withCheck: sql`reseller_id = current_setting('app.current_reseller_id', true)::uuid`,
    }),
    // Admin: break-glass full access
    pgPolicy('inv_admin_all', {
      for: 'all',
      to: roviqAdmin,
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);
