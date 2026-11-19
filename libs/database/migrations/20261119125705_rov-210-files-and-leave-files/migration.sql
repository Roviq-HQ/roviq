CREATE TYPE "FilePurpose" AS ENUM('LEAVE_ATTACHMENT', 'BULK_IMPORT_CSV', 'BULK_IMPORT_REPORT');--> statement-breakpoint
CREATE TYPE "FileStatus" AS ENUM('PENDING', 'READY', 'REJECTED', 'DELETED');--> statement-breakpoint
CREATE TYPE "FileVisibility" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"tenant_id" uuid,
	"reseller_id" uuid,
	"subject_user_id" uuid,
	"visibility" "FileVisibility" NOT NULL,
	"purpose" "FilePurpose" NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "FileStatus" DEFAULT 'PENDING'::"FileStatus" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "chk_files_owner" CHECK (num_nonnulls("tenant_id", "reseller_id", "subject_user_id") >= 1
        AND num_nonnulls("tenant_id", "reseller_id") <= 1),
	CONSTRAINT "chk_files_size" CHECK ("size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"leave_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
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
ALTER TABLE "leave_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP VIEW "leaves_live";--> statement-breakpoint
ALTER TABLE "leaves" DROP COLUMN "file_urls";--> statement-breakpoint
CREATE UNIQUE INDEX "files_object_key_key" ON "files" ("object_key");--> statement-breakpoint
CREATE INDEX "files_tenant_status_idx" ON "files" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "files_reseller_id_idx" ON "files" ("reseller_id");--> statement-breakpoint
CREATE INDEX "files_status_created_at_idx" ON "files" ("status","created_at");--> statement-breakpoint
CREATE INDEX "files_uploaded_by_status_idx" ON "files" ("uploaded_by","status");--> statement-breakpoint
CREATE INDEX "leave_files_tenant_id_idx" ON "leave_files" ("tenant_id");--> statement-breakpoint
CREATE INDEX "leave_files_leave_id_idx" ON "leave_files" ("leave_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_files_file_id_key" ON "leave_files" ("file_id") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_reseller_id_resellers_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_subject_user_id_users_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "leave_files" ADD CONSTRAINT "leave_files_leave_id_leaves_id_fkey" FOREIGN KEY ("leave_id") REFERENCES "leaves"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "leave_files" ADD CONSTRAINT "leave_files_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "leave_files" ADD CONSTRAINT "leave_files_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "files_live" WITH (security_invoker = true) AS (select "id", "tenant_id", "reseller_id", "subject_user_id", "visibility", "purpose", "object_key", "original_name", "content_type", "size_bytes", "status", "uploaded_by", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "files" where ("files"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "leave_files_live" WITH (security_invoker = true) AS (select "id", "leave_id", "file_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "leave_files" where ("leave_files"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "leaves_live" WITH (security_invoker = true) AS (select "id", "user_id", "start_date", "end_date", "type", "reason", "status", "decided_by", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "leaves" where ("leaves"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "files_app_select" ON "files" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "files_app_insert" ON "files" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "files_app_update" ON "files" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "files_app_delete" ON "files" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "files_reseller_select" ON "files" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid
      OR tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      ));--> statement-breakpoint
CREATE POLICY "files_admin_all" ON "files" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "leave_files_app_select" ON "leave_files" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "leave_files_app_insert" ON "leave_files" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "leave_files_app_update" ON "leave_files" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "leave_files_app_delete" ON "leave_files" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "leave_files_reseller_read" ON "leave_files" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "leave_files_admin_all" ON "leave_files" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "files_live", "leave_files_live", "leaves_live" TO roviq_app, roviq_reseller, roviq_admin;
