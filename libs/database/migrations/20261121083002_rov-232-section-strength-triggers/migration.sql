-- sections.current_strength was a counter each code path had to remember to bump; seeders and
-- TC issue never did, so capacity checks ran on a wrong number. The database now owns it:
-- strength = live student_academics rows of the section whose student is ENROLLED.
-- SECURITY DEFINER: the count must not depend on the caller's row-level view.

CREATE OR REPLACE FUNCTION refresh_section_strength(p_section_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_section_id IS NULL THEN
    RETURN;
  END IF;
  -- Row lock first: a concurrent writer waits here and then counts our committed row too.
  -- NO KEY UPDATE, because the insert's foreign-key check already holds KEY SHARE on this row;
  -- two inserts asking for a full UPDATE lock would deadlock on each other's key share.
  PERFORM 1 FROM sections WHERE id = p_section_id FOR NO KEY UPDATE;
  UPDATE sections s
  SET current_strength = (
    SELECT count(*)
    FROM student_academics sa
    JOIN student_profiles sp ON sp.id = sa.student_profile_id
    WHERE sa.section_id = p_section_id
      AND sa.deleted_at IS NULL
      AND sp.deleted_at IS NULL
      AND sp.academic_status = 'ENROLLED'
  )
  WHERE s.id = p_section_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_student_academics_section_strength() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old uuid := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.section_id END;
  v_new uuid := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.section_id END;
BEGIN
  -- Fixed order, so two moves between the same pair of sections cannot deadlock.
  IF v_old IS NOT NULL AND v_new IS NOT NULL AND v_old <> v_new THEN
    PERFORM refresh_section_strength(LEAST(v_old, v_new));
    PERFORM refresh_section_strength(GREATEST(v_old, v_new));
  ELSE
    PERFORM refresh_section_strength(COALESCE(v_new, v_old));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength
AFTER INSERT OR DELETE OR UPDATE OF section_id, deleted_at, student_profile_id ON student_academics
FOR EACH ROW EXECUTE FUNCTION trg_student_academics_section_strength();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_student_profiles_section_strength() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_section uuid;
BEGIN
  IF NEW.academic_status IS NOT DISTINCT FROM OLD.academic_status
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NULL;
  END IF;
  FOR v_section IN
    SELECT DISTINCT sa.section_id
    FROM student_academics sa
    WHERE sa.student_profile_id = NEW.id AND sa.deleted_at IS NULL
    ORDER BY sa.section_id
  LOOP
    PERFORM refresh_section_strength(v_section);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER student_profiles_section_strength
AFTER UPDATE OF academic_status, deleted_at ON student_profiles
FOR EACH ROW EXECUTE FUNCTION trg_student_profiles_section_strength();
--> statement-breakpoint
REVOKE ALL ON FUNCTION refresh_section_strength(uuid) FROM PUBLIC;
--> statement-breakpoint
UPDATE sections s
SET current_strength = (
  SELECT count(*)
  FROM student_academics sa
  JOIN student_profiles sp ON sp.id = sa.student_profile_id
  WHERE sa.section_id = s.id
    AND sa.deleted_at IS NULL
    AND sp.deleted_at IS NULL
    AND sp.academic_status = 'ENROLLED'
);
