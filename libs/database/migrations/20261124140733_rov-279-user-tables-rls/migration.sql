-- ROV-279: row security on the platform user tables.
-- The first line is a comment on purpose: `scripts/db-reset.ts` re-applies only migrations that
-- start with one, and the FORCE, REVOKE and column GRANT statements below are hand-written.
-- The statements for year_rollover_section_map that drizzle-kit also emitted were removed: the
-- ROV-323 migration creates that table; the ROV-330 snapshot was cut before it and lacked it.
DROP VIEW "users_live";
--> statement-breakpoint
ALTER TABLE "auth_providers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "phone_numbers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE VIEW "users_live" WITH (security_invoker = true) AS (select "id", "email", "username", "avatar_url", "preferred_locale", "status", "password_changed_at", "must_change_password", "email_verified_at", "created_at", "created_by", "updated_at", "updated_by", "deleted_at", "deleted_by", "version" from "users" where ("users"."deleted_at" is null));
--> statement-breakpoint
CREATE POLICY "auth_providers_admin_all" ON "auth_providers" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "phone_numbers_app_select" ON "phone_numbers" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));
--> statement-breakpoint
CREATE POLICY "phone_numbers_reseller_read" ON "phone_numbers" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));
--> statement-breakpoint
CREATE POLICY "phone_numbers_admin_all" ON "phone_numbers" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER POLICY "users_app_select" ON "users" TO "roviq_app" USING (id IN (
        SELECT m.user_id FROM memberships m
        WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
--> statement-breakpoint
ALTER POLICY "users_reseller_select" ON "users" TO "roviq_reseller" USING (id IN (
        SELECT m.user_id FROM memberships m
        JOIN institutes i ON i.id = m.tenant_id
        WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
      ) OR id IN (
        SELECT rm.user_id FROM reseller_memberships rm
        WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
      ));
--> statement-breakpoint
ALTER TABLE "phone_numbers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_providers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Phone numbers are written only by the platform role; institutes and resellers read them.
REVOKE INSERT, UPDATE, DELETE ON "phone_numbers" FROM roviq_app, roviq_reseller;
--> statement-breakpoint
-- Passkeys and sign-in providers belong to the platform role alone.
REVOKE ALL ON "auth_providers", "auth_providers_live" FROM roviq_app, roviq_reseller;
--> statement-breakpoint
-- password_hash and token_version are never readable by institute or reseller roles.
REVOKE SELECT ON "users" FROM roviq_app, roviq_reseller;
--> statement-breakpoint
GRANT SELECT (
  "id", "email", "username", "avatar_url", "preferred_locale", "status", "password_changed_at",
  "must_change_password", "email_verified_at", "created_at", "created_by", "updated_at",
  "updated_by", "deleted_at", "deleted_by", "version"
) ON "users" TO roviq_app, roviq_reseller;
--> statement-breakpoint
-- The view was recreated above; give it back the grants the blanket GRANT gave the old one.
GRANT SELECT ON "users_live" TO roviq_app, roviq_reseller;
--> statement-breakpoint
GRANT SELECT ON "users_live" TO roviq_admin;
