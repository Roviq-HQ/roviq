-- ============================================
-- Create append-only audit_logs table
-- Partitioned monthly, RLS-protected, immutable
-- ============================================

-- Parent table (partitioned by month on created_at)
CREATE TABLE audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  impersonator_id UUID,
  action VARCHAR(100) NOT NULL,
  action_type VARCHAR(20) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  changes JSONB,
  metadata JSONB,
  correlation_id UUID NOT NULL,
  ip_address INET,
  user_agent TEXT,
  source VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Initial partition for March 2026
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Next month partition (April 2026) — pre-created for safety
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- ============================================
-- Indexes
-- ============================================

-- Entity timeline: "show me all changes to this student"
CREATE INDEX idx_audit_entity ON audit_logs (tenant_id, entity_type, entity_id, created_at DESC);

-- User activity: "show me everything this user did"
CREATE INDEX idx_audit_user ON audit_logs (tenant_id, user_id, created_at DESC);

-- Impersonation audit: "show all impersonated actions"
CREATE INDEX idx_audit_impersonation ON audit_logs (tenant_id, impersonator_id)
  WHERE impersonator_id IS NOT NULL;

-- Correlation tracing: "show all audit entries for this request"
CREATE INDEX idx_audit_correlation ON audit_logs (correlation_id);

-- Action filtering: "show all DELETE operations"
CREATE INDEX idx_audit_action_type ON audit_logs (tenant_id, action_type, created_at DESC);

-- ============================================
-- Row-Level Security
-- Follows existing pattern from:
--   20260310100000_fix_rls_nullif_cast (NULLIF wrapping)
--   20260306061000_policy_based_admin_bypass (admin string comparison)
-- ============================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Tenants can only read their own audit logs
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  FOR SELECT USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Admin bypass: platform admins can read all tenants' logs
CREATE POLICY admin_platform_access_audit_logs ON audit_logs
  FOR SELECT USING (current_setting('app.is_platform_admin', true) = 'true');

-- Insert allowed for the application role (consumer writes via raw SQL)
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT WITH CHECK (true);

-- ============================================
-- Immutability: append-only — no UPDATE or DELETE
-- Target role: roviq_app (the application runtime role)
-- ============================================
REVOKE UPDATE, DELETE ON audit_logs FROM roviq_app;
