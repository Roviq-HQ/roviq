DROP VIEW "resellers_live";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP CONSTRAINT "user_profiles_created_by_users_id_fkey";--> statement-breakpoint
ALTER TABLE "user_profiles" DROP CONSTRAINT "user_profiles_updated_by_users_id_fkey";--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_templates" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_templates" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_providers" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_providers" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_memberships" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_memberships" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "platform_memberships" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "id" uuid DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_children" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_children" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "group_children" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_members" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_rules" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_rules" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_rules" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_rules" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_rules" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_rules" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "group_rules" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "reseller_memberships" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "resellers" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "resellers" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "resellers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_memberships" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "group_memberships" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_notices" RENAME COLUMN "version" TO "notice_version";--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_notices" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_notices" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_addresses" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_addresses" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_documents" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_documents" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "user_documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identifiers" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identifiers" ALTER COLUMN "created_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_identifiers" ADD COLUMN "updated_by" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identifiers" ALTER COLUMN "updated_by" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_identifiers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_identifiers" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "user_identifiers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_children" DROP CONSTRAINT "group_children_pkey";--> statement-breakpoint
ALTER TABLE "group_children" ADD PRIMARY KEY ("id");--> statement-breakpoint
UPDATE "user_profiles" SET "created_by" = COALESCE("created_by", '00000000-0000-0000-0000-000000000000'), "updated_by" = COALESCE("updated_by", '00000000-0000-0000-0000-000000000000') WHERE "created_by" IS NULL OR "updated_by" IS NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "updated_by" SET NOT NULL;--> statement-breakpoint
DROP INDEX "auth_providers_provider_provider_user_id_key";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_providers_provider_provider_user_id_key" ON "auth_providers" ("provider","provider_user_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "phone_numbers_country_code_number_key";--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_country_code_number_key" ON "phone_numbers" ("country_code","number") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "idx_phone_numbers_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_phone_numbers_primary" ON "phone_numbers" ("user_id") WHERE "is_primary" = true AND "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_platform_membership_user";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_platform_membership_user" ON "platform_memberships" ("user_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_group_member";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_group_member" ON "group_members" ("group_id","membership_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_reseller_membership";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reseller_membership" ON "reseller_memberships" ("user_id","reseller_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "group_memberships_user_group_key";--> statement-breakpoint
CREATE UNIQUE INDEX "group_memberships_user_group_key" ON "group_memberships" ("user_id","group_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_notice_version";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notice_version" ON "privacy_notices" ("tenant_id","notice_version","language") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_student_guardian";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_student_guardian" ON "student_guardian_links" ("student_profile_id","guardian_profile_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "idx_primary_contact";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_primary_contact" ON "student_guardian_links" ("student_profile_id") WHERE "is_primary_contact" = true AND "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_address_user_type";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_address_user_type" ON "user_addresses" ("user_id","type") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "uq_identifier_user_type";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_identifier_user_type" ON "user_identifiers" ("user_id","type") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_group_child" ON "group_children" ("parent_group_id","child_group_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE VIEW "application_documents_live" WITH (security_invoker = true) AS (select "id", "application_id", "type", "file_urls", "is_verified", "verified_by", "verified_at", "rejection_reason", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "application_documents" where ("application_documents"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "auth_providers_live" WITH (security_invoker = true) AS (select "id", "user_id", "provider", "provider_user_id", "provider_data", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "auth_providers" where ("auth_providers"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "certificate_templates_live" WITH (security_invoker = true) AS (select "id", "type", "name", "template_content", "fields_schema", "approval_chain", "is_active", "board_type", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "certificate_templates" where ("certificate_templates"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "group_children_live" WITH (security_invoker = true) AS (select "id", "parent_group_id", "child_group_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "group_children" where ("group_children"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "group_members_live" WITH (security_invoker = true) AS (select "id", "group_id", "membership_id", "source", "is_excluded", "resolved_at", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "group_members" where ("group_members"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "group_memberships_live" WITH (security_invoker = true) AS (select "id", "user_id", "group_id", "role_id", "is_active", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "group_memberships" where ("group_memberships"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "group_rules_live" WITH (security_invoker = true) AS (select "id", "group_id", "rule", "rule_dimensions", "description", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "group_rules" where ("group_rules"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "phone_numbers_live" WITH (security_invoker = true) AS (select "id", "user_id", "country_code", "number", "label", "is_primary", "is_whatsapp", "is_verified", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "phone_numbers" where ("phone_numbers"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "platform_memberships_live" WITH (security_invoker = true) AS (select "id", "user_id", "role_id", "abilities", "is_active", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "platform_memberships" where ("platform_memberships"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "privacy_notices_live" WITH (security_invoker = true) AS (select "id", "notice_version", "language", "content", "is_active", "published_at", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "privacy_notices" where ("privacy_notices"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "refresh_tokens_live" WITH (security_invoker = true) AS (select "id", "tenant_id", "user_id", "membership_id", "membership_scope", "token_hash", "device_info", "ip_address", "user_agent", "expires_at", "revoked_at", "revoked_reason", "last_used_at", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "refresh_tokens" where ("refresh_tokens"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "reseller_memberships_live" WITH (security_invoker = true) AS (select "id", "user_id", "role_id", "reseller_id", "abilities", "is_active", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "reseller_memberships" where ("reseller_memberships"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "staff_qualifications_live" WITH (security_invoker = true) AS (select "id", "staff_profile_id", "type", "degree_name", "institution", "board_university", "year_of_passing", "grade_percentage", "certificate_url", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "staff_qualifications" where ("staff_qualifications"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "student_guardian_links_live" WITH (security_invoker = true) AS (select "id", "student_profile_id", "guardian_profile_id", "relationship", "is_primary_contact", "is_emergency_contact", "can_pickup", "lives_with", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "student_guardian_links" where ("student_guardian_links"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "user_addresses_live" WITH (security_invoker = true) AS (select "id", "user_id", "type", "line1", "line2", "line3", "city", "district", "state", "country", "postal_code", "coordinates", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_addresses" where ("user_addresses"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "user_documents_live" WITH (security_invoker = true) AS (select "id", "user_id", "type", "description", "file_urls", "reference_number", "is_verified", "verified_at", "verified_by", "rejection_reason", "expiry_date", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_documents" where ("user_documents"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "user_identifiers_live" WITH (security_invoker = true) AS (select "id", "user_id", "type", "value_encrypted", "value_hash", "value_plain", "value_masked", "issuing_authority", "valid_from", "valid_to", "is_verified", "verified_at", "verified_by", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_identifiers" where ("user_identifiers"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "user_profiles_live" WITH (security_invoker = true) AS (select "id", "user_id", "first_name", "last_name", "gender", "date_of_birth", "blood_group", "nationality", "religion", "mother_tongue", "profile_image_url", "cover_image_url", "search_vector", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_profiles" where ("user_profiles"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "users_live" WITH (security_invoker = true) AS (select "id", "email", "username", "password_hash", "avatar_url", "preferred_locale", "status", "password_changed_at", "must_change_password", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "users" where ("users"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "resellers_live" WITH (security_invoker = true) AS (select "id", "name", "slug", "tier", "is_system", "is_active", "status", "suspended_at", "branding", "custom_domain", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "resellers" where ("resellers"."deleted_at" is null));--> statement-breakpoint
-- A view gets no privileges from its base table; security_invoker keeps RLS on the caller.
GRANT SELECT ON "application_documents_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "auth_providers_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "certificate_templates_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "group_children_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "group_members_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "group_memberships_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "group_rules_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "phone_numbers_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "platform_memberships_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "privacy_notices_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "refresh_tokens_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "reseller_memberships_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "staff_qualifications_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "student_guardian_links_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "user_addresses_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "user_documents_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "user_identifiers_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "user_profiles_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "users_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
GRANT SELECT ON "resellers_live" TO roviq_app, roviq_reseller, roviq_admin;
