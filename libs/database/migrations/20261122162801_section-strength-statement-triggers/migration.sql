-- The ROV-232 strength triggers ran once per row, so enrolling N students into a section
-- recounted that section N times (2000 rows: 48 s on a database without statistics).
-- They now run once per statement and recount each affected section once.
-- UPDATE OF <columns> cannot be combined with transition tables, so the functions compare
-- the old and new rows themselves and skip statements that change nothing counted.

DROP TRIGGER IF EXISTS student_academics_section_strength ON student_academics;
--> statement-breakpoint
DROP TRIGGER IF EXISTS student_profiles_section_strength ON student_profiles;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refresh_section_strengths(p_section_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_section uuid;
BEGIN
  -- Ascending order, so two statements touching the same sections cannot deadlock.
  FOR v_section IN
    SELECT DISTINCT s FROM unnest(p_section_ids) AS s WHERE s IS NOT NULL ORDER BY s
  LOOP
    PERFORM refresh_section_strength(v_section);
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION refresh_section_strengths(uuid[]) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_student_academics_section_strength() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sections uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT section_id) INTO v_sections FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT section_id) INTO v_sections FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT s) INTO v_sections
    FROM old_rows o
    JOIN new_rows n ON n.id = o.id
    CROSS JOIN LATERAL unnest(ARRAY[o.section_id, n.section_id]) AS s
    WHERE o.section_id IS DISTINCT FROM n.section_id
       OR o.deleted_at IS DISTINCT FROM n.deleted_at
       OR o.student_profile_id IS DISTINCT FROM n.student_profile_id;
  END IF;
  PERFORM refresh_section_strengths(v_sections);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength_insert
AFTER INSERT ON student_academics
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_student_academics_section_strength();
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength_update
AFTER UPDATE ON student_academics
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_student_academics_section_strength();
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength_delete
AFTER DELETE ON student_academics
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_student_academics_section_strength();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_student_profiles_section_strength() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sections uuid[];
BEGIN
  SELECT array_agg(DISTINCT sa.section_id) INTO v_sections
  FROM old_rows o
  JOIN new_rows n ON n.id = o.id
  JOIN student_academics sa ON sa.student_profile_id = n.id AND sa.deleted_at IS NULL
  WHERE o.academic_status IS DISTINCT FROM n.academic_status
     OR o.deleted_at IS DISTINCT FROM n.deleted_at;
  PERFORM refresh_section_strengths(v_sections);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER student_profiles_section_strength_update
AFTER UPDATE ON student_profiles
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_student_profiles_section_strength();
