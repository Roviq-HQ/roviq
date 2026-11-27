-- A reseller reads its institutes' people without the columns that hold a person's caste,
-- religion, disability or identity numbers. The role's SELECT on these tables becomes a list
-- of columns; a column added later is not readable by the reseller role until it is granted.
--
-- The `*_live` views select every column of their table, so the reseller role can no longer
-- read these six through the view: its code reads the table and filters `deleted_at` itself.

REVOKE SELECT ON student_profiles, tenant_user_profiles, user_profiles, user_identifiers,
  enquiries, admission_applications FROM roviq_reseller;
--> statement-breakpoint
-- Not readable: social_category, caste, is_minority, minority_type, is_cwsn, cwsn_type, medical_info.
GRANT SELECT (id, user_id, membership_id, admission_number, admission_date, admission_class, admission_type, academic_status, is_bpl, is_rte_admitted, rte_certificate, previous_school_name, previous_school_board, previous_school_udise, incoming_tc_number, incoming_tc_date, tc_issued, tc_number, tc_issued_date, tc_reason, date_of_leaving, stream, batch_start_date, batch_end_date, course_name, tenant_id, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, version)
  ON student_profiles TO roviq_reseller;
--> statement-breakpoint
-- Not readable: religion.
GRANT SELECT (id, user_id, first_name, last_name, gender, date_of_birth, blood_group, nationality, mother_tongue, profile_image_file_id, search_vector, tenant_id, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, version)
  ON tenant_user_profiles TO roviq_reseller;
--> statement-breakpoint
-- Not readable: religion.
GRANT SELECT (id, user_id, first_name, last_name, gender, date_of_birth, blood_group, nationality, mother_tongue, profile_image_file_id, cover_image_url, search_vector, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, version)
  ON user_profiles TO roviq_reseller;
--> statement-breakpoint
-- Not readable: value_encrypted, value_hash, value_plain, value_masked.
GRANT SELECT (id, user_id, type, issuing_authority, valid_from, valid_to, is_verified, verified_at, verified_by, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, version)
  ON user_identifiers TO roviq_reseller;
--> statement-breakpoint
-- Not readable: special_needs.
GRANT SELECT (id, enquiry_number, student_name, date_of_birth, gender, class_requested, academic_year_id, parent_name, parent_phone, parent_email, parent_relation, source, referred_by, assigned_to, previous_school, previous_board, sibling_in_school, sibling_admission_no, notes, status, follow_up_date, last_contacted_at, converted_to_application_id, tenant_id, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, version)
  ON enquiries TO roviq_reseller;
--> statement-breakpoint
-- Not readable: form_data.
GRANT SELECT (id, enquiry_id, academic_year_id, standard_id, section_id, status, is_rte_application, rte_lottery_rank, test_score, interview_score, merit_rank, offered_at, offer_expires_at, offer_accepted_at, rejection_reason, rejected_at, student_profile_id, tenant_id, created_at, updated_at, created_by, updated_by, deleted_at, deleted_by, version)
  ON admission_applications TO roviq_reseller;
