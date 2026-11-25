-- ROV-227: the stored value sets move to UPPER_SNAKE. The old CHECKs go first, the rows are
-- rewritten, then the CHECKs return with the new values; the next migration states them again
-- from the schema.
ALTER TABLE refresh_tokens DROP CONSTRAINT chk_refresh_token_revoked_reason;
--> statement-breakpoint
ALTER TABLE consent_records DROP CONSTRAINT chk_consent_purpose, DROP CONSTRAINT chk_verification_method;
--> statement-breakpoint
ALTER TABLE auth_events DROP CONSTRAINT chk_auth_events_login_portal,
  DROP CONSTRAINT chk_auth_events_login_success_scope, DROP CONSTRAINT chk_auth_events_refused_attempt;
--> statement-breakpoint
-- refresh_tokens_guard refuses any change to a revoked row; auth_events_append_only refuses every
-- update. Both are switched off by name for this transaction only.
ALTER TABLE refresh_tokens DISABLE TRIGGER refresh_tokens_guard;
--> statement-breakpoint
ALTER TABLE auth_events DISABLE TRIGGER auth_events_append_only;
--> statement-breakpoint
-- FORCE row security would filter the owner too, and no policy names it: lifted for the rewrite only.
ALTER TABLE refresh_tokens NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consent_records NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_events NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE refresh_tokens SET revoked_reason = upper(revoked_reason)
  WHERE revoked_reason IS NOT NULL AND revoked_reason <> upper(revoked_reason);
--> statement-breakpoint
UPDATE consent_records SET purpose = upper(purpose) WHERE purpose <> upper(purpose);
--> statement-breakpoint
UPDATE consent_records SET verification_method = CASE verification_method
    WHEN 'school_erp_verified_account' THEN 'INSTITUTE_ERP_VERIFIED_ACCOUNT'
    ELSE upper(verification_method) END
  WHERE verification_method IS NOT NULL AND verification_method <> upper(verification_method);
--> statement-breakpoint
UPDATE auth_events SET event_type = upper(event_type) WHERE event_type <> upper(event_type);
--> statement-breakpoint
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE refresh_tokens ENABLE TRIGGER refresh_tokens_guard;
--> statement-breakpoint
ALTER TABLE auth_events ENABLE TRIGGER auth_events_append_only;
--> statement-breakpoint
ALTER TABLE refresh_tokens ADD CONSTRAINT chk_refresh_token_revoked_reason CHECK (
  (revoked_at IS NULL AND revoked_reason IS NULL)
  OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL
    AND revoked_reason IN ('ROTATION', 'USER_INITIATED', 'PASSWORD_CHANGE', 'ADMIN_REVOKED')));
--> statement-breakpoint
ALTER TABLE consent_records ADD CONSTRAINT chk_consent_purpose CHECK (purpose IN (
  'ACADEMIC_DATA_PROCESSING', 'PHOTO_VIDEO_MARKETING', 'WHATSAPP_COMMUNICATION', 'SMS_COMMUNICATION',
  'AADHAAR_COLLECTION', 'BIOMETRIC_COLLECTION', 'THIRD_PARTY_EDTECH', 'BOARD_EXAM_REGISTRATION',
  'TRANSPORT_TRACKING', 'HEALTH_DATA_PROCESSING', 'CCTV_MONITORING'));
--> statement-breakpoint
ALTER TABLE consent_records ADD CONSTRAINT chk_verification_method CHECK (
  verification_method IS NULL OR verification_method IN ('DIGILOCKER_TOKEN', 'AADHAAR_OTP',
    'IN_PERSON_ID_CHECK', 'SIGNED_FORM_UPLOADED', 'INSTITUTE_ERP_VERIFIED_ACCOUNT'));
--> statement-breakpoint
ALTER TABLE auth_events ADD CONSTRAINT chk_auth_events_login_portal CHECK (
  event_type NOT IN ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED') OR portal IS NOT NULL);
--> statement-breakpoint
ALTER TABLE auth_events ADD CONSTRAINT chk_auth_events_login_success_scope CHECK (
  event_type <> 'LOGIN_SUCCESS' OR scope = portal);
--> statement-breakpoint
ALTER TABLE auth_events ADD CONSTRAINT chk_auth_events_refused_attempt CHECK (
  event_type NOT IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')
  OR (scope IS NULL AND tenant_id IS NULL AND reseller_id IS NULL AND failure_reason IS NOT NULL));
--> statement-breakpoint
-- The three session-revoking trigger functions, as in the baseline with only the reason changed.
CREATE OR REPLACE FUNCTION public.revoke_reseller_member_sessions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'ADMIN_REVOKED',
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
CREATE OR REPLACE FUNCTION public.revoke_reseller_sessions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'ADMIN_REVOKED',
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
CREATE OR REPLACE FUNCTION public.revoke_sessions_on_password_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGE',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE user_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;
