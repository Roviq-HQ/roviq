-- The institute role edits the profile and locale columns of its own row (the row rule is the
-- policy institutes_app_update). Everything else on the row stays with the platform and the
-- reseller: status, setup status, reseller, group, slug, type, departments, settings, demo flag,
-- first admin, impersonation consent and the delete columns.
GRANT UPDATE (name, code, contact, address, timezone, currency, supported_locales, default_locale,
  version, updated_at, updated_by)
  ON institutes TO roviq_app;
