-- =============================================================
-- Institute search indexes: tsvector + pg_trgm (ROV-132)
-- =============================================================
-- Enables full-text search and typeahead on institutes table.
-- pg_trgm provides fuzzy/prefix matching for search-as-you-type.
-- =============================================================

-- 1. Enable pg_trgm extension (required for trigram indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Full-text search: GIN index on name JSONB (English key)
-- institutes.name is i18nText (JSONB), so we index the 'en' key
CREATE INDEX IF NOT EXISTS idx_institutes_search
  ON institutes USING GIN (to_tsvector('english', COALESCE(name->>'en', '')));

-- 3. Trigram index for typeahead on name + code
CREATE INDEX IF NOT EXISTS idx_institutes_name_trgm
  ON institutes USING GIN ((COALESCE(name->>'en', '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_institutes_code_trgm
  ON institutes USING GIN (COALESCE(code, '') gin_trgm_ops);
