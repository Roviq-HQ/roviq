-- ROV-372: an institute creates its own user for each person (ROV-292). The database holds the
-- rule: users.origin_tenant_id names the institute that created an account, and the institute
-- role may add a membership only for such an account or for one of its active members.

-- Accounts that exist already: one that has only ever belonged to a single institute, holds no
-- platform or reseller role and is no institute's first admin was created by that institute.
UPDATE users u
   SET origin_tenant_id = one.tenant_id
  FROM (
    SELECT m.user_id, (array_agg(DISTINCT m.tenant_id))[1] AS tenant_id
      FROM memberships m
     GROUP BY m.user_id
    HAVING count(DISTINCT m.tenant_id) = 1
  ) one
 WHERE u.id = one.user_id
   AND u.origin_tenant_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM platform_memberships p WHERE p.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM reseller_memberships r WHERE r.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM institutes i WHERE i.first_admin_user_id = u.id);
--> statement-breakpoint
CREATE FUNCTION public.forbid_origin_tenant_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'the institute that created a user cannot be changed'
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_keep_origin_tenant BEFORE UPDATE ON public.users
  FOR EACH ROW WHEN (OLD.origin_tenant_id IS DISTINCT FROM NEW.origin_tenant_id)
  EXECUTE FUNCTION public.forbid_origin_tenant_change();
--> statement-breakpoint
-- Runs as the caller: true for the platform role and for the owner that runs migrations and seeds.
CREATE FUNCTION public.is_platform_db_role() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
  SELECT current_user = 'roviq_admin'
      OR COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false);
$$;
--> statement-breakpoint
-- SECURITY DEFINER because the institute role cannot read the account of a person who is not
-- yet its member. It reads only the new row's own user and institute and returns nothing.
CREATE FUNCTION public.guard_membership_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  allowed boolean;
BEGIN
  SELECT EXISTS (
           SELECT 1 FROM users u
            WHERE u.id = NEW.user_id AND u.origin_tenant_id = NEW.tenant_id
         )
      OR EXISTS (
           SELECT 1 FROM memberships m
            WHERE m.user_id = NEW.user_id AND m.tenant_id = NEW.tenant_id
              AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
         )
    INTO allowed;
  IF NOT allowed THEN
    RAISE EXCEPTION 'membership refused: an institute may add only a person it created or one of its active members'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_membership_user() FROM PUBLIC;
--> statement-breakpoint
-- The WHEN clause is evaluated as the caller, before the function changes role.
CREATE TRIGGER memberships_guard_user BEFORE INSERT ON public.memberships
  FOR EACH ROW WHEN (NOT public.is_platform_db_role())
  EXECUTE FUNCTION public.guard_membership_user();
--> statement-breakpoint
CREATE FUNCTION public.forbid_membership_move() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'a membership cannot move to another user or institute'
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memberships_keep_user_and_tenant BEFORE UPDATE ON public.memberships
  FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.forbid_membership_move();
