-- References that are cleared when the referenced row is deleted, between two tenant tables.
-- The key carries tenant_id, and ON DELETE SET NULL names the one column to clear: without the
-- column list PostgreSQL would clear tenant_id too. Drizzle cannot declare the column list, so
-- the schema declares no reference for these columns and this migration owns the keys.
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE SET NULL ("subject_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "co_scholastic_areas" ADD CONSTRAINT "co_scholastic_areas_grading_scheme_id_tenant_fkey" FOREIGN KEY ("grading_scheme_id","tenant_id") REFERENCES "grading_schemes"("id","tenant_id") ON DELETE SET NULL ("grading_scheme_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_term_id_tenant_fkey" FOREIGN KEY ("exam_term_id","tenant_id") REFERENCES "exam_terms"("id","tenant_id") ON DELETE SET NULL ("exam_term_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_grading_scheme_id_tenant_fkey" FOREIGN KEY ("grading_scheme_id","tenant_id") REFERENCES "grading_schemes"("id","tenant_id") ON DELETE SET NULL ("grading_scheme_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_invigilator_id_tenant_fkey" FOREIGN KEY ("invigilator_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE SET NULL ("invigilator_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_decided_by_tenant_fkey" FOREIGN KEY ("decided_by","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE SET NULL ("decided_by") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_section_id_tenant_fkey" FOREIGN KEY ("section_id","tenant_id") REFERENCES "sections"("id","tenant_id") ON DELETE SET NULL ("section_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_exam_term_id_tenant_fkey" FOREIGN KEY ("exam_term_id","tenant_id") REFERENCES "exam_terms"("id","tenant_id") ON DELETE SET NULL ("exam_term_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_grading_scheme_id_tenant_fkey" FOREIGN KEY ("grading_scheme_id","tenant_id") REFERENCES "grading_schemes"("id","tenant_id") ON DELETE SET NULL ("grading_scheme_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_teacher_id_tenant_fkey" FOREIGN KEY ("class_teacher_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE SET NULL ("class_teacher_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE SET NULL ("subject_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" ADD CONSTRAINT "timetable_day_overrides_teacher_id_tenant_fkey" FOREIGN KEY ("teacher_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE SET NULL ("teacher_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_subject_id_tenant_fkey" FOREIGN KEY ("subject_id","tenant_id") REFERENCES "subjects"("id","tenant_id") ON DELETE SET NULL ("subject_id") ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_tenant_fkey" FOREIGN KEY ("teacher_id","tenant_id") REFERENCES "memberships"("id","tenant_id") ON DELETE SET NULL ("teacher_id") ON UPDATE CASCADE;
