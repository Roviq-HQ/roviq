-- ROV-64: lock runtime roles out of partition children.
-- RLS policies and GRANTs on a partitioned parent only apply to access through
-- the parent. Each child is its own relation, and default privileges handed
-- roviq_app/roviq_reseller/roviq_admin direct rights on it with RLS off — so
-- `SELECT/UPDATE/DELETE ... FROM audit_logs_YYYY_MM` skipped tenant isolation
-- and immutability. Children now carry no non-owner privileges and FORCE RLS
-- with no policies (default deny), which also keeps detached partitions sealed.

CREATE OR REPLACE FUNCTION lock_down_partitions(parent regclass) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  part    record;
  grantee text;
BEGIN
  FOR part IN
    SELECT c.oid::regclass AS rel, c.relowner, c.relacl,
           (c.relrowsecurity AND c.relforcerowsecurity) AS sealed
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = parent
  LOOP
    FOR grantee IN
      SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                           ELSE format('%I', pg_get_userbyid(a.grantee)) END
        FROM aclexplode(part.relacl) a
       WHERE a.grantee <> part.relowner
    LOOP
      EXECUTE format('REVOKE ALL ON %s FROM %s', part.rel, grantee);
    END LOOP;

    -- Guarded: ALTER TABLE takes ACCESS EXCLUSIVE, and this runs daily.
    IF NOT part.sealed THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part.rel);
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', part.rel);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

ALTER FUNCTION lock_down_partitions(regclass) OWNER TO roviq;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lock_down_partitions(regclass) FROM PUBLIC;
--> statement-breakpoint

-- Same body as 20260501033334 plus the lockdown call, so every create path
-- (boot, daily timer, db-reset, Temporal) seals what it creates and re-seals
-- siblings a later blanket GRANT may have reopened.
CREATE OR REPLACE FUNCTION ensure_monthly_partition(
  parent regclass,
  month_start timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  truncated_start timestamptz := date_trunc('month', month_start);
  truncated_end   timestamptz := date_trunc('month', month_start) + interval '1 month';
  parent_name     text := parent::text;
  partition_name  text := parent_name || to_char(truncated_start, '_YYYY_MM');
  is_partitioned  boolean;
BEGIN
  SELECT (relkind = 'p' AND
          (SELECT partstrat FROM pg_partitioned_table WHERE partrelid = parent) = 'r')
    INTO is_partitioned
    FROM pg_class WHERE oid = parent;

  IF NOT is_partitioned THEN
    RAISE EXCEPTION '% is not a RANGE-partitioned table', parent_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
    partition_name, parent_name, truncated_start, truncated_end
  );

  PERFORM lock_down_partitions(parent);
END;
$$;
--> statement-breakpoint

-- DETACH needs table ownership, which roviq_admin does not have.
CREATE OR REPLACE FUNCTION detach_monthly_partition(
  parent regclass,
  partition_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  child regclass;
BEGIN
  SELECT c.oid::regclass
    INTO child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = parent
     AND c.relname = partition_name;

  IF child IS NULL THEN
    RAISE EXCEPTION '% is not a partition of %', partition_name, parent::text;
  END IF;

  PERFORM lock_down_partitions(parent);
  EXECUTE format('ALTER TABLE %s DETACH PARTITION %s', parent, child);
END;
$$;
--> statement-breakpoint

ALTER FUNCTION detach_monthly_partition(regclass, text) OWNER TO roviq;
--> statement-breakpoint
REVOKE ALL ON FUNCTION detach_monthly_partition(regclass, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION detach_monthly_partition(regclass, text) TO roviq_admin;
--> statement-breakpoint

SELECT lock_down_partitions('audit_logs'::regclass);
