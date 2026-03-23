-- =============================================================
-- institute_groups: FORCE RLS + GRANTs
-- =============================================================
-- Drizzle's pgPolicy() auto-enables RLS (ENABLE ROW LEVEL
-- SECURITY) on db:push. However, it does NOT FORCE. Without
-- FORCE, the table owner bypasses all policies. GRANTs scope
-- per-role access.
-- =============================================================

-- 1. Force RLS even for the table owner
ALTER TABLE institute_groups FORCE ROW LEVEL SECURITY;

-- 2. GRANTs: roviq_admin full, roviq_reseller SELECT, roviq_app SELECT
GRANT ALL ON institute_groups TO roviq_admin;
GRANT SELECT ON institute_groups TO roviq_reseller;
GRANT SELECT ON institute_groups TO roviq_app;
