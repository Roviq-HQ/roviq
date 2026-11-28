-- A reseller reads about a person only what reseller code reads: the account (`users`) and the
-- name, picture and search text of the account profile. Every other person table is read by
-- the institute and the platform only, so the reseller role holds no privilege on it; a later
-- reseller screen that needs one gets it in its own migration, column by column.
--
-- REVOKE on a table also takes away the column privileges granted on it earlier.

-- A person's details.
REVOKE SELECT ON tenant_user_profiles, user_addresses, user_documents, user_document_files,
  user_identifiers, phone_numbers FROM roviq_reseller;
--> statement-breakpoint
-- A person's place in an institute.
REVOKE SELECT ON student_profiles, staff_profiles, staff_qualifications, guardian_profiles,
  student_guardian_links FROM roviq_reseller;
--> statement-breakpoint
-- Admission.
REVOKE SELECT ON enquiries, admission_applications, application_documents,
  application_document_files FROM roviq_reseller;
--> statement-breakpoint
-- A person's records in an institute.
REVOKE SELECT ON student_academics, attendance_entries, exam_marks, co_scholastic_assessments,
  report_card_instances, issued_certificates, tc_register, leaves, leave_files, consent_records
  FROM roviq_reseller;
--> statement-breakpoint
-- The account profile: the name, the picture and the search text of the team and user lists.
-- The `user_profiles_live` view selects every column, so reseller code reads the table and
-- filters `deleted_at` itself.
REVOKE SELECT ON user_profiles FROM roviq_reseller;
--> statement-breakpoint
GRANT SELECT (id, user_id, first_name, last_name, profile_image_file_id, search_vector, deleted_at)
  ON user_profiles TO roviq_reseller;
