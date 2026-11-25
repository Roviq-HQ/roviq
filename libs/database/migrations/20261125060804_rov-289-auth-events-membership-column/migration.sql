ALTER TABLE "auth_events" DROP CONSTRAINT "auth_events_user_id_users_id_fkey";--> statement-breakpoint
ALTER TABLE "auth_events" ADD COLUMN "membership_id" uuid;--> statement-breakpoint
CREATE INDEX "auth_events_membership_id_idx" ON "auth_events" ("membership_id");--> statement-breakpoint
CREATE POLICY "auth_events_admin_select" ON "auth_events" AS PERMISSIVE FOR SELECT TO "roviq_admin" USING (true);--> statement-breakpoint
CREATE POLICY "auth_events_admin_insert" ON "auth_events" AS PERMISSIVE FOR INSERT TO "roviq_admin" WITH CHECK (true);