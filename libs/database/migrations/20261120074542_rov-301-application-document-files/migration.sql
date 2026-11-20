ALTER TYPE "FilePurpose" ADD VALUE 'APPLICATION_DOCUMENT';--> statement-breakpoint
CREATE TABLE "application_document_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_document_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP VIEW "application_documents_live";--> statement-breakpoint
ALTER TABLE "application_documents" DROP COLUMN "file_urls";--> statement-breakpoint
CREATE INDEX "application_document_files_tenant_id_idx" ON "application_document_files" ("tenant_id");--> statement-breakpoint
CREATE INDEX "application_document_files_document_id_idx" ON "application_document_files" ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_document_files_file_id_key" ON "application_document_files" ("file_id") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "application_document_files" ADD CONSTRAINT "application_document_files_MzrAsHaJCjK8_fkey" FOREIGN KEY ("document_id") REFERENCES "application_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "application_document_files" ADD CONSTRAINT "application_document_files_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "application_document_files" ADD CONSTRAINT "application_document_files_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "application_document_files_live" WITH (security_invoker = true) AS (select "id", "document_id", "file_id", "position", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "application_document_files" where ("application_document_files"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "application_documents_live" WITH (security_invoker = true) AS (select "id", "application_id", "type", "is_verified", "verified_by", "verified_at", "rejection_reason", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "application_documents" where ("application_documents"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "application_document_files_app_select" ON "application_document_files" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "application_document_files_app_insert" ON "application_document_files" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "application_document_files_app_update" ON "application_document_files" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "application_document_files_app_delete" ON "application_document_files" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "application_document_files_reseller_read" ON "application_document_files" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "application_document_files_admin_all" ON "application_document_files" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "application_document_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "application_document_files_live", "application_documents_live" TO roviq_app, roviq_reseller, roviq_admin;
