-- ROV-91: auth_events is INSERT-only for roviq_app and roviq_reseller.
-- The blanket `GRANT ... ON ALL TABLES` in db-reset.ts / init-db.sh left
-- roviq_app with UPDATE and DELETE and roviq_reseller with SELECT. RLS already
-- denied them (no matching policy); this removes the table privilege as well.

REVOKE SELECT, UPDATE, DELETE ON auth_events FROM roviq_app;
--> statement-breakpoint

REVOKE SELECT, UPDATE, DELETE ON auth_events FROM roviq_reseller;
