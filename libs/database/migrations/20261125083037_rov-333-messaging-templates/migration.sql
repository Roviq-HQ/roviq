-- ROV-333: the provider account of each sender, and what the provider holds of each template.
CREATE TYPE "MessageTemplateStatus" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "messaging_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"provider_account_id" text NOT NULL,
	"name" text NOT NULL,
	"language" varchar(8) NOT NULL,
	"declared_category" text NOT NULL,
	"approved_category" text,
	"content_hash" text NOT NULL,
	"provider_template_id" text,
	"status" "MessageTemplateStatus" DEFAULT 'PENDING'::"MessageTemplateStatus" NOT NULL,
	"rejected_reason" text,
	"quality" text,
	"suggested_category" text,
	"out_of_step" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP VIEW "messaging_senders_live";--> statement-breakpoint
ALTER TABLE "messaging_senders" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_templates_account_name_language_key" ON "messaging_templates" ("provider_account_id","name","language");--> statement-breakpoint
CREATE VIEW "messaging_senders_live" WITH (security_invoker = true) AS (select "id", "scope", "tenant_id", "channel", "provider", "provider_number_id", "provider_account_id", "display_number", "status", "daily_cap", "institute_daily_cap", "messages_per_second", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "messaging_senders" where ("messaging_senders"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "messaging_templates_app_select" ON "messaging_templates" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (provider_account_id IN (
        SELECT s.provider_account_id FROM messaging_senders s
         WHERE s.scope = 'institute'
           AND s.deleted_at IS NULL
           AND s.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));--> statement-breakpoint
CREATE POLICY "messaging_templates_reseller_none" ON "messaging_templates" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (false);--> statement-breakpoint
CREATE POLICY "messaging_templates_admin_all" ON "messaging_templates" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);