-- A bare UPI address cannot take online orders, so it is never the default.
UPDATE "payment_gateway_configs" SET "is_default" = false WHERE "is_default" AND "provider" = 'UPI_DIRECT';--> statement-breakpoint
-- Keep the newest default per reseller.
UPDATE "payment_gateway_configs" SET "is_default" = false WHERE "is_default" AND "deleted_at" IS NULL AND "id" NOT IN (SELECT DISTINCT ON ("reseller_id") "id" FROM "payment_gateway_configs" WHERE "is_default" AND "deleted_at" IS NULL ORDER BY "reseller_id", "created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "gwc_reseller_default_key" ON "payment_gateway_configs" ("reseller_id") WHERE is_default AND deleted_at IS NULL;