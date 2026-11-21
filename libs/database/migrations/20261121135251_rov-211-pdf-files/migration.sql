DROP VIEW "issued_certificates_live";--> statement-breakpoint
DROP VIEW "tc_register_live";--> statement-breakpoint
ALTER TABLE "issued_certificates" ADD COLUMN "pdf_file_id" uuid;--> statement-breakpoint
ALTER TABLE "tc_register" ADD COLUMN "pdf_file_id" uuid;--> statement-breakpoint
ALTER TABLE "tc_register" ADD COLUMN "verification_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tc_verification_token" ON "tc_register" ("verification_token");--> statement-breakpoint
ALTER TABLE "issued_certificates" ADD CONSTRAINT "issued_certificates_pdf_file_id_files_id_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "files"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tc_register" ADD CONSTRAINT "tc_register_pdf_file_id_files_id_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "files"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE VIEW "issued_certificates_live" WITH (security_invoker = true) AS (select "id", "template_id", "student_profile_id", "staff_profile_id", "serial_number", "status", "certificate_data", "pdf_file_id", "issued_date", "issued_by", "purpose", "valid_until", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "issued_certificates" where ("issued_certificates"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "tc_register_live" WITH (security_invoker = true) AS (select "id", "student_profile_id", "tc_serial_number", "academic_year_id", "status", "tc_data", "requested_by", "requested_at", "reason", "clearances", "generated_at", "reviewed_by", "approved_by", "approved_at", "issued_at", "issued_to", "pdf_file_id", "verification_token", "is_counter_signed", "counter_signed_by", "is_duplicate", "original_tc_id", "duplicate_reason", "duplicate_fee", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "tc_register" where ("tc_register"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "issued_certificates_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "tc_register_live" TO roviq_app, roviq_reseller, roviq_admin;
