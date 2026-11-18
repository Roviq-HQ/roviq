ALTER TABLE "auth_events" ADD COLUMN "portal" varchar(20);--> statement-breakpoint
-- Rows written before `portal` existed. A granted session's portal is its scope.
UPDATE "auth_events" SET "portal" = "scope" WHERE "event_type" = 'login_success' AND "scope" IS NOT NULL;--> statement-breakpoint
-- Wrong-portal failures used to carry the attempted portal in `scope`; nothing was granted.
UPDATE "auth_events" SET "portal" = "scope" WHERE "event_type" = 'login_failed' AND "scope" IS NOT NULL;--> statement-breakpoint
UPDATE "auth_events" SET "scope" = NULL, "tenant_id" = NULL, "reseller_id" = NULL WHERE "event_type" IN ('login_failed', 'account_locked');--> statement-breakpoint
UPDATE "auth_events" SET "failure_reason" = CASE
  WHEN "event_type" = 'account_locked' THEN 'TOO_MANY_ATTEMPTS'
  WHEN "failure_reason" = 'wrong_portal' THEN 'NO_PORTAL_ACCESS'
  WHEN "failure_reason" = 'account_inactive' THEN 'ACCOUNT_INACTIVE'
  WHEN "user_id" IS NULL THEN 'UNKNOWN_USER'
  ELSE 'INVALID_PASSWORD'
END
WHERE "event_type" IN ('login_failed', 'account_locked');--> statement-breakpoint
UPDATE "auth_events" SET "failure_reason" = NULL WHERE "event_type" NOT IN ('login_failed', 'account_locked');--> statement-breakpoint
ALTER TABLE "auth_events" ALTER COLUMN "failure_reason" SET DATA TYPE varchar(40) USING "failure_reason"::varchar(40);--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "chk_auth_events_portal" CHECK ("portal" IN ('platform', 'reseller', 'institute'));--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "chk_auth_events_scope" CHECK ("scope" IN ('platform', 'reseller', 'institute'));--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "chk_auth_events_failure_reason" CHECK ("failure_reason" IN ('UNKNOWN_USER', 'INVALID_PASSWORD', 'ACCOUNT_INACTIVE', 'ACCOUNT_LOCKED', 'NO_PORTAL_ACCESS', 'PASSKEY_UNKNOWN', 'PASSKEY_VERIFICATION_FAILED', 'TOO_MANY_ATTEMPTS'));--> statement-breakpoint
-- NOT VALID: older refused attempts never recorded which portal they hit, and that cannot be
-- recovered. They are kept as they are; every new row is checked.
ALTER TABLE "auth_events" ADD CONSTRAINT "chk_auth_events_login_portal" CHECK ("event_type" NOT IN ('login_success', 'login_failed', 'account_locked') OR "portal" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "chk_auth_events_login_success_scope" CHECK ("event_type" <> 'login_success' OR "scope" = "portal");--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "chk_auth_events_refused_attempt" CHECK ("event_type" NOT IN ('login_failed', 'account_locked') OR ("scope" IS NULL AND "tenant_id" IS NULL AND "reseller_id" IS NULL AND "failure_reason" IS NOT NULL));