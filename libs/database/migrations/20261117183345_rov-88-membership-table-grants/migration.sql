-- ROV-88: platform_memberships is admin-only and reseller_memberships is
-- reseller/admin-only. The blanket `GRANT ... ON ALL TABLES` in db-reset.ts /
-- init-db.sh left roviq_app with full DML on both and roviq_reseller with
-- SELECT on platform_memberships. RLS already denied them (no matching
-- policy); this removes the table privilege as well, on the live views too.

REVOKE ALL ON platform_memberships, platform_memberships_live FROM roviq_app;
--> statement-breakpoint

REVOKE ALL ON platform_memberships, platform_memberships_live FROM roviq_reseller;
--> statement-breakpoint

REVOKE ALL ON reseller_memberships, reseller_memberships_live FROM roviq_app;
