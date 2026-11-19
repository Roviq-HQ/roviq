ALTER TYPE "FilePurpose" ADD VALUE 'PROFILE_PHOTO';--> statement-breakpoint
DROP VIEW "user_profiles_live";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP COLUMN "profile_image_url";--> statement-breakpoint
CREATE VIEW "user_profiles_live" WITH (security_invoker = true) AS (select "id", "user_id", "first_name", "last_name", "gender", "date_of_birth", "blood_group", "nationality", "religion", "mother_tongue", "cover_image_url", "search_vector", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_profiles" where ("user_profiles"."deleted_at" is null));--> statement-breakpoint
ALTER POLICY "files_app_select" ON "files" TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
)));--> statement-breakpoint
ALTER POLICY "files_app_insert" ON "files" TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
)));--> statement-breakpoint
ALTER POLICY "files_app_update" ON "files" TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
))) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
)));--> statement-breakpoint
ALTER POLICY "files_reseller_select" ON "files" TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid
      OR tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      )
      OR (tenant_id IS NULL AND reseller_id IS NULL AND (
        subject_user_id IN (
          SELECT m.user_id FROM memberships m
          JOIN institutes i ON i.id = m.tenant_id
          WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        )
        OR subject_user_id IN (
          SELECT rm.user_id FROM reseller_memberships rm
          WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        )
      )));