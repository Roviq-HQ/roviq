-- ROV-330: how many messages a sender may hand the provider per second.
DROP VIEW "messaging_senders_live";--> statement-breakpoint
ALTER TABLE "messaging_senders" ADD COLUMN "messages_per_second" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_senders" ADD CONSTRAINT "chk_messaging_senders_rate" CHECK ("messages_per_second" BETWEEN 1 AND 1000);--> statement-breakpoint
CREATE VIEW "messaging_senders_live" WITH (security_invoker = true) AS (select "id", "scope", "tenant_id", "channel", "provider", "provider_number_id", "display_number", "status", "daily_cap", "institute_daily_cap", "messages_per_second", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "messaging_senders" where ("messaging_senders"."deleted_at" is null));
--> statement-breakpoint
-- The view was recreated: give back the read rights of the first migration.
GRANT SELECT ON "messaging_senders_live" TO roviq_app, roviq_admin;
