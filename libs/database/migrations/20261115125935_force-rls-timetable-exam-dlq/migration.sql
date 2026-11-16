-- .enableRLS() sets ENABLE only; these tables shipped without the FORCE step.
ALTER TABLE "timetables" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timetable_sections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timetable_periods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timetable_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timetable_day_overrides" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dlq_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "co_scholastic_areas" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exam_marks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exam_schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exam_terms" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exams" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "grade_bands" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "grading_schemes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_card_instances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_cards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subject_topics" FORCE ROW LEVEL SECURITY;
