-- Custom on purpose (first line is a comment): `db-reset` replays custom migrations after
-- `drizzle-kit push`, and the audit-logs-infra migration it replays re-creates the audit
-- policies with their original text. Running after it, this file puts the new read policy back.
-- The first three statements then find their objects already there, which the replay tolerates.
ALTER TABLE "audit_logs" ADD COLUMN "subject_tenant_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_logs_subject_tenant_idx" ON "audit_logs" ("subject_tenant_id","created_at") WHERE "subject_tenant_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_subject_tenant" CHECK ("subject_tenant_id" IS NULL OR "scope" <> 'institute');--> statement-breakpoint
ALTER POLICY "audit_app_read" ON "audit_logs" TO "roviq_app" USING ((scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid) OR subject_tenant_id = current_setting('app.current_tenant_id', true)::uuid);