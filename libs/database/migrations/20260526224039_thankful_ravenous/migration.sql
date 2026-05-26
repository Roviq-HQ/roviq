CREATE TYPE "DaySession" AS ENUM('MORNING', 'MAIN', 'EVENING');--> statement-breakpoint
CREATE TYPE "PeriodKind" AS ENUM('PERIOD', 'BREAK', 'EXTRA');--> statement-breakpoint
CREATE TYPE "TimetableOverrideType" AS ENUM('SUBSTITUTION', 'CANCELLATION', 'ROOM_CHANGE', 'SUBJECT_CHANGE', 'EXTRA');--> statement-breakpoint
CREATE TYPE "TimetableStatus" AS ENUM('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "Weekday" AS ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');--> statement-breakpoint
CREATE TABLE "timetable_day_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"timetable_id" uuid NOT NULL,
	"date" date NOT NULL,
	"section_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"split_index" integer DEFAULT 0 NOT NULL,
	"override_type" "TimetableOverrideType" NOT NULL,
	"subject_id" uuid,
	"teacher_id" uuid,
	"room" text,
	"original_subject_id" uuid,
	"original_teacher_id" uuid,
	"reason" text,
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
ALTER TABLE "timetable_day_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"timetable_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"day_of_week" "Weekday" NOT NULL,
	"split_index" integer DEFAULT 0 NOT NULL,
	"split_label" text,
	"subject_id" uuid,
	"teacher_id" uuid,
	"room" text,
	"notes" text,
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
ALTER TABLE "timetable_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timetable_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"timetable_id" uuid NOT NULL,
	"kind" "PeriodKind" NOT NULL,
	"label" text NOT NULL,
	"sequence" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"session" "DaySession" DEFAULT 'MAIN'::"DaySession" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "timetable_periods_time_order_check" CHECK ("end_time" > "start_time")
);
--> statement-breakpoint
ALTER TABLE "timetable_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timetable_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"timetable_id" uuid NOT NULL,
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
ALTER TABLE "timetable_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timetables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"academic_year_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"description" text,
	"status" "TimetableStatus" DEFAULT 'DRAFT'::"TimetableStatus" NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date NOT NULL,
	"working_days" "Weekday"[] DEFAULT '{MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY}'::"Weekday"[] NOT NULL,
	"day_start_time" time NOT NULL,
	"default_period_duration_mins" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "timetables_date_range_check" CHECK ("effective_from" <= "effective_to")
);
--> statement-breakpoint
ALTER TABLE "timetables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_day_overrides_cell_key" ON "timetable_day_overrides" ("timetable_id","date","section_id","period_id","split_index") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "timetable_day_overrides_tenant_id_idx" ON "timetable_day_overrides" ("tenant_id");--> statement-breakpoint
CREATE INDEX "timetable_day_overrides_timetable_date_idx" ON "timetable_day_overrides" ("timetable_id","date");--> statement-breakpoint
CREATE INDEX "timetable_day_overrides_section_date_idx" ON "timetable_day_overrides" ("section_id","date");--> statement-breakpoint
CREATE INDEX "timetable_day_overrides_teacher_id_idx" ON "timetable_day_overrides" ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_entries_cell_key" ON "timetable_entries" ("timetable_id","section_id","period_id","day_of_week","split_index") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_entries_teacher_slot_key" ON "timetable_entries" ("timetable_id","period_id","day_of_week","teacher_id") WHERE "teacher_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "timetable_entries_tenant_id_idx" ON "timetable_entries" ("tenant_id");--> statement-breakpoint
CREATE INDEX "timetable_entries_timetable_section_idx" ON "timetable_entries" ("timetable_id","section_id");--> statement-breakpoint
CREATE INDEX "timetable_entries_teacher_id_idx" ON "timetable_entries" ("teacher_id");--> statement-breakpoint
CREATE INDEX "timetable_entries_section_id_idx" ON "timetable_entries" ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_periods_timetable_sequence_key" ON "timetable_periods" ("timetable_id","sequence") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_periods_timetable_label_key" ON "timetable_periods" ("timetable_id","label") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "timetable_periods_tenant_id_idx" ON "timetable_periods" ("tenant_id");--> statement-breakpoint
CREATE INDEX "timetable_periods_timetable_id_idx" ON "timetable_periods" ("timetable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_sections_timetable_section_key" ON "timetable_sections" ("timetable_id","section_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "timetable_sections_tenant_id_idx" ON "timetable_sections" ("tenant_id");--> statement-breakpoint
CREATE INDEX "timetable_sections_timetable_id_idx" ON "timetable_sections" ("timetable_id");--> statement-breakpoint
CREATE INDEX "timetable_sections_section_id_idx" ON "timetable_sections" ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetables_active_per_year_key" ON "timetables" ("tenant_id","academic_year_id") WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "timetables_tenant_year_name_key" ON "timetables" ("tenant_id","academic_year_id","name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "timetables_tenant_id_idx" ON "timetables" ("tenant_id");--> statement-breakpoint
CREATE INDEX "timetables_academic_year_id_idx" ON "timetables" ("academic_year_id");--> statement-breakpoint
CREATE INDEX "timetables_status_idx" ON "timetables" ("status");--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_timetable_id_timetables_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_section_id_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_period_id_timetable_periods_id_fkey" FOREIGN KEY ("period_id") REFERENCES "timetable_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_subject_id_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_teacher_id_memberships_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_timetable_id_timetables_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_period_id_timetable_periods_id_fkey" FOREIGN KEY ("period_id") REFERENCES "timetable_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_id_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_id_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_memberships_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_timetable_id_timetables_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_sections" ADD CONSTRAINT "timetable_sections_timetable_id_timetables_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_sections" ADD CONSTRAINT "timetable_sections_section_id_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_sections" ADD CONSTRAINT "timetable_sections_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_academic_year_id_academic_years_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "timetable_day_overrides_live" WITH (security_invoker = true) AS (select "id", "timetable_id", "date", "section_id", "period_id", "split_index", "override_type", "subject_id", "teacher_id", "room", "original_subject_id", "original_teacher_id", "reason", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "timetable_day_overrides" where ("timetable_day_overrides"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "timetable_entries_live" WITH (security_invoker = true) AS (select "id", "timetable_id", "period_id", "section_id", "day_of_week", "split_index", "split_label", "subject_id", "teacher_id", "room", "notes", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "timetable_entries" where ("timetable_entries"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "timetable_periods_live" WITH (security_invoker = true) AS (select "id", "timetable_id", "kind", "label", "sequence", "start_time", "end_time", "session", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "timetable_periods" where ("timetable_periods"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "timetable_sections_live" WITH (security_invoker = true) AS (select "id", "timetable_id", "section_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "timetable_sections" where ("timetable_sections"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "timetables_live" WITH (security_invoker = true) AS (select "id", "academic_year_id", "name", "description", "status", "effective_from", "effective_to", "working_days", "day_start_time", "default_period_duration_mins", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "timetables" where ("timetables"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "timetable_day_overrides_app_select" ON "timetable_day_overrides" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_day_overrides_app_insert" ON "timetable_day_overrides" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_day_overrides_app_update" ON "timetable_day_overrides" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_day_overrides_app_delete" ON "timetable_day_overrides" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "timetable_day_overrides_reseller_read" ON "timetable_day_overrides" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "timetable_day_overrides_admin_all" ON "timetable_day_overrides" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "timetable_entries_app_select" ON "timetable_entries" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_entries_app_insert" ON "timetable_entries" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_entries_app_update" ON "timetable_entries" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_entries_app_delete" ON "timetable_entries" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "timetable_entries_reseller_read" ON "timetable_entries" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "timetable_entries_admin_all" ON "timetable_entries" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "timetable_periods_app_select" ON "timetable_periods" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_periods_app_insert" ON "timetable_periods" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_periods_app_update" ON "timetable_periods" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_periods_app_delete" ON "timetable_periods" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "timetable_periods_reseller_read" ON "timetable_periods" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "timetable_periods_admin_all" ON "timetable_periods" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "timetable_sections_app_select" ON "timetable_sections" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_sections_app_insert" ON "timetable_sections" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_sections_app_update" ON "timetable_sections" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetable_sections_app_delete" ON "timetable_sections" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "timetable_sections_reseller_read" ON "timetable_sections" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "timetable_sections_admin_all" ON "timetable_sections" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "timetables_app_select" ON "timetables" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetables_app_insert" ON "timetables" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetables_app_update" ON "timetables" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "timetables_app_delete" ON "timetables" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "timetables_reseller_read" ON "timetables" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "timetables_admin_all" ON "timetables" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Grants for the new timetable tables + live views (migrate path; dev/e2e get
-- these via the db-reset blanket GRANT). Mirrors the live-views migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "timetables", "timetable_sections", "timetable_periods", "timetable_entries", "timetable_day_overrides" TO roviq_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "timetables", "timetable_sections", "timetable_periods", "timetable_entries", "timetable_day_overrides" TO roviq_admin;--> statement-breakpoint
GRANT SELECT ON "timetables", "timetable_sections", "timetable_periods", "timetable_entries", "timetable_day_overrides" TO roviq_reseller;--> statement-breakpoint
GRANT SELECT ON "timetables_live", "timetable_sections_live", "timetable_periods_live", "timetable_entries_live", "timetable_day_overrides_live" TO roviq_app, roviq_reseller, roviq_admin;
