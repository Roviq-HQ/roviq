-- =============================================================
-- Academic structure tables: FORCE RLS + GRANTs
-- =============================================================
-- Covers: academic_years, standards, sections, subjects,
-- standard_subjects, section_subjects
-- =============================================================

-- 1. FORCE RLS on all academic structure tables
ALTER TABLE academic_years FORCE ROW LEVEL SECURITY;
ALTER TABLE standards FORCE ROW LEVEL SECURITY;
ALTER TABLE sections FORCE ROW LEVEL SECURITY;
ALTER TABLE subjects FORCE ROW LEVEL SECURITY;
ALTER TABLE standard_subjects FORCE ROW LEVEL SECURITY;
ALTER TABLE section_subjects FORCE ROW LEVEL SECURITY;

-- 2. GRANTs per PRD §9.2

-- roviq_app: full CRUD (RLS limits to own tenant)
GRANT SELECT, INSERT, UPDATE, DELETE ON
  academic_years,
  standards,
  sections,
  subjects,
  standard_subjects,
  section_subjects
TO roviq_app;

-- roviq_reseller: read-only on academic structure
GRANT SELECT ON
  academic_years,
  standards,
  sections,
  subjects,
  standard_subjects,
  section_subjects
TO roviq_reseller;

-- roviq_admin: full access
GRANT SELECT, INSERT, UPDATE, DELETE ON
  academic_years,
  standards,
  sections,
  subjects,
  standard_subjects,
  section_subjects
TO roviq_admin;

-- 3. Sequence access
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_reseller;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO roviq_admin;
