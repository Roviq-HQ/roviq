-- ROV-333: only the platform role writes template rows; an institute reads its own account's
-- rows, a reseller none. New tables start with the default grants, so narrow them here.
ALTER TABLE "messaging_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "messaging_templates" FROM roviq_app, roviq_reseller;--> statement-breakpoint
GRANT SELECT ON "messaging_templates" TO roviq_app;--> statement-breakpoint
REVOKE DELETE ON "messaging_templates" FROM roviq_admin;
