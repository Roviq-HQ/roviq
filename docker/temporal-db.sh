#!/bin/sh
# Gives Temporal its own PostgreSQL role and makes it the owner of Temporal's two databases
# and of everything in them. Runs before Temporal on every start and is safe to repeat: a new
# cluster gets the role and empty databases, an older one has its databases handed over.
#
# Environment: PGHOST, PGUSER and PGPASSWORD of the cluster owner; TEMPORAL_DB_PASSWORD.
set -eu
: "${TEMPORAL_DB_PASSWORD:?}"

psql -q -v ON_ERROR_STOP=1 -d postgres <<'SQL'
\getenv pw TEMPORAL_DB_PASSWORD
SELECT format('CREATE ROLE roviq_temporal LOGIN PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roviq_temporal')\gexec
ALTER ROLE roviq_temporal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION
  PASSWORD :'pw';
SELECT format('CREATE DATABASE %I OWNER roviq_temporal', name)
  FROM unnest(ARRAY['temporal', 'temporal_visibility']) AS name
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = name)\gexec
ALTER DATABASE temporal OWNER TO roviq_temporal;
ALTER DATABASE temporal_visibility OWNER TO roviq_temporal;
SQL

for db in temporal temporal_visibility; do
  psql -q -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
ALTER SCHEMA public OWNER TO roviq_temporal;
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.oid::regclass AS name, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       AND c.relowner <> 'roviq_temporal'::regrole
       -- A sequence owned by a column follows its table.
       AND NOT (c.relkind = 'S' AND EXISTS (
             SELECT FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')))
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO roviq_temporal',
      CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                        WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      item.name);
  END LOOP;
  FOR item IN
    SELECT p.oid::regprocedure AS name, p.prokind
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proowner <> 'roviq_temporal'::regrole
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO roviq_temporal',
      CASE item.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, item.name);
  END LOOP;
  FOR item IN
    SELECT t.oid::regtype AS name
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd') AND t.typowner <> 'roviq_temporal'::regrole
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO roviq_temporal', item.name);
  END LOOP;
END
$$;
SQL
done
echo "temporal-db: roviq_temporal owns temporal and temporal_visibility"
