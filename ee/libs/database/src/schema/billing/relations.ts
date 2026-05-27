import * as coreSchema from '@roviq/database/schema';
import { type AnyRelations, defineRelationsPart } from 'drizzle-orm';
import * as eeSchema from './index';

const schema = { ...coreSchema, ...eeSchema };

// Explicit `AnyRelations` annotation: the inferred type spans every core + EE
// table and exceeds TS's declaration-serialization limit (TS7056) once the core
// schema grows. The precise per-table type isn't consumed anywhere (the DB
// provider wires only the core `relations`; billing uses `db.select`), so the
// annotation is lossless in practice and keeps `ee-database` cold-buildable.
export const billingRelations: AnyRelations = defineRelationsPart(schema, (r) => ({
  // ── Plans ─────────────────────────────────────────────
  plans: {
    reseller: r.one.resellers({
      from: r.plans.resellerId,
      to: r.resellers.id,
    }),
    subscriptions: r.many.subscriptions(),
  },

  // ── Subscriptions ─────────────────────────────────────
  subscriptions: {
    plan: r.one.plans({
      from: r.subscriptions.planId,
      to: r.plans.id,
    }),
    institute: r.one.institutes({
      from: r.subscriptions.tenantId,
      to: r.institutes.id,
    }),
    reseller: r.one.resellers({
      from: r.subscriptions.resellerId,
      to: r.resellers.id,
    }),
    invoices: r.many.invoices(),
  },

  // ── Invoices ──────────────────────────────────────────
  invoices: {
    subscription: r.one.subscriptions({
      from: r.invoices.subscriptionId,
      to: r.subscriptions.id,
    }),
    institute: r.one.institutes({
      from: r.invoices.tenantId,
      to: r.institutes.id,
    }),
    reseller: r.one.resellers({
      from: r.invoices.resellerId,
      to: r.resellers.id,
    }),
    payments: r.many.payments(),
  },

  // ── Payments ──────────────────────────────────────────
  payments: {
    invoice: r.one.invoices({
      from: r.payments.invoiceId,
      to: r.invoices.id,
    }),
    institute: r.one.institutes({
      from: r.payments.tenantId,
      to: r.institutes.id,
    }),
    reseller: r.one.resellers({
      from: r.payments.resellerId,
      to: r.resellers.id,
    }),
    /** Cash: which reseller field agent collected the payment */
    collectedBy: r.one.memberships({
      from: r.payments.collectedById,
      to: r.memberships.id,
    }),
    /** UPI P2P: which reseller staff verified the UTR */
    verifiedBy: r.one.memberships({
      from: r.payments.verifiedById,
      to: r.memberships.id,
    }),
  },

  // ── Gateway Configs ───────────────────────────────────
  gatewayConfigs: {
    reseller: r.one.resellers({
      from: r.gatewayConfigs.resellerId,
      to: r.resellers.id,
    }),
  },
}));
