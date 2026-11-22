-- Public TC verification: the caller has no institute, so the lookup is a SECURITY DEFINER
-- function that returns only what the verification page shows, by the opaque QR token.
CREATE FUNCTION verify_tc(p_token text)
RETURNS TABLE (
  serial_number varchar,
  status "TcStatus",
  student_name text,
  institute_name jsonb,
  issued_on date,
  is_duplicate boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.tc_serial_number,
         t.status,
         t.tc_data ->> 'studentName',
         i.name,
         (t.issued_at AT TIME ZONE 'Asia/Kolkata')::date,
         t.is_duplicate
  FROM tc_register t
  JOIN institutes i ON i.id = t.tenant_id
  WHERE t.verification_token = p_token
    AND length(p_token) >= 32
    AND t.deleted_at IS NULL
    AND i.deleted_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION verify_tc(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION verify_tc(text) TO roviq_admin;
