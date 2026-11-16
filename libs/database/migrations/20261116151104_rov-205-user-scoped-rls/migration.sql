ALTER TABLE "user_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_identifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- .enableRLS() sets ENABLE only; FORCE keeps the table owner subject to the policies too.
ALTER TABLE "user_addresses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_identifiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_addresses_app_select" ON "user_addresses" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_addresses_reseller_read" ON "user_addresses" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_addresses_admin_all" ON "user_addresses" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_documents_app_select" ON "user_documents" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_documents_reseller_read" ON "user_documents" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_documents_admin_all" ON "user_documents" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_identifiers_app_select" ON "user_identifiers" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_identifiers_reseller_read" ON "user_identifiers" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_identifiers_admin_all" ON "user_identifiers" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_profiles_app_select" ON "user_profiles" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_profiles_reseller_read" ON "user_profiles" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_profiles_admin_all" ON "user_profiles" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);