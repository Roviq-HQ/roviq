CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP VIEW "institutes_live";--> statement-breakpoint
ALTER TABLE "institutes" ADD COLUMN "supported_locales" jsonb DEFAULT '["en"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "institutes" ADD COLUMN "default_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
UPDATE "institutes" SET "supported_locales" = '["en", "hi"]'::jsonb;--> statement-breakpoint
CREATE INDEX "idx_institutes_name_gin" ON "institutes" USING gin ("name");--> statement-breakpoint
CREATE INDEX "idx_institutes_name_trgm" ON "institutes" USING gin (i18n_text_to_string("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_roles_name_gin" ON "roles" USING gin ("name");--> statement-breakpoint
CREATE INDEX "idx_roles_name_trgm" ON "roles" USING gin (i18n_text_to_string("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_sections_name_gin" ON "sections" USING gin ("name");--> statement-breakpoint
CREATE INDEX "idx_sections_name_trgm" ON "sections" USING gin (i18n_text_to_string("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_plans_name_gin" ON "plans" USING gin ("name");--> statement-breakpoint
CREATE INDEX "idx_plans_name_trgm" ON "plans" USING gin (i18n_text_to_string("name") gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "institutes" ADD CONSTRAINT "institutes_locales_valid" CHECK (jsonb_typeof("supported_locales") = 'array'
      AND "supported_locales" @> '["en"]'::jsonb
      AND "supported_locales" ? "default_locale");--> statement-breakpoint
CREATE VIEW "institutes_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "code", "type", "structure_framework", "setup_status", "contact", "address", "logo_url", "timezone", "currency", "supported_locales", "default_locale", "settings", "is_demo", "require_impersonation_consent", "departments", "status", "reseller_id", "group_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institutes" where ("institutes"."deleted_at" is null));
--> statement-breakpoint
GRANT SELECT ON "institutes_live" TO roviq_app, roviq_reseller, roviq_admin;
