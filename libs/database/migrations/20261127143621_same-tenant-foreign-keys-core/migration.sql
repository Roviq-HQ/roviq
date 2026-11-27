ALTER TABLE "admission_applications" DROP CONSTRAINT "admission_applications_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "admission_applications" DROP CONSTRAINT "admission_applications_standard_id_standards_id_fkey";--> statement-breakpoint
ALTER TABLE "admission_applications" DROP CONSTRAINT "admission_applications_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "admission_applications" DROP CONSTRAINT "admission_applications_6cdbMAv5hrpA_fkey";--> statement-breakpoint
ALTER TABLE "enquiries" DROP CONSTRAINT "enquiries_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "issued_certificates" DROP CONSTRAINT "issued_certificates_student_profile_id_student_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "tc_register" DROP CONSTRAINT "tc_register_student_profile_id_student_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "tc_register" DROP CONSTRAINT "tc_register_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "group_members" DROP CONSTRAINT "group_members_membership_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "attendance_entries" DROP CONSTRAINT "attendance_entries_student_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "attendance_sessions" DROP CONSTRAINT "attendance_sessions_lecturer_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" DROP CONSTRAINT "co_scholastic_assessments_student_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_marks" DROP CONSTRAINT "exam_marks_student_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_schedules" DROP CONSTRAINT "exam_schedules_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_terms" DROP CONSTRAINT "exam_terms_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" DROP CONSTRAINT "exam_topic_assessments_student_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "exams" DROP CONSTRAINT "exams_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "report_card_instances" DROP CONSTRAINT "report_card_instances_WdxDh7YVLIV3_fkey";--> statement-breakpoint
ALTER TABLE "report_card_instances" DROP CONSTRAINT "report_card_instances_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "report_cards" DROP CONSTRAINT "report_cards_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "subject_topics" DROP CONSTRAINT "subject_topics_standard_id_standards_id_fkey";--> statement-breakpoint
ALTER TABLE "leaves" DROP CONSTRAINT "leaves_user_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "section_subjects" DROP CONSTRAINT "section_subjects_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "sections" DROP CONSTRAINT "sections_standard_id_standards_id_fkey";--> statement-breakpoint
ALTER TABLE "sections" DROP CONSTRAINT "sections_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "standard_subjects" DROP CONSTRAINT "standard_subjects_standard_id_standards_id_fkey";--> statement-breakpoint
ALTER TABLE "standards" DROP CONSTRAINT "standards_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" DROP CONSTRAINT "timetable_day_overrides_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_entries" DROP CONSTRAINT "timetable_entries_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "timetable_sections" DROP CONSTRAINT "timetable_sections_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "timetables" DROP CONSTRAINT "timetables_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" DROP CONSTRAINT "year_rollover_section_map_5l6ASVtubVg3_fkey";--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" DROP CONSTRAINT "year_rollover_section_map_from_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" DROP CONSTRAINT "year_rollover_section_map_to_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "bot_profiles" DROP CONSTRAINT "bot_profiles_membership_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_student_profile_id_student_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "guardian_profiles" DROP CONSTRAINT "guardian_profiles_membership_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "staff_profiles" DROP CONSTRAINT "staff_profiles_membership_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "student_academics" DROP CONSTRAINT "student_academics_student_profile_id_student_profiles_id_fkey";--> statement-breakpoint
ALTER TABLE "student_academics" DROP CONSTRAINT "student_academics_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
ALTER TABLE "student_academics" DROP CONSTRAINT "student_academics_standard_id_standards_id_fkey";--> statement-breakpoint
ALTER TABLE "student_academics" DROP CONSTRAINT "student_academics_section_id_sections_id_fkey";--> statement-breakpoint
ALTER TABLE "student_academics" DROP CONSTRAINT "student_academics_promoted_to_standard_id_standards_id_fkey";--> statement-breakpoint
ALTER TABLE "student_guardian_links" DROP CONSTRAINT "student_guardian_links_GCqIVzPVwLIW_fkey";--> statement-breakpoint
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_membership_id_memberships_id_fkey";--> statement-breakpoint
ALTER TABLE "export_reports" DROP CONSTRAINT "export_reports_academic_year_id_academic_years_id_fkey";--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_id_tenant_key" ON "memberships" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_id_tenant_key" ON "sections" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "standards_id_tenant_key" ON "standards" ("id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_id_tenant_key" ON "student_profiles" ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_standard_id_tenant_fkey" FOREIGN KEY ("standard_id","tenant_id") REFERENCES "standards"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "issued_certificates" ADD CONSTRAINT "issued_certificates_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id");--> statement-breakpoint
ALTER TABLE "tc_register" ADD CONSTRAINT "tc_register_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_membership_id_tenant_fkey" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "attendance_entries" ADD CONSTRAINT "attendance_entries_student_id_tenant_fkey" FOREIGN KEY ("student_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_lecturer_id_tenant_fkey" FOREIGN KEY ("lecturer_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_student_id_tenant_fkey" FOREIGN KEY ("student_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_student_id_tenant_fkey" FOREIGN KEY ("student_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_student_id_tenant_fkey" FOREIGN KEY ("student_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_standard_id_tenant_fkey" FOREIGN KEY ("standard_id","tenant_id") REFERENCES "standards"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_user_id_tenant_fkey" FOREIGN KEY ("user_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_standard_id_tenant_fkey" FOREIGN KEY ("standard_id","tenant_id") REFERENCES "standards"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "standard_subjects" ADD CONSTRAINT "standard_subjects_standard_id_tenant_fkey" FOREIGN KEY ("standard_id","tenant_id") REFERENCES "standards"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "standards" ADD CONSTRAINT "standards_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetable_sections" ADD CONSTRAINT "timetable_sections_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_from_section_id_tenant_fkey" FOREIGN KEY ("from_section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "year_rollover_section_map" ADD CONSTRAINT "year_rollover_section_map_to_section_id_tenant_fkey" FOREIGN KEY ("to_section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "bot_profiles" ADD CONSTRAINT "bot_profiles_membership_id_tenant_fkey" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "guardian_profiles" ADD CONSTRAINT "guardian_profiles_membership_id_tenant_fkey" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_membership_id_tenant_fkey" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_academics" ADD CONSTRAINT "student_academics_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_academics" ADD CONSTRAINT "student_academics_academic_year_id_tenant_fkey" FOREIGN KEY ("academic_year_id","tenant_id") REFERENCES "academic_years"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_academics" ADD CONSTRAINT "student_academics_standard_id_tenant_fkey" FOREIGN KEY ("standard_id","tenant_id") REFERENCES "standards"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_academics" ADD CONSTRAINT "student_academics_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_academics" ADD CONSTRAINT "student_academics_promoted_to_standard_id_tenant_fkey" FOREIGN KEY ("promoted_to_standard_id","tenant_id") REFERENCES "standards"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_guardian_links" ADD CONSTRAINT "student_guardian_links_student_profile_id_tenant_fkey" FOREIGN KEY ("student_profile_id","tenant_id") REFERENCES "student_profiles"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_membership_id_tenant_fkey" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;