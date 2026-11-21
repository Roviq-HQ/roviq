DROP VIEW "users_live";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE VIEW "users_live" WITH (security_invoker = true) AS (select "id", "email", "username", "password_hash", "avatar_url", "preferred_locale", "status", "password_changed_at", "must_change_password", "email_verified_at", "token_version", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "users" where ("users"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "users_live" TO roviq_app, roviq_reseller, roviq_admin;
