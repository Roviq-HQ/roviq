DROP POLICY "institute_group_branding_app_insert" ON "institute_group_branding";--> statement-breakpoint
DROP POLICY "institute_group_branding_app_update" ON "institute_group_branding";--> statement-breakpoint
DROP POLICY "institute_group_branding_app_delete" ON "institute_group_branding";--> statement-breakpoint
ALTER POLICY "audit_app_insert" ON "audit_logs" TO "roviq_app" WITH CHECK (scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
ALTER POLICY "audit_reseller_insert" ON "audit_logs" TO "roviq_reseller" WITH CHECK (scope = 'reseller' AND reseller_id = current_setting('app.current_reseller_id', true)::uuid);--> statement-breakpoint
ALTER POLICY "institute_group_branding_app_select" ON "institute_group_branding" TO "roviq_app" USING (group_id = (
        SELECT group_id FROM institutes
        WHERE id = current_setting('app.current_tenant_id', true)::uuid
      ));