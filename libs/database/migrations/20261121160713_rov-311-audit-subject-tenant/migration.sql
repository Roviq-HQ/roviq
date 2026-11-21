-- Custom on purpose (first line is a comment): `db-reset` replays custom migrations after
-- `drizzle-kit push`, and the audit-logs-infra migration it replays re-creates the audit
-- policies with their original text. Running after it, this file puts the new read policy back.
-- The first three statements then find their objects already there, which the replay tolerates.
ALTER TABLE "audit_logs" ADD COLUMN "subject_tenant_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_logs_subject_tenant_idx" ON "audit_logs" ("subject_tenant_id","created_at") WHERE "subject_tenant_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "chk_audit_subject_tenant" CHECK ("subject_tenant_id" IS NULL OR "scope" <> 'institute');--> statement-breakpoint
ALTER POLICY "audit_app_read" ON "audit_logs" TO "roviq_app" USING ((scope = 'institute' AND tenant_id = current_setting('app.current_tenant_id', true)::uuid) OR subject_tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
-- A reseller-scoped row may name only an institute of that reseller. The gateway already
-- names an institute only after the action succeeded; this keeps a row from landing in the
-- audit log of an institute the reseller does not own if that check is ever missed. The
-- subject is cleared instead of raising, so one bad row cannot fail a whole insert batch.
CREATE OR REPLACE FUNCTION audit_logs_check_subject_tenant() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.subject_tenant_id IS NOT NULL AND NEW.scope = 'reseller' AND NOT EXISTS (
    SELECT 1 FROM institutes i
    WHERE i.id = NEW.subject_tenant_id AND i.reseller_id = NEW.reseller_id
  ) THEN
    NEW.subject_tenant_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_audit_logs_check_subject_tenant ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER trg_audit_logs_check_subject_tenant
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_check_subject_tenant();
