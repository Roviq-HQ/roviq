ALTER TYPE "FilePurpose" ADD VALUE 'USER_DOCUMENT';--> statement-breakpoint
CREATE TABLE "user_document_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_document_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP VIEW "user_documents_live";--> statement-breakpoint
ALTER TABLE "user_documents" DROP COLUMN "file_urls";--> statement-breakpoint
CREATE INDEX "user_document_files_document_id_idx" ON "user_document_files" ("document_id");--> statement-breakpoint
CREATE INDEX "user_document_files_user_id_idx" ON "user_document_files" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_document_files_file_id_key" ON "user_document_files" ("file_id") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "user_document_files" ADD CONSTRAINT "user_document_files_document_id_user_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "user_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "user_document_files" ADD CONSTRAINT "user_document_files_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "user_document_files" ADD CONSTRAINT "user_document_files_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "user_document_files_live" WITH (security_invoker = true) AS (select "id", "document_id", "file_id", "user_id", "position", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_document_files" where ("user_document_files"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "user_documents_live" WITH (security_invoker = true) AS (select "id", "user_id", "type", "description", "reference_number", "is_verified", "verified_at", "verified_by", "rejection_reason", "expiry_date", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_documents" where ("user_documents"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "user_document_files_app_select" ON "user_document_files" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_document_files_reseller_read" ON "user_document_files" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "user_document_files_admin_all" ON "user_document_files" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "user_document_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- New tables get full app-role privileges by default; only roviq_admin writes this one.
REVOKE INSERT, UPDATE, DELETE ON "user_document_files" FROM roviq_app;--> statement-breakpoint
GRANT SELECT ON "user_document_files_live", "user_documents_live" TO roviq_app, roviq_reseller, roviq_admin;
