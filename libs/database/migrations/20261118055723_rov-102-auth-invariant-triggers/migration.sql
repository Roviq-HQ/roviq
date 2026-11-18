-- ROV-102: auth invariants enforced by the database, so no code path can skip them.
-- Functions that read or write other tables are SECURITY DEFINER: the caller's role may
-- not see those tables (roviq_app cannot read reseller_memberships) and the rule must
-- hold whichever role performs the write.

-- ── 1. The system reseller cannot be suspended, deactivated or deleted ─────────────
CREATE OR REPLACE FUNCTION protect_system_reseller() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'the system reseller cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_system AND (
    NEW.is_system IS DISTINCT FROM OLD.is_system
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  ) THEN
    RAISE EXCEPTION 'the system reseller cannot be suspended, deactivated or deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS resellers_protect_system ON resellers;
--> statement-breakpoint
CREATE TRIGGER resellers_protect_system
  BEFORE UPDATE OR DELETE ON resellers
  FOR EACH ROW EXECUTE FUNCTION protect_system_reseller();
--> statement-breakpoint

-- ── 2. A reseller that stops being ACTIVE loses its staff sessions ────────────────
CREATE OR REPLACE FUNCTION revoke_reseller_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'admin_revoked',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE membership_scope = 'reseller'
     AND revoked_at IS NULL
     AND membership_id IN (SELECT id FROM reseller_memberships WHERE reseller_id = NEW.id);

  UPDATE impersonation_sessions
     SET ended_at = now(), ended_reason = 'revoked'
   WHERE impersonator_scope = 'reseller'
     AND ended_at IS NULL
     AND impersonator_id IN (SELECT user_id FROM reseller_memberships WHERE reseller_id = NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS resellers_revoke_sessions ON resellers;
--> statement-breakpoint
CREATE TRIGGER resellers_revoke_sessions
  AFTER UPDATE OF status ON resellers
  FOR EACH ROW WHEN (OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE')
  EXECUTE FUNCTION revoke_reseller_sessions();
--> statement-breakpoint

-- ── 3. Refresh tokens: issued only to a live membership, revocation is one-way ────
CREATE OR REPLACE FUNCTION guard_refresh_token() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  live boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.membership_scope = 'reseller' THEN
      SELECT EXISTS (
        SELECT 1 FROM reseller_memberships m
          JOIN resellers r ON r.id = m.reseller_id
         WHERE m.id = NEW.membership_id AND m.user_id = NEW.user_id
           AND m.is_active AND m.deleted_at IS NULL
           AND r.status = 'ACTIVE' AND r.is_active AND r.deleted_at IS NULL
      ) INTO live;
    ELSIF NEW.membership_scope = 'platform' THEN
      SELECT EXISTS (
        SELECT 1 FROM platform_memberships m
         WHERE m.id = NEW.membership_id AND m.user_id = NEW.user_id
           AND m.is_active AND m.deleted_at IS NULL
      ) INTO live;
    ELSIF NEW.membership_scope = 'institute' THEN
      SELECT EXISTS (
        SELECT 1 FROM memberships m
         WHERE m.id = NEW.membership_id AND m.user_id = NEW.user_id
           AND m.tenant_id = NEW.tenant_id
           AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
      ) INTO live;
    ELSE
      -- An unknown scope is refused by chk_refresh_token_membership_scope.
      RETURN NEW;
    END IF;
    IF NOT live THEN
      RAISE EXCEPTION 'refresh token refused: no active % membership %', NEW.membership_scope, NEW.membership_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.membership_scope IS DISTINCT FROM OLD.membership_scope
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'a refresh token cannot be re-pointed or extended' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (
    NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
  ) THEN
    RAISE EXCEPTION 'a revoked refresh token stays revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS refresh_tokens_guard ON refresh_tokens;
--> statement-breakpoint
CREATE TRIGGER refresh_tokens_guard
  BEFORE INSERT OR UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION guard_refresh_token();
--> statement-breakpoint

-- ── 4. Impersonation sessions: opened only by someone entitled, ending is one-way ──
CREATE OR REPLACE FUNCTION guard_impersonation_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  entitled boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.impersonator_scope = 'reseller' THEN
      SELECT EXISTS (
        SELECT 1 FROM reseller_memberships m
          JOIN resellers r ON r.id = m.reseller_id
          JOIN institutes i ON i.reseller_id = r.id
         WHERE m.user_id = NEW.impersonator_id AND m.is_active AND m.deleted_at IS NULL
           AND r.status = 'ACTIVE' AND r.is_active AND r.deleted_at IS NULL
           AND i.id = NEW.target_tenant_id
      ) INTO entitled;
    ELSIF NEW.impersonator_scope = 'platform' THEN
      SELECT EXISTS (
        SELECT 1 FROM platform_memberships m
         WHERE m.user_id = NEW.impersonator_id AND m.is_active AND m.deleted_at IS NULL
      ) INTO entitled;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM memberships m
         WHERE m.user_id = NEW.impersonator_id AND m.tenant_id = NEW.target_tenant_id
           AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
      ) INTO entitled;
    END IF;
    IF NOT entitled THEN
      RAISE EXCEPTION 'impersonation refused: % has no active % access to institute %',
        NEW.impersonator_id, NEW.impersonator_scope, NEW.target_tenant_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'an ended impersonation session cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.impersonator_id IS DISTINCT FROM OLD.impersonator_id
     OR NEW.impersonator_scope IS DISTINCT FROM OLD.impersonator_scope
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.target_tenant_id IS DISTINCT FROM OLD.target_tenant_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'an impersonation session cannot be re-pointed or extended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS impersonation_sessions_guard ON impersonation_sessions;
--> statement-breakpoint
CREATE TRIGGER impersonation_sessions_guard
  BEFORE INSERT OR UPDATE ON impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_impersonation_session();
--> statement-breakpoint

-- ── 5. A password change revokes every session of the user ────────────────────────
CREATE OR REPLACE FUNCTION revoke_sessions_on_password_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'password_change',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE user_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_revoke_sessions_on_password_change ON users;
--> statement-breakpoint
CREATE TRIGGER users_revoke_sessions_on_password_change
  AFTER UPDATE OF password_hash ON users
  FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
  EXECUTE FUNCTION revoke_sessions_on_password_change();
--> statement-breakpoint

-- ── 6. Only the platform removes an institute ─────────────────────────────────────
CREATE OR REPLACE FUNCTION institutes_delete_admin_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'roviq_admin'
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'only the platform can delete or restore an institute'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS institutes_delete_admin_only_update ON institutes;
--> statement-breakpoint
CREATE TRIGGER institutes_delete_admin_only_update
  BEFORE UPDATE OF deleted_at ON institutes
  FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION institutes_delete_admin_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS institutes_delete_admin_only_delete ON institutes;
--> statement-breakpoint
CREATE TRIGGER institutes_delete_admin_only_delete
  BEFORE DELETE ON institutes
  FOR EACH ROW EXECUTE FUNCTION institutes_delete_admin_only();
--> statement-breakpoint

-- ── Table privileges to match the policies ────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON impersonation_sessions FROM roviq_app, roviq_reseller;
--> statement-breakpoint
REVOKE DELETE ON institutes FROM roviq_app, roviq_reseller;
