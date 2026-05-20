-- Move billing soft-delete visibility from RLS to *_live security_invoker
-- views, matching the convention every other soft-deletable table follows.
-- Without this, soft-delete UPDATEs on plans/payment_gateway_configs fail
-- because PG re-applies SELECT policies to the post-update row (the
-- "can't UPDATE a row into invisibility" rule) and the legacy policies
-- filter `deleted_at IS NULL`.
--
-- Guarded: only runs when EE billing tables exist (ROVIQ_EE=true environments).
-- Matches the pattern in 20260323125226_billing-grants-rls-indexes.

DO $billing_views$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'plans') THEN
    RAISE NOTICE 'Skipping billing soft-delete views — plans table not found (EE disabled)';
    RETURN;
  END IF;

  -- 1. Drop legacy policies that filter on deleted_at.
  EXECUTE 'DROP POLICY IF EXISTS plan_reseller_select ON plans';
  EXECUTE 'DROP POLICY IF EXISTS plan_reseller_trash ON plans';
  EXECUTE 'DROP POLICY IF EXISTS plan_app_read ON plans';
  EXECUTE 'DROP POLICY IF EXISTS gwc_reseller_all ON payment_gateway_configs';

  -- 2. Recreate without the deleted_at filter — soft-delete visibility moves
  --    to the *_live views below.
  EXECUTE $exec$
    CREATE POLICY plan_reseller_select ON plans
      FOR SELECT TO roviq_reseller
      USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid)
  $exec$;

  EXECUTE $exec$
    CREATE POLICY plan_app_read ON plans
      FOR SELECT TO roviq_app
      USING (
        id IN (
          SELECT plan_id FROM subscriptions
          WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
      )
  $exec$;

  EXECUTE $exec$
    CREATE POLICY gwc_reseller_all ON payment_gateway_configs
      FOR ALL TO roviq_reseller
      USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid)
      WITH CHECK (reseller_id = current_setting('app.current_reseller_id', true)::uuid)
  $exec$;

  -- 3. Create the live views. security_invoker=true so SELECT runs RLS as the
  --    calling DB role, not the view owner — without it, an roviq_app
  --    connection could read other tenants' rows through the view.
  EXECUTE $exec$
    CREATE OR REPLACE VIEW plans_live
      WITH (security_invoker = true) AS
      SELECT * FROM plans WHERE deleted_at IS NULL
  $exec$;

  EXECUTE $exec$
    CREATE OR REPLACE VIEW payment_gateway_configs_live
      WITH (security_invoker = true) AS
      SELECT * FROM payment_gateway_configs WHERE deleted_at IS NULL
  $exec$;

  EXECUTE 'GRANT SELECT ON plans_live TO roviq_app, roviq_reseller, roviq_admin';
  EXECUTE 'GRANT SELECT ON payment_gateway_configs_live TO roviq_reseller, roviq_admin';
END $billing_views$;
