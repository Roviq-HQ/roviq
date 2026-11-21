DROP VIEW "institutes_live";--> statement-breakpoint
ALTER TABLE "institutes" ADD COLUMN "first_admin" jsonb;--> statement-breakpoint
ALTER TABLE "institute_affiliations" ALTER COLUMN "valid_from" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "institute_affiliations" ALTER COLUMN "valid_to" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tc_register_open_duplicate" ON "tc_register" ("original_tc_id") WHERE "status" = 'DUPLICATE_REQUESTED' AND "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "institutes" ADD CONSTRAINT "institutes_first_admin_valid" CHECK ("first_admin" IS NULL OR (
        jsonb_typeof("first_admin") = 'object'
        AND jsonb_typeof("first_admin" -> 'firstName') = 'string'
        AND length("first_admin" ->> 'firstName') > 0
        AND jsonb_typeof("first_admin" -> 'email') = 'string'
        AND position('@' in "first_admin" ->> 'email') > 1
      ));--> statement-breakpoint
CREATE VIEW "institutes_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "code", "type", "structure_framework", "setup_status", "contact", "address", "first_admin", "timezone", "currency", "supported_locales", "default_locale", "settings", "is_demo", "require_impersonation_consent", "departments", "status", "reseller_id", "group_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institutes" where ("institutes"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "institutes_live" TO roviq_app, roviq_reseller, roviq_admin;
