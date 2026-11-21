DROP VIEW "institutes_live";--> statement-breakpoint
ALTER TABLE "institutes" ADD COLUMN "first_admin_user_id" uuid;--> statement-breakpoint
ALTER TABLE "institutes" ADD CONSTRAINT "institutes_first_admin_user_id_users_id_fkey" FOREIGN KEY ("first_admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "institutes_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "code", "type", "structure_framework", "setup_status", "contact", "address", "first_admin_user_id", "timezone", "currency", "supported_locales", "default_locale", "settings", "is_demo", "require_impersonation_consent", "departments", "status", "reseller_id", "group_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institutes" where ("institutes"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "institutes_live" TO roviq_app, roviq_reseller, roviq_admin;
