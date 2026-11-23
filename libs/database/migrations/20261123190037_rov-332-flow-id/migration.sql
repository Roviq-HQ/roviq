-- ROV-332: the delivery flow (workflow id) on in-app rows and delivery rows.
-- The first line is a comment on purpose: `scripts/db-reset.ts` re-applies only migrations that
-- start with one, and the GRANT at the end is needed after the view is created again.
DROP VIEW "notifications_live";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "flow_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "flow_id" text;--> statement-breakpoint
CREATE VIEW "notifications_live" WITH (security_invoker = true) AS (select "id", "scope", "tenant_id", "reseller_id", "recipient_user_id", "recipient_membership_id", "type", "title", "body", "data", "dedupe_key", "flow_id", "read_at", "archived_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "notifications" where ("notifications"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "notifications_live" TO roviq_app, roviq_reseller, roviq_admin;
