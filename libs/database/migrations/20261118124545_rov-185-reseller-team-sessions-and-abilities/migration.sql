-- ROV-185: reseller staff can now be deactivated one by one, and two roles manage the team.

-- ── 1. A reseller membership that is deactivated or deleted loses its sessions ─────
-- Same rule as revoke_reseller_sessions (ROV-102), for one member instead of the whole
-- reseller. SECURITY DEFINER: roviq_reseller cannot write the other two tables.
CREATE OR REPLACE FUNCTION revoke_reseller_member_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'admin_revoked',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE membership_scope = 'reseller'
     AND revoked_at IS NULL
     AND membership_id = NEW.id;

  UPDATE impersonation_sessions
     SET ended_at = now(), ended_reason = 'revoked'
   WHERE impersonator_scope = 'reseller'
     AND ended_at IS NULL
     AND impersonator_id = NEW.user_id
     AND target_tenant_id IN (SELECT id FROM institutes WHERE reseller_id = NEW.reseller_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reseller_memberships_revoke_sessions ON reseller_memberships;
--> statement-breakpoint
CREATE TRIGGER reseller_memberships_revoke_sessions
  AFTER UPDATE OF is_active, deleted_at ON reseller_memberships
  FOR EACH ROW WHEN (
    (OLD.is_active AND NOT NEW.is_active)
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  )
  EXECUTE FUNCTION revoke_reseller_member_sessions();
--> statement-breakpoint

-- ── 2. Team management ability on every stored copy of the two managing roles ──────
-- New copies get it from RESELLER_SYSTEM_ROLE_ABILITIES.
UPDATE roles
   SET abilities = abilities || '[{"action": "manage", "subject": "ResellerTeam"}]'::jsonb,
       updated_at = now()
 WHERE scope = 'reseller'
   AND is_system
   AND name->>'en' IN ('reseller_full_admin', 'reseller_support_admin')
   AND NOT abilities @> '[{"action": "manage", "subject": "ResellerTeam"}]'::jsonb;
