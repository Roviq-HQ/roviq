DROP VIEW "user_profiles_live";--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "profile_image_file_id" uuid;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_profile_image_file_id_files_id_fkey" FOREIGN KEY ("profile_image_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "user_profiles_live" WITH (security_invoker = true) AS (select "id", "user_id", "first_name", "last_name", "gender", "date_of_birth", "blood_group", "nationality", "religion", "mother_tongue", "profile_image_file_id", "cover_image_url", "search_vector", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "user_profiles" where ("user_profiles"."deleted_at" is null));--> statement-breakpoint
GRANT SELECT ON "user_profiles_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
-- The Student field shown to support staff was renamed with the column: profileImageUrl -> profileImage.
UPDATE "roles"
   SET "abilities" = replace("abilities"::text, '"profileImageUrl"', '"profileImage"')::jsonb
 WHERE "abilities"::text LIKE '%"profileImageUrl"%';
