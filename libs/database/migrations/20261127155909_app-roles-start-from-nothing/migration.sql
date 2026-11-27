-- The institute, reseller and person roles hold a privilege only where it is written down:
-- a table made by a later migration gives them nothing until that migration grants it, and
-- the privileges recorded here are compared with the database by a test
-- (libs/database/privileges.manifest.txt).

-- 1. A new table or view starts with nothing for the institute and reseller roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM roviq_app, roviq_reseller;
--> statement-breakpoint

-- 2. Audit rows are written by the audit writer and the platform role only.
REVOKE INSERT ON audit_logs FROM roviq_app, roviq_reseller;
--> statement-breakpoint

-- 3. A reseller creates no institute itself and changes one column of its own institutes:
-- the group, when it takes an institute out of its own group. Ownership, status, the first
-- admin and the profile are the platform's.
REVOKE INSERT, UPDATE ON institutes FROM roviq_reseller;
--> statement-breakpoint
GRANT UPDATE (group_id, updated_at) ON institutes TO roviq_reseller;
--> statement-breakpoint

-- 4. An institute's code is assigned by the platform when the institute is created.
REVOKE UPDATE (code) ON institutes FROM roviq_app;
--> statement-breakpoint

-- 5. A privilege that no row policy of the role can ever satisfy is taken away, so that a
-- policy added later does not switch on an access nobody granted. Row security is forced on
-- every table: with no policy for a command (or only `false`), the command is refused anyway.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT g.grantee, g.table_name, g.privilege_type
      FROM information_schema.role_table_grants g
      JOIN pg_class c ON c.relname = g.table_name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = g.table_schema
     WHERE g.table_schema = 'public'
       AND c.relkind IN ('r', 'p')
       AND g.grantee IN ('roviq_app', 'roviq_reseller', 'roviq_user')
       AND NOT EXISTS (
         SELECT 1
           FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename = g.table_name
            AND g.grantee = ANY (p.roles::text[])
            AND p.cmd IN (g.privilege_type, 'ALL')
            AND NOT (
              COALESCE(p.qual, '') = 'false'
              OR (p.cmd = 'INSERT' AND COALESCE(p.with_check, '') = 'false')
            )
       )
  LOOP
    EXECUTE format('REVOKE %s ON public.%I FROM %I',
                   item.privilege_type, item.table_name, item.grantee);
  END LOOP;

  -- A view is read, and rows are locked through it (SELECT … FOR UPDATE needs UPDATE on the
  -- view). Inserts and deletes go to its table. A view keeps UPDATE only for a role that may
  -- update the table under it.
  FOR item IN
    SELECT c.relname, left(c.relname, -5) AS base, r.rolname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('roviq_app'), ('roviq_reseller'), ('roviq_user')) AS r(rolname)
     WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('REVOKE INSERT, DELETE, TRUNCATE ON public.%I FROM %I',
                   item.relname, item.rolname);
    IF to_regclass(format('public.%I', item.base)) IS NULL
       OR NOT (
         has_table_privilege(item.rolname, format('public.%I', item.base), 'UPDATE')
         OR has_any_column_privilege(item.rolname, format('public.%I', item.base), 'UPDATE')
       )
    THEN
      EXECUTE format('REVOKE UPDATE ON public.%I FROM %I', item.relname, item.rolname);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- One read is kept although no policy lets the institute role see a row: the audit log query
-- joins the reseller of each entry, and for an institute that join finds nothing.
GRANT SELECT ON resellers TO roviq_app;
--> statement-breakpoint

-- 6. Every table created in the public schema has row security enabled and forced the moment
-- it exists, whether or not its migration says so. With no policy yet, every role but the
-- owner is refused.
CREATE OR REPLACE FUNCTION public.enforce_table_row_security() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT * FROM pg_event_trigger_ddl_commands()
     WHERE object_type = 'table' AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', obj.object_identity);
  END LOOP;
END
$$;
--> statement-breakpoint
-- An event trigger belongs to the database, not the schema: a rebuilt schema still has it.
DROP EVENT TRIGGER IF EXISTS enforce_table_row_security;
--> statement-breakpoint
CREATE EVENT TRIGGER enforce_table_row_security
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.enforce_table_row_security();
