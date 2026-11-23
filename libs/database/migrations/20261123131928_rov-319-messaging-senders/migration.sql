CREATE TYPE "MessagingSenderStatus" AS ENUM('ACTIVE', 'PAUSED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "messaging_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"sender_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"recipient_phone" text,
	"provider_user_id" text,
	"auto_reply_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_inbound_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"sender_id" uuid NOT NULL,
	"channel" "NotificationChannel" NOT NULL,
	"recipient_phone" text,
	"provider_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_messaging_opt_outs_recipient" CHECK ("recipient_phone" IS NOT NULL OR "provider_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "messaging_opt_outs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_sender_secrets" (
	"sender_id" uuid PRIMARY KEY,
	"access_token_encrypted" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_sender_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_senders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"scope" varchar(20) NOT NULL,
	"tenant_id" uuid,
	"channel" "NotificationChannel" NOT NULL,
	"provider" text NOT NULL,
	"provider_number_id" text NOT NULL,
	"display_number" text NOT NULL,
	"status" "MessagingSenderStatus" DEFAULT 'ACTIVE'::"MessagingSenderStatus" NOT NULL,
	"daily_cap" integer NOT NULL,
	"institute_daily_cap" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "chk_messaging_senders_scope" CHECK (CASE "scope"
        WHEN 'institute' THEN "tenant_id" IS NOT NULL
        WHEN 'platform'  THEN "tenant_id" IS NULL
        ELSE false
      END),
	CONSTRAINT "chk_messaging_senders_caps" CHECK ("daily_cap" > 0 AND ("institute_daily_cap" IS NULL OR "institute_daily_cap" > 0))
);
--> statement-breakpoint
ALTER TABLE "messaging_senders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "sender_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "template_category" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_inbound_events_event_key" ON "messaging_inbound_events" ("sender_id","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_inbound_events_auto_reply_key" ON "messaging_inbound_events" ("sender_id",COALESCE("recipient_phone", "provider_user_id"),"auto_reply_day") WHERE auto_reply_day IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messaging_inbound_events_sender_user_idx" ON "messaging_inbound_events" ("sender_id","provider_user_id") WHERE provider_user_id IS NOT NULL AND recipient_phone IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messaging_opt_outs_sender_phone_idx" ON "messaging_opt_outs" ("sender_id","recipient_phone") WHERE recipient_phone IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messaging_opt_outs_sender_user_idx" ON "messaging_opt_outs" ("sender_id","provider_user_id") WHERE provider_user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_senders_provider_number_key" ON "messaging_senders" ("provider","provider_number_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_senders_platform_channel_key" ON "messaging_senders" ("channel") WHERE deleted_at IS NULL AND scope = 'platform';--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_senders_tenant_channel_key" ON "messaging_senders" ("tenant_id","channel") WHERE deleted_at IS NULL AND scope = 'institute';--> statement-breakpoint
CREATE INDEX "messaging_senders_tenant_id_idx" ON "messaging_senders" ("tenant_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_sender_sent_idx" ON "notification_deliveries" ("sender_id","created_at" DESC NULLS LAST) WHERE sender_id IS NOT NULL AND status = 'SENT';--> statement-breakpoint
ALTER TABLE "messaging_inbound_events" ADD CONSTRAINT "messaging_inbound_events_sender_id_messaging_senders_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "messaging_senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_opt_outs" ADD CONSTRAINT "messaging_opt_outs_sender_id_messaging_senders_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "messaging_senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_sender_secrets" ADD CONSTRAINT "messaging_sender_secrets_sender_id_messaging_senders_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "messaging_senders"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_senders" ADD CONSTRAINT "messaging_senders_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_sender_id_messaging_senders_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "messaging_senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "messaging_senders_live" WITH (security_invoker = true) AS (select "id", "scope", "tenant_id", "channel", "provider", "provider_number_id", "display_number", "status", "daily_cap", "institute_daily_cap", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "messaging_senders" where ("messaging_senders"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "messaging_inbound_events_admin_select" ON "messaging_inbound_events" AS PERMISSIVE FOR SELECT TO "roviq_admin" USING (true);--> statement-breakpoint
CREATE POLICY "messaging_inbound_events_admin_insert" ON "messaging_inbound_events" AS PERMISSIVE FOR INSERT TO "roviq_admin" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "messaging_opt_outs_admin_select" ON "messaging_opt_outs" AS PERMISSIVE FOR SELECT TO "roviq_admin" USING (true);--> statement-breakpoint
CREATE POLICY "messaging_opt_outs_admin_insert" ON "messaging_opt_outs" AS PERMISSIVE FOR INSERT TO "roviq_admin" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "messaging_sender_secrets_admin_all" ON "messaging_sender_secrets" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "messaging_senders_app_select" ON "messaging_senders" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "messaging_senders_reseller_none" ON "messaging_senders" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (false);--> statement-breakpoint
CREATE POLICY "messaging_senders_admin_all" ON "messaging_senders" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "messaging_senders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_sender_secrets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_opt_outs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_inbound_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- A sender is written by the platform only; an institute reads its own row, a reseller none.
REVOKE INSERT, UPDATE, DELETE ON "messaging_senders" FROM roviq_app, roviq_reseller;--> statement-breakpoint
REVOKE SELECT ON "messaging_senders" FROM roviq_reseller;--> statement-breakpoint
GRANT SELECT ON "messaging_senders_live" TO roviq_app, roviq_admin;--> statement-breakpoint

-- The access token: request roles hold no right at all.
REVOKE ALL ON "messaging_sender_secrets" FROM roviq_app, roviq_reseller;--> statement-breakpoint

-- Append-only, and platform role only: an opt-out holds a phone number.
REVOKE ALL ON "messaging_opt_outs" FROM roviq_app, roviq_reseller;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "messaging_opt_outs" FROM roviq_admin;--> statement-breakpoint
REVOKE ALL ON "messaging_inbound_events" FROM roviq_app, roviq_reseller;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "messaging_inbound_events" FROM roviq_admin;
