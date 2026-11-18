DROP VIEW "resellers_live";--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "registration_state" text;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "contact" jsonb DEFAULT '{"phones":[],"emails":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "address" jsonb;--> statement-breakpoint
CREATE VIEW "resellers_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "tier", "is_system", "is_active", "status", "suspended_at", "branding", "custom_domain", "registration_number", "registration_state", "contact", "address", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "resellers" where ("resellers"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "resellers_live" TO roviq_app, roviq_reseller, roviq_admin;
