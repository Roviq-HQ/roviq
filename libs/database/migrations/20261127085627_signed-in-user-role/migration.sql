-- A database role for a signed-in person acting on their own account (withUser). It starts
-- with nothing: default privileges do not name it. Row policies limit each privilege below
-- to the person's own rows; the policies are in the next migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roviq_user') THEN
    CREATE ROLE roviq_user NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE roviq_user NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
--> statement-breakpoint
GRANT roviq_user TO roviq_pooler WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO roviq_user;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM roviq_user;
--> statement-breakpoint
-- Own account row: sign-in name, state and preferences; password change and e-mail check.
GRANT SELECT (id, email, username, avatar_url, preferred_locale, status, password_changed_at,
  must_change_password, email_verified_at, created_at, updated_at, created_by, updated_by,
  deleted_at, deleted_by, version, password_hash, token_version, form_help_mode)
  ON users TO roviq_user;
--> statement-breakpoint
GRANT UPDATE (preferred_locale, form_help_mode, password_hash, password_changed_at,
  must_change_password, token_version, email_verified_at, updated_at, updated_by)
  ON users TO roviq_user;
--> statement-breakpoint
GRANT SELECT ON users_live TO roviq_user;
--> statement-breakpoint
-- Own profile: read all of it, edit the three fields the profile page offers.
GRANT SELECT ON user_profiles, user_profiles_live TO roviq_user;
--> statement-breakpoint
GRANT UPDATE (nationality, religion, mother_tongue, updated_at, updated_by)
  ON user_profiles TO roviq_user;
--> statement-breakpoint
-- Own primary phone number.
GRANT SELECT, INSERT ON phone_numbers TO roviq_user;
--> statement-breakpoint
GRANT SELECT ON phone_numbers_live TO roviq_user;
--> statement-breakpoint
GRANT UPDATE (number, is_verified, updated_at, updated_by) ON phone_numbers TO roviq_user;
--> statement-breakpoint
-- Own passkeys: list, add, remove (a soft delete).
GRANT SELECT, INSERT ON auth_providers TO roviq_user;
--> statement-breakpoint
GRANT SELECT ON auth_providers_live TO roviq_user;
--> statement-breakpoint
GRANT UPDATE (deleted_at, deleted_by, updated_at, updated_by) ON auth_providers TO roviq_user;
--> statement-breakpoint
-- Own sessions: list and revoke.
GRANT SELECT ON refresh_tokens, refresh_tokens_live TO roviq_user;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_reason, updated_at) ON refresh_tokens TO roviq_user;
--> statement-breakpoint
-- Own group memberships, read only.
GRANT SELECT ON group_memberships, group_memberships_live TO roviq_user;
--> statement-breakpoint
-- Own platform notifications: read, mark read, archive.
GRANT SELECT ON notifications, notifications_live TO roviq_user;
--> statement-breakpoint
GRANT UPDATE (read_at, archived_at, updated_at, updated_by, version) ON notifications TO roviq_user;
