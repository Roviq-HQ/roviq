-- ROV-219. Written by hand: the constraint renames make drizzle-kit ask questions it cannot
-- ask without a terminal. `db-reset` replays this file after `drizzle-kit push`; the
-- statements that find their object already changed are tolerated or guarded.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_collected_by_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_verified_by_id_memberships_id_fkey";--> statement-breakpoint
-- Both columns record reseller staff, who have no row in memberships.
UPDATE "payments" SET "collected_by_id" = NULL WHERE "collected_by_id" IS NOT NULL AND "collected_by_id" NOT IN (SELECT "id" FROM "reseller_memberships");--> statement-breakpoint
UPDATE "payments" SET "verified_by_id" = NULL WHERE "verified_by_id" IS NOT NULL AND "verified_by_id" NOT IN (SELECT "id" FROM "reseller_memberships");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_id_reseller_memberships_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "reseller_memberships"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_id_reseller_memberships_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "reseller_memberships"("id");--> statement-breakpoint
-- A bare UPI address cannot take online orders, so it is never the default.
UPDATE "payment_gateway_configs" SET "is_default" = false WHERE "is_default" AND "provider" = 'UPI_DIRECT';--> statement-breakpoint
-- Keep the newest default per reseller.
UPDATE "payment_gateway_configs" SET "is_default" = false WHERE "is_default" AND "deleted_at" IS NULL AND "id" NOT IN (SELECT DISTINCT ON ("reseller_id") "id" FROM "payment_gateway_configs" WHERE "is_default" AND "deleted_at" IS NULL ORDER BY "reseller_id", "created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "gwc_reseller_default_key" ON "payment_gateway_configs" ("reseller_id") WHERE is_default AND deleted_at IS NULL;
