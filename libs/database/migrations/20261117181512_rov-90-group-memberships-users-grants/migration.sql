-- ROV-90: drizzle's .enableRLS() only ENABLEs; the owner still bypasses without FORCE.
ALTER TABLE group_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- group_memberships is roviq_admin-only. The blanket `GRANT ... ON ALL TABLES`
-- in db-reset.ts / init-db.sh gave roviq_app full DML and roviq_reseller SELECT.
REVOKE ALL ON group_memberships FROM roviq_app;
--> statement-breakpoint

REVOKE ALL ON group_memberships FROM roviq_reseller;
--> statement-breakpoint

-- users: every role reads, only roviq_admin writes. RLS already denied
-- roviq_app writes (SELECT policy only); this removes the table privilege too.
REVOKE INSERT, UPDATE, DELETE ON users FROM roviq_app;
