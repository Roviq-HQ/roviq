CREATE TYPE "ComplianceReportType" AS ENUM('UDISE_DCF', 'CBSE_REGISTRATION', 'CBSE_LOC', 'BSEH_STAFF_STATEMENT', 'SHALA_DARPAN', 'RTE_REPORT', 'TC_REGISTER', 'AWR');--> statement-breakpoint
CREATE TYPE "ExportReportStatus" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
ALTER TYPE "FilePurpose" ADD VALUE 'COMPLIANCE_EXPORT';--> statement-breakpoint
CREATE TABLE "export_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"report_type" "ComplianceReportType" NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"status" "ExportReportStatus" DEFAULT 'PENDING'::"ExportReportStatus" NOT NULL,
	"workflow_id" text NOT NULL,
	"file_id" uuid,
	"row_count" integer,
	"error_code" text,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "chk_export_reports_completed" CHECK ("status" <> 'COMPLETED' OR ("file_id" IS NOT NULL AND "row_count" IS NOT NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "chk_export_reports_failed" CHECK ("status" <> 'FAILED' OR ("error_code" IS NOT NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "chk_export_reports_file_only_when_completed" CHECK ("file_id" IS NULL OR "status" = 'COMPLETED')
);
--> statement-breakpoint
ALTER TABLE "export_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "export_reports_tenant_requested_idx" ON "export_reports" ("tenant_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "export_reports_academic_year_id_idx" ON "export_reports" ("academic_year_id");--> statement-breakpoint
CREATE INDEX "export_reports_file_id_idx" ON "export_reports" ("file_id") WHERE file_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "export_reports_workflow_id_key" ON "export_reports" ("workflow_id");--> statement-breakpoint
ALTER TABLE "export_reports" ADD CONSTRAINT "export_reports_academic_year_id_academic_years_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "export_reports" ADD CONSTRAINT "export_reports_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "export_reports" ADD CONSTRAINT "export_reports_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "export_reports" ADD CONSTRAINT "export_reports_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "export_reports_live" WITH (security_invoker = true) AS (select "id", "report_type", "academic_year_id", "status", "workflow_id", "file_id", "row_count", "error_code", "requested_by", "requested_at", "completed_at", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "export_reports" where ("export_reports"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "export_reports_app_select" ON "export_reports" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "export_reports_app_insert" ON "export_reports" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "export_reports_app_update" ON "export_reports" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "export_reports_app_delete" ON "export_reports" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "export_reports_reseller_read" ON "export_reports" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "export_reports_admin_all" ON "export_reports" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "export_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "export_reports_live" TO roviq_app, roviq_reseller, roviq_admin;
