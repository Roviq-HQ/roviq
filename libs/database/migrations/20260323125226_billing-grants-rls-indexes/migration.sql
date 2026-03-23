-- Custom migration: billing GRANTs, FORCE RLS, partial unique indexes, performance indexes
-- ROV-109

-- ============================================================
-- GRANTs
-- ============================================================

-- roviq_app: SELECT only on business tables, NO access to payment_gateway_configs
GRANT SELECT ON plans, subscriptions, invoices, payments TO roviq_app;
-- Explicitly revoke roviq_app from gateway configs (db:push may grant via enableRLS)
REVOKE ALL ON payment_gateway_configs FROM roviq_app;

-- roviq_reseller: full CRUD on all billing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON
  plans, subscriptions, invoices, payments,
  payment_gateway_configs, reseller_invoice_sequences
TO roviq_reseller;

-- roviq_admin: full CRUD (break-glass only — no admin resolvers use this)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  plans, subscriptions, invoices, payments,
  payment_gateway_configs, reseller_invoice_sequences
TO roviq_admin;

-- Sequence usage for all roles
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_reseller;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_admin;

-- ============================================================
-- FORCE ROW LEVEL SECURITY
-- ============================================================
-- .enableRLS() in Drizzle only does ENABLE, not FORCE.
-- FORCE ensures RLS applies even to table owners.

ALTER TABLE plans FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_gateway_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE reseller_invoice_sequences FORCE ROW LEVEL SECURITY;

-- ============================================================
-- Partial Unique Indexes
-- ============================================================

-- One plan code per reseller (among live plans)
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_code_reseller
  ON plans (reseller_id, code) WHERE deleted_at IS NULL;

-- One active subscription per tenant (trialing/active/paused/past_due all count)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_active_tenant
  ON subscriptions (tenant_id)
  WHERE status IN ('TRIALING', 'ACTIVE', 'PAUSED', 'PAST_DUE');

-- Invoice numbers are unique per reseller
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_number_reseller
  ON invoices (reseller_id, invoice_number);

-- One default gateway config per reseller+provider
CREATE UNIQUE INDEX IF NOT EXISTS uq_gwc_default
  ON payment_gateway_configs (reseller_id, provider)
  WHERE is_default = true AND deleted_at IS NULL;

-- ============================================================
-- Performance Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant
  ON subscriptions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_reseller
  ON subscriptions (reseller_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant
  ON invoices (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_reseller
  ON invoices (reseller_id, created_at DESC);

-- Partial index for actionable invoices (sent/overdue)
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices (status) WHERE status IN ('SENT', 'OVERDUE');

CREATE INDEX IF NOT EXISTS idx_payments_invoice
  ON payments (invoice_id);

-- Partial index for gateway payment lookups (webhook idempotency)
CREATE INDEX IF NOT EXISTS idx_payments_gateway
  ON payments (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
