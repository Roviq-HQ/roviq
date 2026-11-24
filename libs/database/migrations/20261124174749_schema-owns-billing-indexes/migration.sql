CREATE INDEX "idx_institutes_code_trgm" ON "institutes" USING gin ("code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_invoices_tenant" ON "invoices" ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_invoices_reseller" ON "invoices" ("reseller_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" ("status") WHERE "status" IN ('SENT', 'OVERDUE');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoice_number_reseller" ON "invoices" ("reseller_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_plan_code_reseller" ON "plans" ("reseller_id","code") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_reseller" ON "subscriptions" ("reseller_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sub_active_tenant" ON "subscriptions" ("tenant_id") WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAUSED', 'PAST_DUE');