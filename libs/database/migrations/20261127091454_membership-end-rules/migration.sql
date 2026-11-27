-- A membership ends when it is deleted or its status stops being ACTIVE. Two rules hold on
-- every path that ends one: its sessions end with it, and an institute keeps at least one
-- member with full control.

-- SECURITY DEFINER, like the reseller rule: it writes only the sessions of the row that ended.
CREATE FUNCTION public.revoke_institute_member_sessions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'ADMIN_REVOKED',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE membership_scope = 'institute'
     AND revoked_at IS NULL
     AND membership_id = NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.revoke_institute_member_sessions() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER memberships_revoke_sessions AFTER UPDATE OF status, deleted_at ON public.memberships
  FOR EACH ROW WHEN (
    OLD.deleted_at IS NULL AND OLD.status = 'ACTIVE'
    AND (NEW.deleted_at IS NOT NULL OR NEW.status <> 'ACTIVE')
  )
  EXECUTE FUNCTION public.revoke_institute_member_sessions();
--> statement-breakpoint
-- Runs as the caller, who reads the roles and memberships of its own institute. The other
-- members with full control are locked, so two of them cannot be ended at the same moment.
CREATE FUNCTION public.guard_last_full_control_member() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  full_control constant jsonb := '[{"action":"manage","subject":"all"}]';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM roles r WHERE r.id = OLD.role_id AND r.abilities @> full_control
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM 1
     FROM memberships m
     JOIN roles r ON r.id = m.role_id
    WHERE m.tenant_id = OLD.tenant_id
      AND m.id <> OLD.id
      AND m.deleted_at IS NULL
      AND m.status = 'ACTIVE'
      AND r.deleted_at IS NULL
      AND r.abilities @> full_control
      FOR UPDATE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'an institute keeps at least one member with full control'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'memberships_keep_full_control_member';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- The platform role and the owner may end any membership (closing an institute, seeds).
CREATE TRIGGER memberships_keep_full_control_member BEFORE UPDATE OF status, deleted_at ON public.memberships
  FOR EACH ROW WHEN (
    OLD.deleted_at IS NULL AND OLD.status = 'ACTIVE'
    AND (NEW.deleted_at IS NOT NULL OR NEW.status <> 'ACTIVE')
    AND NOT public.is_platform_db_role()
  )
  EXECUTE FUNCTION public.guard_last_full_control_member();
