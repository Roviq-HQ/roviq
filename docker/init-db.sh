#!/bin/bash
# Create application roles for Roviq.
# roviq       — bootstrap superuser (migrations only, NOT used at runtime)
# roviq_app   — application runtime (non-superuser, RLS enforced)
# roviq_admin — admin operations (non-superuser, policy-based RLS bypass via policies)
#
# IMPORTANT: Do NOT grant roviq role membership to roviq_app or roviq_admin.
# Role inheritance from the table owner (roviq) causes PostgreSQL to treat the
# member as the owner for RLS purposes (via has_privs_of_role), bypassing RLS
# entirely. Use explicit privilege grants instead.

psql -U roviq -d roviq <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roviq_app') THEN
    CREATE ROLE roviq_app WITH LOGIN PASSWORD 'roviq_app_dev';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roviq_admin') THEN
    CREATE ROLE roviq_admin WITH LOGIN PASSWORD 'roviq_admin_dev';
  END IF;
END
$$;

-- Revoke any stale role inheritance from previous init-db versions.
-- These caused RLS bypass because roviq is the table owner + superuser.
REVOKE roviq FROM roviq_app;
REVOKE roviq FROM roviq_admin;

-- Allow roviq_app to SET ROLE roviq_admin (used by withAdmin() in application code).
-- INHERIT FALSE prevents roviq_app from automatically gaining roviq_admin's policy
-- privileges — it must explicitly SET ROLE to assume them.
GRANT roviq_admin TO roviq_app WITH INHERIT FALSE, SET TRUE;

-- Schema access
GRANT USAGE ON SCHEMA public TO roviq_app;
GRANT USAGE ON SCHEMA public TO roviq_admin;

-- Explicit DML privileges on existing tables + sequences (covers tables already created)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roviq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roviq_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roviq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roviq_admin;

-- Default privileges for future tables created by db:push (owned by roviq)
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roviq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roviq_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO roviq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO roviq_admin;
SQL

# Create the e2e test database (separate from dev to keep dev data safe)
psql -U roviq -d postgres <<'SQL'
SELECT 'CREATE DATABASE roviq_test OWNER roviq'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'roviq_test')\gexec
SQL

psql -U roviq -d roviq_test <<'SQL'
-- Revoke superuser role inheritance — must repeat here because drizzle-kit push
-- (running as roviq) may re-grant roviq membership after the revoke above.
REVOKE roviq FROM roviq_app;
REVOKE roviq FROM roviq_admin;

-- Allow roviq_app to SET ROLE roviq_admin (cluster-wide, but explicit for clarity)
GRANT roviq_admin TO roviq_app WITH INHERIT FALSE, SET TRUE;

-- Schema access
GRANT USAGE ON SCHEMA public TO roviq_app;
GRANT USAGE ON SCHEMA public TO roviq_admin;

-- Explicit DML privileges on existing tables + sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roviq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roviq_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roviq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roviq_admin;

-- Default privileges for future tables created by db:push (owned by roviq)
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roviq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roviq_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO roviq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE roviq IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO roviq_admin;
SQL
