DROP VIEW "files_live";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "variants" jsonb;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "placeholder" text;--> statement-breakpoint
CREATE VIEW "files_live" WITH (security_invoker = true) AS (select "id", "tenant_id", "reseller_id", "subject_user_id", "visibility", "purpose", "object_key", "original_name", "content_type", "size_bytes", "width", "height", "variants", "placeholder", "status", "uploaded_by", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "files" where ("files"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "files_live" TO roviq_app, roviq_reseller, roviq_admin;
