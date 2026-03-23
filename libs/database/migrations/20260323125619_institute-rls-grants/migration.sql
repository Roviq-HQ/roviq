-- =============================================================
-- Institute-service tables: FORCE RLS + GRANTs (PRD §9.2, §9.3)
-- =============================================================
-- Drizzle's pgPolicy() auto-enables ENABLE ROW LEVEL SECURITY
-- but does NOT apply FORCE. Without FORCE, the table owner
-- bypasses all policies silently. GRANTs are the first layer of
-- access control; RLS policies are the second layer.
-- =============================================================

-- 1. FORCE RLS on all institute-service tables
ALTER TABLE institutes FORCE ROW LEVEL SECURITY;
ALTER TABLE institute_branding FORCE ROW LEVEL SECURITY;
ALTER TABLE institute_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE institute_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE institute_affiliations FORCE ROW LEVEL SECURITY;

-- 2. GRANTs per PRD §9.2

-- roviq_app: SELECT only on institutes (tenant root — read own institute)
GRANT SELECT ON institutes TO roviq_app;
-- roviq_app: full CRUD on child tables (RLS limits to own tenant)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  institute_branding,
  institute_configs,
  institute_identifiers,
  institute_affiliations
TO roviq_app;

-- roviq_reseller: read-only on all institute tables
GRANT SELECT ON
  institutes,
  institute_branding,
  institute_configs,
  institute_identifiers,
  institute_affiliations
TO roviq_reseller;
-- roviq_reseller: INSERT + UPDATE on institutes (create with approval, suspend/reactivate)
GRANT INSERT, UPDATE ON institutes TO roviq_reseller;

-- roviq_admin: full access (already granted in db-reset, explicit here for clarity)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  institutes,
  institute_branding,
  institute_configs,
  institute_identifiers,
  institute_affiliations
TO roviq_admin;

-- 3. Sequence access for all roles
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_reseller;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_admin;
