DROP VIEW "institute_groups_live";--> statement-breakpoint
ALTER TABLE "institute_groups" ADD COLUMN "reseller_id" uuid;--> statement-breakpoint
CREATE INDEX "institute_groups_reseller_id_idx" ON "institute_groups" ("reseller_id");--> statement-breakpoint
ALTER TABLE "institute_groups" ADD CONSTRAINT "institute_groups_reseller_id_resellers_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id");--> statement-breakpoint
CREATE VIEW "institute_groups_live" WITH (security_invoker = true) AS (select "id", "name", "code", "type", "registration_number", "registration_state", "contact", "address", "status", "reseller_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "institute_groups" where ("institute_groups"."deleted_at" is null));--> statement-breakpoint
ALTER POLICY "institute_groups_reseller_read" ON "institute_groups" TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid
        OR id IN (
          SELECT group_id FROM institutes
          WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
            AND group_id IS NOT NULL
        ));--> statement-breakpoint
GRANT SELECT ON "institute_groups_live" TO roviq_app, roviq_reseller, roviq_admin;
