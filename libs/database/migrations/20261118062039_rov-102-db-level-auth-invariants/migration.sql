DROP POLICY "impersonation_sessions_app_insert" ON "impersonation_sessions";--> statement-breakpoint
DROP POLICY "impersonation_sessions_reseller_all" ON "impersonation_sessions";--> statement-breakpoint
DROP POLICY "institutes_reseller_all" ON "institutes";--> statement-breakpoint
-- Legacy rows: a revoked token without a reason is treated as rotation, which is how the
-- refresh path already read it; a live token never carries a reason.
UPDATE "refresh_tokens" SET "revoked_reason" = 'rotation' WHERE "revoked_at" IS NOT NULL AND "revoked_reason" IS NULL;--> statement-breakpoint
UPDATE "refresh_tokens" SET "revoked_reason" = NULL WHERE "revoked_at" IS NULL AND "revoked_reason" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "chk_refresh_token_revoked_reason" CHECK (("revoked_at" IS NULL AND "revoked_reason" IS NULL)
        OR ("revoked_at" IS NOT NULL
          AND "revoked_reason" IS NOT NULL
          AND "revoked_reason" IN ('rotation', 'user_initiated', 'password_change', 'admin_revoked')));--> statement-breakpoint
CREATE POLICY "impersonation_sessions_reseller_select" ON "impersonation_sessions" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (target_tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      ));--> statement-breakpoint
CREATE POLICY "institutes_reseller_select" ON "institutes" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "institutes_reseller_insert" ON "institutes" AS PERMISSIVE FOR INSERT TO "roviq_reseller" WITH CHECK (reseller_id = current_setting('app.current_reseller_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "institutes_reseller_update" ON "institutes" AS PERMISSIVE FOR UPDATE TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid) WITH CHECK (reseller_id = current_setting('app.current_reseller_id', true)::uuid);--> statement-breakpoint
ALTER POLICY "impersonation_sessions_app_select" ON "impersonation_sessions" TO "roviq_app" USING (target_tenant_id = current_setting('app.current_tenant_id', true)::uuid);