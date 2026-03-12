-- ============================================
-- Create institute_notification_configs table
-- Per-institute notification channel settings
-- ============================================

CREATE TABLE institute_notification_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  digest_enabled BOOLEAN NOT NULL DEFAULT false,
  digest_cron TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT institute_notification_configs_pkey PRIMARY KEY (id),
  CONSTRAINT institute_notification_configs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES organizations(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique: one config per notification type per tenant
CREATE UNIQUE INDEX institute_notification_configs_tenant_id_notification_type_key
  ON institute_notification_configs (tenant_id, notification_type);

-- Tenant lookup index
CREATE INDEX institute_notification_configs_tenant_id_idx
  ON institute_notification_configs (tenant_id);

-- ============================================
-- Row-Level Security
-- Follows existing pattern from:
--   20260310100000_fix_rls_nullif_cast (NULLIF wrapping)
--   20260306061000_policy_based_admin_bypass (admin string comparison)
-- ============================================

ALTER TABLE institute_notification_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE institute_notification_configs FORCE ROW LEVEL SECURITY;

-- Tenants can only access their own notification configs
CREATE POLICY tenant_isolation_institute_notification_configs
  ON institute_notification_configs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Admin bypass: platform admins can access all tenants' configs
CREATE POLICY admin_platform_access_institute_notification_configs
  ON institute_notification_configs
  USING (current_setting('app.is_platform_admin', true) = 'true');
