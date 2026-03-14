-- Enable RLS on billing tables and add tenant isolation + admin bypass policies.
-- subscription_plans intentionally omitted — it is platform-level (no organization_id).

-- subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_subscriptions ON subscriptions
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY admin_platform_access_subscriptions ON subscriptions
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoices ON invoices
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY admin_platform_access_invoices ON invoices
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- payment_gateway_configs
ALTER TABLE payment_gateway_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payment_gateway_configs ON payment_gateway_configs
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY admin_platform_access_payment_gateway_configs ON payment_gateway_configs
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- payment_events (organization_id is nullable — rows with NULL org_id are
-- visible only to platform admins via the admin bypass policy)
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payment_events ON payment_events
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY admin_platform_access_payment_events ON payment_events
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- Migrate existing snake_case featureLimits keys to camelCase in subscription_plans.
-- Handles: max_users → maxUsers, max_sections → maxSections, max_storage_gb → maxStorageGb
UPDATE subscription_plans
SET feature_limits = (
  SELECT jsonb_object_agg(
    CASE key
      WHEN 'max_users' THEN 'maxUsers'
      WHEN 'max_sections' THEN 'maxSections'
      WHEN 'max_storage_gb' THEN 'maxStorageGb'
      ELSE key
    END,
    value
  )
  FROM jsonb_each(feature_limits)
)
WHERE feature_limits::text ~ '"max_';
