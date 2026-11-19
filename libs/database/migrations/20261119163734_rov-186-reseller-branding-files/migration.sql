-- ROV-186: a reseller uploads its own logo and favicon.
-- `reseller_own_update` on resellers already exists (20261119102612); the snapshot of the
-- storage migrations was taken before it merged, so it is not created again here.

ALTER TYPE "FilePurpose" ADD VALUE 'RESELLER_LOGO';
--> statement-breakpoint
ALTER TYPE "FilePurpose" ADD VALUE 'RESELLER_FAVICON';
--> statement-breakpoint
DROP VIEW "resellers_live";
--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "logo_file_id" uuid;
--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "favicon_file_id" uuid;
--> statement-breakpoint
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_logo_file_id_files_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_favicon_file_id_files_id_fkey" FOREIGN KEY ("favicon_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
--> statement-breakpoint
CREATE VIEW "resellers_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "tier", "is_system", "is_active", "status", "suspended_at", "branding", "logo_file_id", "favicon_file_id", "custom_domain", "registration_number", "registration_state", "contact", "address", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "resellers" where ("resellers"."deleted_at" is null));
--> statement-breakpoint
CREATE POLICY "files_reseller_insert" ON "files" AS PERMISSIVE FOR INSERT TO "roviq_reseller" WITH CHECK (reseller_id = current_setting('app.current_reseller_id', true)::uuid
  AND tenant_id IS NULL);
--> statement-breakpoint
CREATE POLICY "files_reseller_update" ON "files" AS PERMISSIVE FOR UPDATE TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid
  AND tenant_id IS NULL) WITH CHECK (reseller_id = current_setting('app.current_reseller_id', true)::uuid
  AND tenant_id IS NULL);
--> statement-breakpoint

-- A reseller writes only files it owns itself; the two policies above limit the rows.
GRANT INSERT, UPDATE ON files TO roviq_reseller;
--> statement-breakpoint

-- The two new columns join the settings columns a reseller may edit on its own record.
GRANT UPDATE (logo_file_id, favicon_file_id) ON resellers TO roviq_reseller;
--> statement-breakpoint

-- Typed logo and favicon URLs are replaced by uploaded files.
UPDATE resellers
   SET branding = branding - 'logoUrl' - 'faviconUrl'
 WHERE branding ?| ARRAY['logoUrl', 'faviconUrl'];
