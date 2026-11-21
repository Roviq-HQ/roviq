DROP VIEW "institutes_live";--> statement-breakpoint
ALTER TABLE "institutes" DROP CONSTRAINT "institutes_first_admin_valid";--> statement-breakpoint
ALTER TABLE "institutes" DROP COLUMN "first_admin";--> statement-breakpoint
CREATE VIEW "institutes_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "code", "type", "structure_framework", "setup_status", "contact", "address", "timezone", "currency", "supported_locales", "default_locale", "settings", "is_demo", "require_impersonation_consent", "departments", "status", "reseller_id", "group_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institutes" where ("institutes"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "institutes_live" TO roviq_app, roviq_reseller, roviq_admin;
