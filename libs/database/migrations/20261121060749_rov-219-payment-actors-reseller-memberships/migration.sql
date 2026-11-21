ALTER TABLE "payments" DROP CONSTRAINT "payments_collected_by_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_verified_by_id_memberships_id_fkey";--> statement-breakpoint
-- Both columns record reseller staff, who have no row in memberships.
UPDATE "payments" SET "collected_by_id" = NULL WHERE "collected_by_id" IS NOT NULL AND "collected_by_id" NOT IN (SELECT "id" FROM "reseller_memberships");--> statement-breakpoint
UPDATE "payments" SET "verified_by_id" = NULL WHERE "verified_by_id" IS NOT NULL AND "verified_by_id" NOT IN (SELECT "id" FROM "reseller_memberships");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_id_reseller_memberships_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "reseller_memberships"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_id_reseller_memberships_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "reseller_memberships"("id");