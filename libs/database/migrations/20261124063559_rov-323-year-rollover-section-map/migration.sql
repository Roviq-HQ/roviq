-- ROV-323: section overrides for the year rollover.
-- The first line is a comment on purpose: `scripts/db-reset.ts` re-applies only migrations that
-- start with one, and the FORCE, the GRANT and the trigger below are hand-written.
CREATE TABLE "year_rollover_section_map" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"academic_year_id" uuid NOT NULL,
	"from_section_id" uuid NOT NULL,
	"to_section_id" uuid NOT NULL,
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
ALTER TABLE "year_rollover_section_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "year_rollover_section_map_tenant_id_idx" ON "year_rollover_section_map" ("tenant_id");--> statement-breakpoint
CREATE INDEX "year_rollover_section_map_to_section_id_idx" ON "year_rollover_section_map" ("to_section_id");--> statement-breakpoint
CREATE INDEX "year_rollover_section_map_from_section_id_idx" ON "year_rollover_section_map" ("from_section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "year_rollover_section_map_year_from_key" ON "year_rollover_section_map" ("academic_year_id","from_section_id") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_5l6ASVtubVg3_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_from_section_id_sections_id_fkey" FOREIGN KEY ("from_section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_to_section_id_sections_id_fkey" FOREIGN KEY ("to_section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "year_rollover_section_map_live" WITH (security_invoker = true) AS (select "id", "academic_year_id", "from_section_id", "to_section_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "year_rollover_section_map" where ("year_rollover_section_map"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "year_rollover_section_map_app_select" ON "year_rollover_section_map" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "year_rollover_section_map_app_insert" ON "year_rollover_section_map" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "year_rollover_section_map_app_update" ON "year_rollover_section_map" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "year_rollover_section_map_app_delete" ON "year_rollover_section_map" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "year_rollover_section_map_reseller_read" ON "year_rollover_section_map" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "year_rollover_section_map_admin_all" ON "year_rollover_section_map" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "year_rollover_section_map_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
-- Foreign keys do not apply RLS: without this a row could name another institute's section.
-- SECURITY DEFINER so the check sees every section and compares the institute itself.
CREATE OR REPLACE FUNCTION year_rollover_section_map_check_sections() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = NEW.from_section_id AND s.tenant_id = NEW.tenant_id
  ) OR NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = NEW.to_section_id AND s.tenant_id = NEW.tenant_id
      AND s.academic_year_id = NEW.academic_year_id
  ) THEN
    RAISE EXCEPTION 'year_rollover_section_map: both sections must be of the row''s institute and the target section of its year'
      USING ERRCODE = '23514', CONSTRAINT = 'year_rollover_section_map_sections_check';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_year_rollover_section_map_check_sections ON year_rollover_section_map;
--> statement-breakpoint
CREATE TRIGGER trg_year_rollover_section_map_check_sections
  BEFORE INSERT OR UPDATE OF tenant_id, academic_year_id, from_section_id, to_section_id
  ON year_rollover_section_map
  FOR EACH ROW EXECUTE FUNCTION year_rollover_section_map_check_sections();
