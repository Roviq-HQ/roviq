-- Migrations m1 to m7 added foreign keys named *_fk by hand; the schema declares the same
-- keys as *_fkey, so both existed and every insert or update was checked twice.
-- Drops a *_fk key only where an identical key with another name remains.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND c.conname LIKE '%\_fk'
      AND EXISTS (
        SELECT 1
        FROM pg_constraint d
        WHERE d.contype = 'f'
          AND d.oid <> c.oid
          AND d.conname NOT LIKE '%\_fk'
          AND d.conrelid = c.conrelid
          AND d.conkey = c.conkey
          AND d.confrelid = c.confrelid
          AND d.confkey = c.confkey
          AND d.confupdtype = c.confupdtype
          AND d.confdeltype = c.confdeltype
          AND d.confmatchtype = c.confmatchtype
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END;
$$;
