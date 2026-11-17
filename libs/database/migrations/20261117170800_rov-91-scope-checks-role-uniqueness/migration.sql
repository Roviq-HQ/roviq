CREATE UNIQUE INDEX "roles_platform_name_key" ON "roles" ("name") WHERE "scope" = 'platform' AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_reseller_id_name_key" ON "roles" ("reseller_id","name") WHERE "scope" = 'reseller' AND "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "chk_impersonator_scope" CHECK ("impersonator_scope" IN ('platform', 'reseller', 'institute'));--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "chk_refresh_token_membership_scope" CHECK ("membership_scope" IN ('platform', 'reseller', 'institute'));--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "chk_role_scope", ADD CONSTRAINT "chk_role_scope" CHECK (CASE "scope"
        WHEN 'platform'  THEN "tenant_id" IS NULL AND "reseller_id" IS NULL
        WHEN 'reseller'  THEN "tenant_id" IS NULL AND "reseller_id" IS NOT NULL
        WHEN 'institute' THEN "tenant_id" IS NOT NULL AND "reseller_id" IS NULL
        ELSE FALSE
      END);