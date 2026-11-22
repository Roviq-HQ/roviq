-- ROV-314: tables for the in-house notification pipeline that replaces Novu.
-- notifications: written only by the pipeline (roviq_admin); request roles read their
-- scope's rows and may set read_at / archived_at. notification_deliveries: append-only.
-- device_tokens: platform role only.
CREATE TYPE "DevicePlatform" AS ENUM('WEB', 'ANDROID', 'IOS');--> statement-breakpoint
CREATE TYPE "NotificationChannel" AS ENUM('EMAIL', 'PUSH', 'SMS', 'WHATSAPP');--> statement-breakpoint
CREATE TYPE "NotificationDeliveryStatus" AS ENUM('SENT', 'DELIVERED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" "DevicePlatform" NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"scope" varchar(20) NOT NULL,
	"tenant_id" uuid,
	"reseller_id" uuid,
	"notification_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" "NotificationChannel" NOT NULL,
	"provider" text,
	"status" "NotificationDeliveryStatus" NOT NULL,
	"skip_reason" text,
	"provider_message_id" text,
	"error_code" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_notification_deliveries_scope" CHECK (CASE "scope"
        WHEN 'institute' THEN "tenant_id" IS NOT NULL AND "reseller_id" IS NULL
        WHEN 'reseller'  THEN "reseller_id" IS NOT NULL AND "tenant_id" IS NULL
        WHEN 'platform'  THEN "tenant_id" IS NULL AND "reseller_id" IS NULL
        ELSE false
      END),
	CONSTRAINT "chk_notification_deliveries_outcome" CHECK (("status" <> 'SKIPPED' OR "skip_reason" IS NOT NULL)
        AND ("status" <> 'FAILED' OR "error_code" IS NOT NULL)),
	CONSTRAINT "chk_notification_deliveries_attempt" CHECK ("attempt" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"scope" varchar(20) NOT NULL,
	"tenant_id" uuid,
	"reseller_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"recipient_membership_id" uuid,
	"type" text NOT NULL,
	"title" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "chk_notifications_scope" CHECK (CASE "scope"
        WHEN 'institute' THEN "tenant_id" IS NOT NULL AND "reseller_id" IS NULL
        WHEN 'reseller'  THEN "reseller_id" IS NOT NULL AND "tenant_id" IS NULL
        WHEN 'platform'  THEN "tenant_id" IS NULL AND "reseller_id" IS NULL
        ELSE false
      END)
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens" ("token") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_id_idx" ON "notification_deliveries" ("tenant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries" ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_id_idx" ON "notification_deliveries" ("provider_message_id") WHERE provider_message_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_tenant_id_idx" ON "notifications" ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_inbox_idx" ON "notifications" ("recipient_user_id","tenant_id","id" DESC NULLS LAST) WHERE deleted_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" ("recipient_user_id","tenant_id") WHERE deleted_at IS NULL AND archived_at IS NULL AND read_at IS NULL;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reseller_id_resellers_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_users_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reseller_id_resellers_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "device_tokens_live" WITH (security_invoker = true) AS (select "id", "user_id", "token", "platform", "last_seen_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "device_tokens" where ("device_tokens"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "notifications_live" WITH (security_invoker = true) AS (select "id", "scope", "tenant_id", "reseller_id", "recipient_user_id", "recipient_membership_id", "type", "title", "body", "data", "read_at", "archived_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "notifications" where ("notifications"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "device_tokens_admin_all" ON "device_tokens" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "notification_deliveries_app_select" ON "notification_deliveries" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "notification_deliveries_admin_select" ON "notification_deliveries" AS PERMISSIVE FOR SELECT TO "roviq_admin" USING (true);--> statement-breakpoint
CREATE POLICY "notification_deliveries_admin_insert" ON "notification_deliveries" AS PERMISSIVE FOR INSERT TO "roviq_admin" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "notifications_app_select" ON "notifications" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "notifications_app_update" ON "notifications" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "notifications_reseller_select" ON "notifications" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (scope = 'reseller' AND reseller_id = current_setting('app.current_reseller_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "notifications_reseller_update" ON "notifications" AS PERMISSIVE FOR UPDATE TO "roviq_reseller" USING (scope = 'reseller' AND reseller_id = current_setting('app.current_reseller_id', true)::uuid) WITH CHECK (scope = 'reseller' AND reseller_id = current_setting('app.current_reseller_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "notifications_admin_all" ON "notifications" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "device_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Request roles never create or delete a notification, and change only the two
-- timestamps a recipient sets plus the bookkeeping columns every UPDATE touches.
REVOKE INSERT, UPDATE, DELETE ON "notifications" FROM roviq_app, roviq_reseller;--> statement-breakpoint
GRANT UPDATE (read_at, archived_at, updated_at, updated_by, version)
  ON "notifications" TO roviq_app, roviq_reseller;--> statement-breakpoint
GRANT SELECT ON "notifications_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint

-- Append-only: no role updates or deletes a delivery row; only the pipeline inserts.
REVOKE INSERT, UPDATE, DELETE ON "notification_deliveries" FROM roviq_app, roviq_reseller;--> statement-breakpoint
REVOKE SELECT ON "notification_deliveries" FROM roviq_reseller;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "notification_deliveries" FROM roviq_admin;--> statement-breakpoint

-- A token registered for the wrong user delivers that user's push messages elsewhere.
REVOKE ALL ON "device_tokens" FROM roviq_app, roviq_reseller;--> statement-breakpoint
GRANT SELECT ON "device_tokens_live" TO roviq_admin;
