CREATE TYPE "SubjectType" AS ENUM('ACADEMIC', 'LANGUAGE', 'SKILL', 'EXTRACURRICULAR', 'INTERNAL_ASSESSMENT');--> statement-breakpoint
CREATE TABLE "section_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subject_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
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
ALTER TABLE "section_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "standard_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subject_id" uuid NOT NULL,
	"standard_id" uuid NOT NULL,
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
ALTER TABLE "standard_subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"short_name" text,
	"board_code" text,
	"type" "SubjectType" DEFAULT 'ACADEMIC'::"SubjectType" NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"has_practical" boolean DEFAULT false NOT NULL,
	"theory_marks" integer,
	"practical_marks" integer,
	"internal_marks" integer,
	"is_elective" boolean DEFAULT false NOT NULL,
	"elective_group" text,
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
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "section_subjects_subject_section_key" ON "section_subjects" ("subject_id","section_id");--> statement-breakpoint
CREATE INDEX "section_subjects_tenant_id_idx" ON "section_subjects" ("tenant_id");--> statement-breakpoint
CREATE INDEX "section_subjects_section_id_idx" ON "section_subjects" ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "standard_subjects_subject_standard_key" ON "standard_subjects" ("subject_id","standard_id");--> statement-breakpoint
CREATE INDEX "standard_subjects_tenant_id_idx" ON "standard_subjects" ("tenant_id");--> statement-breakpoint
CREATE INDEX "standard_subjects_standard_id_idx" ON "standard_subjects" ("standard_id");--> statement-breakpoint
CREATE INDEX "subjects_tenant_id_idx" ON "subjects" ("tenant_id");--> statement-breakpoint
CREATE INDEX "subjects_type_idx" ON "subjects" ("type");--> statement-breakpoint
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_subject_id_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_section_id_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "standard_subjects" ADD CONSTRAINT "standard_subjects_subject_id_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "standard_subjects" ADD CONSTRAINT "standard_subjects_standard_id_standards_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "standard_subjects" ADD CONSTRAINT "standard_subjects_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
CREATE POLICY "section_subjects_app_select" ON "section_subjects" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NULL
    );--> statement-breakpoint
CREATE POLICY "section_subjects_app_select_trash" ON "section_subjects" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NOT NULL
      AND current_setting('app.include_deleted', true) = 'true'
    );--> statement-breakpoint
CREATE POLICY "section_subjects_app_insert" ON "section_subjects" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );--> statement-breakpoint
CREATE POLICY "section_subjects_app_update" ON "section_subjects" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NULL
    ) WITH CHECK (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );--> statement-breakpoint
CREATE POLICY "section_subjects_app_delete" ON "section_subjects" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "section_subjects_admin_all" ON "section_subjects" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "standard_subjects_app_select" ON "standard_subjects" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NULL
    );--> statement-breakpoint
CREATE POLICY "standard_subjects_app_select_trash" ON "standard_subjects" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NOT NULL
      AND current_setting('app.include_deleted', true) = 'true'
    );--> statement-breakpoint
CREATE POLICY "standard_subjects_app_insert" ON "standard_subjects" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );--> statement-breakpoint
CREATE POLICY "standard_subjects_app_update" ON "standard_subjects" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NULL
    ) WITH CHECK (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );--> statement-breakpoint
CREATE POLICY "standard_subjects_app_delete" ON "standard_subjects" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "standard_subjects_admin_all" ON "standard_subjects" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "subjects_app_select" ON "subjects" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NULL
    );--> statement-breakpoint
CREATE POLICY "subjects_app_select_trash" ON "subjects" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NOT NULL
      AND current_setting('app.include_deleted', true) = 'true'
    );--> statement-breakpoint
CREATE POLICY "subjects_app_insert" ON "subjects" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );--> statement-breakpoint
CREATE POLICY "subjects_app_update" ON "subjects" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
      AND deleted_at IS NULL
    ) WITH CHECK (
      tenant_id = current_setting('app.current_tenant_id', true)::uuid
    );--> statement-breakpoint
CREATE POLICY "subjects_app_delete" ON "subjects" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "subjects_admin_all" ON "subjects" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);