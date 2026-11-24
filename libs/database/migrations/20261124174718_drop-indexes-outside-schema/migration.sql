-- Indexes and foreign keys that existed only in hand-written SQL. The ones still needed are
-- declared in the Drizzle schema and created again by the next migration; the rest duplicate a
-- schema index or serve no query.
DROP INDEX IF EXISTS "idx_institutes_code_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_institutes_search";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_invoices_reseller";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_invoices_status";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_invoices_tenant";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_payments_gateway";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_payments_invoice";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_subscriptions_reseller";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_subscriptions_tenant";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_gwc_default";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_invoice_number_reseller";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_plan_code_reseller";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_sub_active_tenant";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_updated_by_users_id_fk";
