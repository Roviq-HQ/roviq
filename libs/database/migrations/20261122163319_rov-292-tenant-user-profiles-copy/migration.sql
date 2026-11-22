-- Per-institute profile copies (ROV-292): lock the table down, then copy existing profiles.
ALTER TABLE "tenant_user_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "tenant_user_profiles_live" TO roviq_app, roviq_reseller, roviq_admin;--> statement-breakpoint
-- Each institute gets its own copy of the profile of every person who is a member of it.
INSERT INTO "tenant_user_profiles" (
  "tenant_id", "user_id", "first_name", "last_name", "gender", "date_of_birth", "blood_group",
  "nationality", "religion", "mother_tongue", "created_by", "updated_by"
)
SELECT m."tenant_id", up."user_id", up."first_name", up."last_name", up."gender", up."date_of_birth",
       up."blood_group", up."nationality", up."religion", up."mother_tongue", up."created_by", up."updated_by"
  FROM "user_profiles" up
  JOIN (SELECT DISTINCT "tenant_id", "user_id" FROM "memberships" WHERE "deleted_at" IS NULL) m
    ON m."user_id" = up."user_id"
 WHERE up."deleted_at" IS NULL;--> statement-breakpoint
-- A picture set while the person belonged to one institute becomes that institute's picture.
-- A person in several institutes keeps it as the account picture.
WITH single AS (
  SELECT tup."id", tup."tenant_id", up."id" AS user_profile_id, up."profile_image_file_id" AS file_id
    FROM "tenant_user_profiles" tup
    JOIN "user_profiles" up ON up."user_id" = tup."user_id"
   WHERE up."profile_image_file_id" IS NOT NULL
     AND (SELECT count(*) FROM "tenant_user_profiles" o WHERE o."user_id" = tup."user_id") = 1
), moved AS (
  UPDATE "tenant_user_profiles" tup SET "profile_image_file_id" = single.file_id
    FROM single WHERE tup."id" = single."id"
  RETURNING single.user_profile_id, single.file_id, single."tenant_id"
), owned AS (
  UPDATE "files" f SET "tenant_id" = moved."tenant_id"
    FROM moved WHERE f."id" = moved.file_id AND f."reseller_id" IS NULL
  RETURNING f."id"
)
UPDATE "user_profiles" up SET "profile_image_file_id" = NULL
  FROM moved WHERE up."id" = moved.user_profile_id;
