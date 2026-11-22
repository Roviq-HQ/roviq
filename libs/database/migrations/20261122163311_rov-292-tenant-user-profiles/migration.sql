CREATE TABLE "tenant_user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"first_name" jsonb NOT NULL,
	"last_name" jsonb,
	"gender" "Gender",
	"date_of_birth" date,
	"blood_group" varchar(5),
	"nationality" varchar(50) DEFAULT 'Indian',
	"religion" varchar(30),
	"mother_tongue" varchar(50),
	"profile_image_file_id" uuid,
	"search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(i18n_text_to_string(first_name), '')), 'A') || setweight(to_tsvector('simple', coalesce(i18n_text_to_string(last_name), '')), 'B')) STORED,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "chk_tenant_user_profiles_blood_group" CHECK ("blood_group" IN ('A+','A-','B+','B-','AB+','AB-','O+','O-'))
);
--> statement-breakpoint
ALTER TABLE "tenant_user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "phone_numbers_country_code_number_key";--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_country_code_number_key" ON "phone_numbers" ("country_code","number") WHERE "is_verified" = true AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "phone_numbers_number_idx" ON "phone_numbers" ("country_code","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_user_profiles_tenant_user_key" ON "tenant_user_profiles" ("tenant_id","user_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_tenant_user_profiles_user_id" ON "tenant_user_profiles" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_user_profiles_profile_image_file" ON "tenant_user_profiles" ("profile_image_file_id") WHERE profile_image_file_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tenant_user_profiles_search" ON "tenant_user_profiles" USING gin (search_vector);--> statement-breakpoint
ALTER TABLE "tenant_user_profiles" ADD CONSTRAINT "tenant_user_profiles_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_user_profiles" ADD CONSTRAINT "tenant_user_profiles_profile_image_file_id_files_id_fkey" FOREIGN KEY ("profile_image_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_user_profiles" ADD CONSTRAINT "tenant_user_profiles_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "tenant_user_profiles_live" WITH (security_invoker = true) AS (select "id", "user_id", "first_name", "last_name", "gender", "date_of_birth", "blood_group", "nationality", "religion", "mother_tongue", "profile_image_file_id", "search_vector", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "tenant_user_profiles" where ("tenant_user_profiles"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "tenant_user_profiles_app_select" ON "tenant_user_profiles" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_user_profiles_app_insert" ON "tenant_user_profiles" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_user_profiles_app_update" ON "tenant_user_profiles" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_user_profiles_app_delete" ON "tenant_user_profiles" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "tenant_user_profiles_reseller_read" ON "tenant_user_profiles" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "tenant_user_profiles_admin_all" ON "tenant_user_profiles" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);