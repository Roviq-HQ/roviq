-- ROV-314: dedupe key so a redelivered event cannot create a second notification.
-- The live view is recreated to expose the column, which drops its grants.
DROP VIEW "notifications_live";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications" ("dedupe_key");--> statement-breakpoint
CREATE VIEW "notifications_live" WITH (security_invoker = true) AS (select "id", "scope", "tenant_id", "reseller_id", "recipient_user_id", "recipient_membership_id", "type", "title", "body", "data", "dedupe_key", "read_at", "archived_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "notifications" where ("notifications"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "notifications_live" TO roviq_app, roviq_reseller, roviq_admin;
