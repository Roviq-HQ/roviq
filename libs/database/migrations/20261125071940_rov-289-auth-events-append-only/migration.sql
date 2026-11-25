-- ROV-289: auth_events is a security log. No role may change or remove a row: the grant is
-- narrowed, and a trigger refuses the change even for a role a later blanket grant reopens.
REVOKE UPDATE, DELETE, TRUNCATE ON auth_events FROM roviq_admin;--> statement-breakpoint
CREATE FUNCTION public.forbid_row_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_events_append_only BEFORE UPDATE OR DELETE ON public.auth_events
    FOR EACH ROW EXECUTE FUNCTION public.forbid_row_change();--> statement-breakpoint
CREATE TRIGGER auth_events_no_truncate BEFORE TRUNCATE ON public.auth_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_row_change();
