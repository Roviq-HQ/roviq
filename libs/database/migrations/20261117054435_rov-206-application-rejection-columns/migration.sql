DROP VIEW "admission_applications_live";--> statement-breakpoint
ALTER TABLE "admission_applications" ADD COLUMN "rejection_reason" varchar(255);--> statement-breakpoint
ALTER TABLE "admission_applications" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
CREATE VIEW "admission_applications_live" WITH (security_invoker = true) AS (select "id", "enquiry_id", "academic_year_id", "standard_id", "section_id", "form_data", "status", "is_rte_application", "rte_lottery_rank", "test_score", "interview_score", "merit_rank", "offered_at", "offer_expires_at", "offer_accepted_at", "rejection_reason", "rejected_at", "student_profile_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "admission_applications" where ("admission_applications"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "admission_applications_live" TO roviq_app, roviq_reseller, roviq_admin;
