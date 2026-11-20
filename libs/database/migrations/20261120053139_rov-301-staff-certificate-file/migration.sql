DROP VIEW "staff_qualifications_live";--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "certificate_file_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD CONSTRAINT "staff_qualifications_certificate_file_id_files_id_fkey" FOREIGN KEY ("certificate_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "staff_qualifications_live" WITH (security_invoker = true) AS (select "id", "staff_profile_id", "type", "degree_name", "institution", "board_university", "year_of_passing", "grade_percentage", "certificate_file_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "staff_qualifications" where ("staff_qualifications"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "staff_qualifications_live" TO roviq_app, roviq_reseller, roviq_admin;
