ALTER TYPE "FilePurpose" ADD VALUE 'INSTITUTE_LOGO';--> statement-breakpoint
ALTER TYPE "FilePurpose" ADD VALUE 'INSTITUTE_FAVICON';--> statement-breakpoint
ALTER TYPE "FilePurpose" ADD VALUE 'INSTITUTE_COVER';--> statement-breakpoint
DROP VIEW "institute_branding_live";--> statement-breakpoint
DROP VIEW "institute_group_branding_live";--> statement-breakpoint
ALTER TABLE "institute_branding" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD COLUMN "favicon_file_id" uuid;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD COLUMN "cover_image_file_id" uuid;--> statement-breakpoint
ALTER TABLE "institute_group_branding" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "institute_group_branding" ADD COLUMN "favicon_file_id" uuid;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD CONSTRAINT "institute_branding_logo_file_id_files_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD CONSTRAINT "institute_branding_favicon_file_id_files_id_fkey" FOREIGN KEY ("favicon_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD CONSTRAINT "institute_branding_cover_image_file_id_files_id_fkey" FOREIGN KEY ("cover_image_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_group_branding" ADD CONSTRAINT "institute_group_branding_logo_file_id_files_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_group_branding" ADD CONSTRAINT "institute_group_branding_favicon_file_id_files_id_fkey" FOREIGN KEY ("favicon_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "institute_branding_live" WITH (security_invoker = true) AS (select "id", "logo_file_id", "favicon_file_id", "cover_image_file_id", "primary_color", "secondary_color", "theme_identifier", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institute_branding" where ("institute_branding"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "institute_group_branding_live" WITH (security_invoker = true) AS (select "id", "group_id", "logo_file_id", "favicon_file_id", "primary_color", "secondary_color", "theme", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institute_group_branding" where ("institute_group_branding"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "institute_branding_live", "institute_group_branding_live" TO roviq_app, roviq_reseller, roviq_admin;
