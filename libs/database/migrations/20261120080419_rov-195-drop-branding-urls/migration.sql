DROP VIEW "institute_branding_live";--> statement-breakpoint
DROP VIEW "institute_group_branding_live";--> statement-breakpoint
DROP VIEW "institutes_live";--> statement-breakpoint
ALTER TABLE "institute_branding" DROP COLUMN "logo_url";--> statement-breakpoint
ALTER TABLE "institute_branding" DROP COLUMN "favicon_url";--> statement-breakpoint
ALTER TABLE "institute_branding" DROP COLUMN "cover_image_url";--> statement-breakpoint
ALTER TABLE "institute_group_branding" DROP COLUMN "logo_url";--> statement-breakpoint
ALTER TABLE "institute_group_branding" DROP COLUMN "favicon_url";--> statement-breakpoint
ALTER TABLE "institutes" DROP COLUMN "logo_url";--> statement-breakpoint
CREATE VIEW "institute_branding_live" WITH (security_invoker = true) AS (select "id", "primary_color", "secondary_color", "theme_identifier", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institute_branding" where ("institute_branding"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "institute_group_branding_live" WITH (security_invoker = true) AS (select "id", "group_id", "primary_color", "secondary_color", "theme", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institute_group_branding" where ("institute_group_branding"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "institutes_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "code", "type", "structure_framework", "setup_status", "contact", "address", "timezone", "currency", "supported_locales", "default_locale", "settings", "is_demo", "require_impersonation_consent", "departments", "status", "reseller_id", "group_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institutes" where ("institutes"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "institute_branding_live", "institute_group_branding_live", "institutes_live" TO roviq_app, roviq_reseller, roviq_admin;
