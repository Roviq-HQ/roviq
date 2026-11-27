ALTER TABLE "admission_applications" DROP CONSTRAINT "admission_applications_enquiry_id_enquiries_id_fkey";--> statement-breakpoint
ALTER TABLE "application_document_files" DROP CONSTRAINT "application_document_files_MzrAsHaJCjK8_fkey";--> statement-breakpoint
ALTER TABLE "application_documents" DROP CONSTRAINT "application_documents_WgmkSIF9SKRI_fkey";--> statement-breakpoint
ALTER TABLE "issued_certificates" DROP CONSTRAINT "issued_certificates_template_id_certificate_templates_id_fkey";--> statement-breakpoint
ALTER TABLE "issued_certificates" DROP CONSTRAINT "issued_certificates_staff_profile_id_staff_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "tc_register" DROP CONSTRAINT "tc_register_original_tc_id_tc_register_id_fkey";--> statement-breakpoint
ALTER TABLE "group_children" DROP CONSTRAINT "group_children_parent_group_id_groups_id_fkey";--> statement-breakpoint
ALTER TABLE "group_children" DROP CONSTRAINT "group_children_child_group_id_groups_id_fkey";--> statement-breakpoint
ALTER TABLE "group_members" DROP CONSTRAINT "group_members_group_id_groups_id_fkey";--> statement-breakpoint
ALTER TABLE "group_rules" DROP CONSTRAINT "group_rules_group_id_groups_id_fkey";--> statement-breakpoint
ALTER TABLE "groups" DROP CONSTRAINT "groups_parent_group_id_groups_id_fkey";--> statement-breakpoint
ALTER TABLE "attendance_entries" DROP CONSTRAINT "attendance_entries_session_id_attendance_sessions_id_fkey";--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" DROP CONSTRAINT "co_scholastic_assessments_cqMSrDRJftpf_fkey";--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" DROP CONSTRAINT "co_scholastic_assessments_exam_term_id_exam_terms_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_marks" DROP CONSTRAINT "exam_marks_exam_schedule_id_exam_schedules_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_schedules" DROP CONSTRAINT "exam_schedules_exam_id_exams_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_schedules" DROP CONSTRAINT "exam_schedules_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_schedules" DROP CONSTRAINT "exam_schedules_invigilator_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" DROP CONSTRAINT "exam_topic_assessments_exam_schedule_id_exam_schedules_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" DROP CONSTRAINT "exam_topic_assessments_subject_topic_id_subject_topics_id_fkey";--> statement-breakpoint
ALTER TABLE "grade_bands" DROP CONSTRAINT "grade_bands_grading_scheme_id_grading_schemes_id_fkey";--> statement-breakpoint
ALTER TABLE "report_card_instances" DROP CONSTRAINT "report_card_instances_report_card_id_report_cards_id_fkey";--> statement-breakpoint
ALTER TABLE "report_card_instances" DROP CONSTRAINT "report_card_instances_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "subject_topics" DROP CONSTRAINT "subject_topics_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "leave_files" DROP CONSTRAINT "leave_files_leave_id_leaves_id_fkey";--> statement-breakpoint
ALTER TABLE "section_subjects" DROP CONSTRAINT "section_subjects_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "standard_subjects" DROP CONSTRAINT "standard_subjects_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" DROP CONSTRAINT "timetable_day_overrides_timetable_id_timetables_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" DROP CONSTRAINT "timetable_day_overrides_period_id_timetable_periods_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" DROP CONSTRAINT "timetable_day_overrides_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" DROP CONSTRAINT "timetable_day_overrides_teacher_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_entries" DROP CONSTRAINT "timetable_entries_timetable_id_timetables_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_entries" DROP CONSTRAINT "timetable_entries_period_id_timetable_periods_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_entries" DROP CONSTRAINT "timetable_entries_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_entries" DROP CONSTRAINT "timetable_entries_teacher_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_periods" DROP CONSTRAINT "timetable_periods_timetable_id_timetables_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_sections" DROP CONSTRAINT "timetable_sections_timetable_id_timetables_id_fkey";--> statement-breakpoint
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_guardian_profile_id_guardian_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_privacy_notice_id_privacy_notices_id_fkey";--> statement-breakpoint
ALTER TABLE "staff_qualifications" DROP CONSTRAINT "staff_qualifications_staff_profile_id_staff_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "student_guardian_links" DROP CONSTRAINT "student_guardian_links_r7usGhO98cSy_fkey";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_subscription_id_subscriptions_id_fkey";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_invoice_id_invoices_id_fkey";--> statement-breakpoint
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_subject_id_subjects_id_fkey";--> statement-breakpoint
ALTER TABLE "co_scholastic_areas" DROP CONSTRAINT "co_scholastic_areas_grading_scheme_id_grading_schemes_id_fkey";--> statement-breakpoint
ALTER TABLE "exams" DROP CONSTRAINT "exams_exam_term_id_exam_terms_id_fkey";--> statement-breakpoint
ALTER TABLE "exams" DROP CONSTRAINT "exams_grading_scheme_id_grading_schemes_id_fkey";--> statement-breakpoint
ALTER TABLE "report_cards" DROP CONSTRAINT "report_cards_exam_term_id_exam_terms_id_fkey";--> statement-breakpoint
ALTER TABLE "report_cards" DROP CONSTRAINT "report_cards_grading_scheme_id_grading_schemes_id_fkey";--> statement-breakpoint
ALTER TABLE "leaves" DROP CONSTRAINT "leaves_decided_by_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "sections" DROP CONSTRAINT "sections_class_teacher_id_memberships_id_fkey";--> statement-breakpoint
CREATE UNIQUE INDEX "admission_applications_id_tenant_key" ON "admission_applications" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_documents_id_tenant_key" ON "application_documents" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_templates_id_tenant_key" ON "certificate_templates" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_id_tenant_key" ON "enquiries" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tc_register_id_tenant_key" ON "tc_register" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_id_tenant_key" ON "groups" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_id_tenant_key" ON "attendance_sessions" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "co_scholastic_areas_id_tenant_key" ON "co_scholastic_areas" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_schedules_id_tenant_key" ON "exam_schedules" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_terms_id_tenant_key" ON "exam_terms" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_id_tenant_key" ON "exams" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_schemes_id_tenant_key" ON "grading_schemes" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_cards_id_tenant_key" ON "report_cards" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_topics_id_tenant_key" ON "subject_topics" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leaves_id_tenant_key" ON "leaves" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_id_tenant_key" ON "subjects" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_periods_id_tenant_key" ON "timetable_periods" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetables_id_tenant_key" ON "timetables" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_profiles_id_tenant_key" ON "guardian_profiles" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_notices_id_tenant_key" ON "privacy_notices" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_id_tenant_key" ON "staff_profiles" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_id_tenant_key" ON "invoices" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_id_tenant_key" ON "subscriptions" ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_enquiry_id_tenant_fkey" FOREIGN KEY ("enquiry_id","tenant_id") REFERENCES "enquiries"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "application_document_files" ADD CONSTRAINT "application_document_files_document_id_tenant_fkey" FOREIGN KEY ("document_id","tenant_id") REFERENCES "application_documents"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_tenant_fkey" FOREIGN KEY ("application_id","tenant_id") REFERENCES "admission_applications"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "issued_certificates" ADD CONSTRAINT "issued_certificates_template_id_tenant_fkey" FOREIGN KEY ("template_id","tenant_id") REFERENCES "certificate_templates"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "issued_certificates" ADD CONSTRAINT "issued_certificates_staff_profile_id_tenant_fkey" FOREIGN KEY ("staff_profile_id","tenant_id") REFERENCES "staff_profiles"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "tc_register" ADD CONSTRAINT "tc_register_original_tc_id_tenant_fkey" FOREIGN KEY ("original_tc_id","tenant_id") REFERENCES "tc_register"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "group_children" ADD CONSTRAINT "group_children_parent_group_id_tenant_fkey" FOREIGN KEY ("parent_group_id","tenant_id") REFERENCES "groups"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "group_children" ADD CONSTRAINT "group_children_child_group_id_tenant_fkey" FOREIGN KEY ("child_group_id","tenant_id") REFERENCES "groups"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_tenant_fkey" FOREIGN KEY ("group_id","tenant_id") REFERENCES "groups"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "group_rules" ADD CONSTRAINT "group_rules_group_id_tenant_fkey" FOREIGN KEY ("group_id","tenant_id") REFERENCES "groups"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_group_id_tenant_fkey" FOREIGN KEY ("parent_group_id","tenant_id") REFERENCES "groups"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_session_id_tenant_fkey" FOREIGN KEY ("session_id","tenant_id") REFERENCES "attendance_sessions"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_exam_term_id_tenant_fkey" FOREIGN KEY ("exam_term_id","tenant_id") REFERENCES "exam_terms"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_co_scholastic_area_id_tenant_fkey" FOREIGN KEY ("co_scholastic_area_id","tenant_id") REFERENCES "co_scholastic_areas"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_exam_schedule_id_tenant_fkey" FOREIGN KEY ("exam_schedule_id","tenant_id") REFERENCES "exam_schedules"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_exam_id_tenant_fkey" FOREIGN KEY ("exam_id","tenant_id") REFERENCES "exams"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_subject_topic_id_tenant_fkey" FOREIGN KEY ("subject_topic_id","tenant_id") REFERENCES "subject_topics"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_exam_schedule_id_tenant_fkey" FOREIGN KEY ("exam_schedule_id","tenant_id") REFERENCES "exam_schedules"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_grading_scheme_id_tenant_fkey" FOREIGN KEY ("grading_scheme_id","tenant_id") REFERENCES "grading_schemes"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_report_card_id_tenant_fkey" FOREIGN KEY ("report_card_id","tenant_id") REFERENCES "report_cards"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "leave_files" ADD CONSTRAINT "leave_files_leave_id_tenant_fkey" FOREIGN KEY ("leave_id","tenant_id") REFERENCES "leaves"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "standard_subjects" ADD CONSTRAINT "standard_subjects_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_timetable_id_tenant_fkey" FOREIGN KEY ("timetable_id","tenant_id") REFERENCES "timetables"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_period_id_tenant_fkey" FOREIGN KEY ("period_id","tenant_id") REFERENCES "timetable_periods"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_timetable_id_tenant_fkey" FOREIGN KEY ("timetable_id","tenant_id") REFERENCES "timetables"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_period_id_tenant_fkey" FOREIGN KEY ("period_id","tenant_id") REFERENCES "timetable_periods"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_periods" ADD CONSTRAINT "timetable_periods_timetable_id_tenant_fkey" FOREIGN KEY ("timetable_id","tenant_id") REFERENCES "timetables"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_sections" ADD CONSTRAINT "timetable_sections_timetable_id_tenant_fkey" FOREIGN KEY ("timetable_id","tenant_id") REFERENCES "timetables"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_privacy_notice_id_tenant_fkey" FOREIGN KEY ("privacy_notice_id","tenant_id") REFERENCES "privacy_notices"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_guardian_profile_id_tenant_fkey" FOREIGN KEY ("guardian_profile_id","tenant_id") REFERENCES "guardian_profiles"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD CONSTRAINT "staff_qualifications_staff_profile_id_tenant_fkey" FOREIGN KEY ("staff_profile_id","tenant_id") REFERENCES "staff_profiles"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD CONSTRAINT "student_guardian_links_guardian_profile_id_tenant_fkey" FOREIGN KEY ("guardian_profile_id","tenant_id") REFERENCES "guardian_profiles"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_tenant_fkey" FOREIGN KEY ("subscription_id","tenant_id") REFERENCES "subscriptions"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_tenant_fkey" FOREIGN KEY ("invoice_id","tenant_id") REFERENCES "invoices"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;