CREATE TYPE "AssessmentComponent" AS ENUM('THEORY', 'PRACTICAL', 'INTERNAL', 'PROJECT', 'ORAL');--> statement-breakpoint
CREATE TYPE "CompetencyLevel" AS ENUM('BEGINNER', 'PROGRESSING', 'PROFICIENT', 'ADVANCED');--> statement-breakpoint
CREATE TYPE "ExamStatus" AS ENUM('DRAFT', 'SCHEDULED', 'MARKS_ENTRY', 'LOCKED', 'RESULTS_PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "ExamType" AS ENUM('UNIT_TEST', 'PERIODIC_TEST', 'MID_TERM', 'HALF_YEARLY', 'FINAL_TERM', 'ANNUAL', 'PRACTICAL', 'PRE_BOARD', 'BOARD', 'INTERNAL_ASSESSMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "GradingSchemeKind" AS ENUM('SCHOLASTIC', 'CO_SCHOLASTIC');--> statement-breakpoint
CREATE TYPE "ReportCardStatus" AS ENUM('DRAFT', 'GENERATED', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "ResultStatus" AS ENUM('PASS', 'FAIL', 'COMPARTMENT', 'ABSENT', 'PENDING');--> statement-breakpoint
CREATE TABLE "co_scholastic_areas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" jsonb NOT NULL,
	"grading_scheme_id" uuid,
	"sequence" integer DEFAULT 0 NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "co_scholastic_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "co_scholastic_assessments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"co_scholastic_area_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"exam_term_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"descriptor" text,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exam_marks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"exam_schedule_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"obtained_marks" numeric(6,2),
	"is_absent" boolean DEFAULT false NOT NULL,
	"is_exempted" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exam_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"exam_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"component" "AssessmentComponent" DEFAULT 'THEORY'::"AssessmentComponent" NOT NULL,
	"exam_date" date,
	"start_time" time,
	"end_time" time,
	"max_marks" numeric(6,2) NOT NULL,
	"pass_marks" numeric(6,2),
	"room" text,
	"invigilator_id" uuid,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exam_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"academic_year_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"weight_in_final" numeric(5,2) DEFAULT '0' NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exam_topic_assessments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"exam_schedule_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"subject_topic_id" uuid NOT NULL,
	"competency_level" "CompetencyLevel" NOT NULL,
	"descriptor" text,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"academic_year_id" uuid NOT NULL,
	"exam_term_id" uuid,
	"name" jsonb NOT NULL,
	"type" "ExamType" DEFAULT 'UNIT_TEST'::"ExamType" NOT NULL,
	"grading_scheme_id" uuid,
	"status" "ExamStatus" DEFAULT 'DRAFT'::"ExamStatus" NOT NULL,
	"start_date" date,
	"end_date" date,
	"weight_in_term" numeric(5,2) DEFAULT '100' NOT NULL,
	"description" text,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "exams_date_range_check" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date")
);
--> statement-breakpoint
ALTER TABLE "exams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grade_bands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"grading_scheme_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"min_percent" numeric(5,2),
	"max_percent" numeric(5,2),
	"grade_point" numeric(4,2),
	"descriptor" text,
	"is_passing" boolean DEFAULT true NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grade_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grading_schemes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" jsonb NOT NULL,
	"kind" "GradingSchemeKind" DEFAULT 'SCHOLASTIC'::"GradingSchemeKind" NOT NULL,
	"board" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grading_schemes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_card_instances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"report_card_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"section_id" uuid,
	"academic_year_id" uuid NOT NULL,
	"status" "ReportCardStatus" DEFAULT 'DRAFT'::"ReportCardStatus" NOT NULL,
	"max_marks" numeric(8,2),
	"obtained_marks" numeric(8,2),
	"percentage" numeric(5,2),
	"gpa" numeric(4,2),
	"grade" text,
	"rank" integer,
	"attendance_percent" numeric(5,2),
	"result_status" "ResultStatus" DEFAULT 'PENDING'::"ResultStatus" NOT NULL,
	"class_teacher_remark" text,
	"principal_remark" text,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"generated_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_card_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"academic_year_id" uuid NOT NULL,
	"exam_term_id" uuid,
	"name" jsonb NOT NULL,
	"grading_scheme_id" uuid,
	"include_attendance" boolean DEFAULT true NOT NULL,
	"include_co_scholastic" boolean DEFAULT true NOT NULL,
	"include_topic_wise" boolean DEFAULT false NOT NULL,
	"status" "ReportCardStatus" DEFAULT 'DRAFT'::"ReportCardStatus" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_topics" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"subject_id" uuid NOT NULL,
	"standard_id" uuid,
	"name" jsonb NOT NULL,
	"code" text,
	"learning_outcome" text,
	"sequence" integer DEFAULT 0 NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "co_scholastic_areas_name_key" ON "co_scholastic_areas" ("tenant_id","name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "co_scholastic_areas_tenant_id_idx" ON "co_scholastic_areas" ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "co_scholastic_assessments_key" ON "co_scholastic_assessments" ("co_scholastic_area_id","student_id","exam_term_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "co_scholastic_assessments_tenant_id_idx" ON "co_scholastic_assessments" ("tenant_id");--> statement-breakpoint
CREATE INDEX "co_scholastic_assessments_student_id_idx" ON "co_scholastic_assessments" ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_marks_schedule_student_key" ON "exam_marks" ("exam_schedule_id","student_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exam_marks_tenant_id_idx" ON "exam_marks" ("tenant_id");--> statement-breakpoint
CREATE INDEX "exam_marks_schedule_id_idx" ON "exam_marks" ("exam_schedule_id");--> statement-breakpoint
CREATE INDEX "exam_marks_student_id_idx" ON "exam_marks" ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_schedules_cell_key" ON "exam_schedules" ("exam_id","section_id","subject_id","component") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exam_schedules_tenant_id_idx" ON "exam_schedules" ("tenant_id");--> statement-breakpoint
CREATE INDEX "exam_schedules_exam_id_idx" ON "exam_schedules" ("exam_id");--> statement-breakpoint
CREATE INDEX "exam_schedules_section_id_idx" ON "exam_schedules" ("section_id");--> statement-breakpoint
CREATE INDEX "exam_schedules_subject_id_idx" ON "exam_schedules" ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_terms_year_name_key" ON "exam_terms" ("tenant_id","academic_year_id","name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exam_terms_tenant_id_idx" ON "exam_terms" ("tenant_id");--> statement-breakpoint
CREATE INDEX "exam_terms_academic_year_id_idx" ON "exam_terms" ("academic_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_topic_assessments_key" ON "exam_topic_assessments" ("exam_schedule_id","student_id","subject_topic_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exam_topic_assessments_tenant_id_idx" ON "exam_topic_assessments" ("tenant_id");--> statement-breakpoint
CREATE INDEX "exam_topic_assessments_schedule_id_idx" ON "exam_topic_assessments" ("exam_schedule_id");--> statement-breakpoint
CREATE INDEX "exam_topic_assessments_student_id_idx" ON "exam_topic_assessments" ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_year_name_key" ON "exams" ("tenant_id","academic_year_id","name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exams_tenant_id_idx" ON "exams" ("tenant_id");--> statement-breakpoint
CREATE INDEX "exams_academic_year_id_idx" ON "exams" ("academic_year_id");--> statement-breakpoint
CREATE INDEX "exams_exam_term_id_idx" ON "exams" ("exam_term_id");--> statement-breakpoint
CREATE INDEX "exams_status_idx" ON "exams" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_bands_scheme_grade_key" ON "grade_bands" ("grading_scheme_id","grade") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "grade_bands_tenant_id_idx" ON "grade_bands" ("tenant_id");--> statement-breakpoint
CREATE INDEX "grade_bands_scheme_id_idx" ON "grade_bands" ("grading_scheme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_schemes_name_key" ON "grading_schemes" ("tenant_id","name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "grading_schemes_tenant_id_idx" ON "grading_schemes" ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_card_instances_card_student_key" ON "report_card_instances" ("report_card_id","student_profile_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "report_card_instances_tenant_id_idx" ON "report_card_instances" ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_card_instances_report_card_id_idx" ON "report_card_instances" ("report_card_id");--> statement-breakpoint
CREATE INDEX "report_card_instances_student_profile_id_idx" ON "report_card_instances" ("student_profile_id");--> statement-breakpoint
CREATE INDEX "report_card_instances_section_id_idx" ON "report_card_instances" ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_cards_year_name_key" ON "report_cards" ("tenant_id","academic_year_id","name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "report_cards_tenant_id_idx" ON "report_cards" ("tenant_id");--> statement-breakpoint
CREATE INDEX "report_cards_academic_year_id_idx" ON "report_cards" ("academic_year_id");--> statement-breakpoint
CREATE INDEX "report_cards_status_idx" ON "report_cards" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_topics_subject_standard_code_key" ON "subject_topics" ("subject_id","standard_id","code") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "subject_topics_tenant_id_idx" ON "subject_topics" ("tenant_id");--> statement-breakpoint
CREATE INDEX "subject_topics_subject_id_idx" ON "subject_topics" ("subject_id");--> statement-breakpoint
ALTER TABLE "co_scholastic_areas" ADD CONSTRAINT "co_scholastic_areas_grading_scheme_id_grading_schemes_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_areas" ADD CONSTRAINT "co_scholastic_areas_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_cqMSrDRJftpf_fkey" FOREIGN KEY ("co_scholastic_area_id") REFERENCES "co_scholastic_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_student_id_memberships_id_fkey" FOREIGN KEY ("student_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_exam_term_id_exam_terms_id_fkey" FOREIGN KEY ("exam_term_id") REFERENCES "exam_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "co_scholastic_assessments" ADD CONSTRAINT "co_scholastic_assessments_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_exam_schedule_id_exam_schedules_id_fkey" FOREIGN KEY ("exam_schedule_id") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_student_id_memberships_id_fkey" FOREIGN KEY ("student_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_exam_id_exams_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_section_id_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_subject_id_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_invigilator_id_memberships_id_fkey" FOREIGN KEY ("invigilator_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_academic_year_id_academic_years_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_terms" ADD CONSTRAINT "exam_terms_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_exam_schedule_id_exam_schedules_id_fkey" FOREIGN KEY ("exam_schedule_id") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_student_id_memberships_id_fkey" FOREIGN KEY ("student_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_subject_topic_id_subject_topics_id_fkey" FOREIGN KEY ("subject_topic_id") REFERENCES "subject_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exam_topic_assessments" ADD CONSTRAINT "exam_topic_assessments_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_academic_year_id_academic_years_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_term_id_exam_terms_id_fkey" FOREIGN KEY ("exam_term_id") REFERENCES "exam_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_grading_scheme_id_grading_schemes_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_grading_scheme_id_grading_schemes_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_report_card_id_report_cards_id_fkey" FOREIGN KEY ("report_card_id") REFERENCES "report_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_WdxDh7YVLIV3_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_section_id_sections_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_academic_year_id_academic_years_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_card_instances" ADD CONSTRAINT "report_card_instances_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_academic_year_id_academic_years_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_exam_term_id_exam_terms_id_fkey" FOREIGN KEY ("exam_term_id") REFERENCES "exam_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_grading_scheme_id_grading_schemes_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "report_cards" ADD CONSTRAINT "report_cards_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_subject_id_subjects_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_standard_id_standards_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_topics" ADD CONSTRAINT "subject_topics_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
CREATE VIEW "co_scholastic_areas_live" WITH (security_invoker = true) AS (select "id", "name", "grading_scheme_id", "sequence", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "co_scholastic_areas" where ("co_scholastic_areas"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "co_scholastic_assessments_live" WITH (security_invoker = true) AS (select "id", "co_scholastic_area_id", "student_id", "exam_term_id", "grade", "descriptor", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "co_scholastic_assessments" where ("co_scholastic_assessments"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "exam_marks_live" WITH (security_invoker = true) AS (select "id", "exam_schedule_id", "student_id", "obtained_marks", "is_absent", "is_exempted", "remarks", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "exam_marks" where ("exam_marks"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "exam_schedules_live" WITH (security_invoker = true) AS (select "id", "exam_id", "section_id", "subject_id", "component", "exam_date", "start_time", "end_time", "max_marks", "pass_marks", "room", "invigilator_id", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "exam_schedules" where ("exam_schedules"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "exam_terms_live" WITH (security_invoker = true) AS (select "id", "academic_year_id", "name", "sequence", "weight_in_final", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "exam_terms" where ("exam_terms"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "exam_topic_assessments_live" WITH (security_invoker = true) AS (select "id", "exam_schedule_id", "student_id", "subject_topic_id", "competency_level", "descriptor", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "exam_topic_assessments" where ("exam_topic_assessments"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "exams_live" WITH (security_invoker = true) AS (select "id", "academic_year_id", "exam_term_id", "name", "type", "grading_scheme_id", "status", "start_date", "end_date", "weight_in_term", "description", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "exams" where ("exams"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "grade_bands_live" WITH (security_invoker = true) AS (select "id", "grading_scheme_id", "grade", "min_percent", "max_percent", "grade_point", "descriptor", "is_passing", "sequence", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "grade_bands" where ("grade_bands"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "grading_schemes_live" WITH (security_invoker = true) AS (select "id", "name", "kind", "board", "is_default", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "grading_schemes" where ("grading_schemes"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "report_card_instances_live" WITH (security_invoker = true) AS (select "id", "report_card_id", "student_profile_id", "section_id", "academic_year_id", "status", "max_marks", "obtained_marks", "percentage", "gpa", "grade", "rank", "attendance_percent", "result_status", "class_teacher_remark", "principal_remark", "payload", "generated_at", "published_at", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "report_card_instances" where ("report_card_instances"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "report_cards_live" WITH (security_invoker = true) AS (select "id", "academic_year_id", "exam_term_id", "name", "grading_scheme_id", "include_attendance", "include_co_scholastic", "include_topic_wise", "status", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "report_cards" where ("report_cards"."deleted_at" is null));--> statement-breakpoint
CREATE VIEW "subject_topics_live" WITH (security_invoker = true) AS (select "id", "subject_id", "standard_id", "name", "code", "learning_outcome", "sequence", "tenant_id", "created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "version" from "subject_topics" where ("subject_topics"."deleted_at" is null));--> statement-breakpoint
CREATE POLICY "co_scholastic_areas_app_select" ON "co_scholastic_areas" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_areas_app_insert" ON "co_scholastic_areas" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_areas_app_update" ON "co_scholastic_areas" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_areas_app_delete" ON "co_scholastic_areas" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "co_scholastic_areas_reseller_read" ON "co_scholastic_areas" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "co_scholastic_areas_admin_all" ON "co_scholastic_areas" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "co_scholastic_assessments_app_select" ON "co_scholastic_assessments" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_assessments_app_insert" ON "co_scholastic_assessments" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_assessments_app_update" ON "co_scholastic_assessments" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "co_scholastic_assessments_app_delete" ON "co_scholastic_assessments" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "co_scholastic_assessments_reseller_read" ON "co_scholastic_assessments" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "co_scholastic_assessments_admin_all" ON "co_scholastic_assessments" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "exam_marks_app_select" ON "exam_marks" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_marks_app_insert" ON "exam_marks" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_marks_app_update" ON "exam_marks" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_marks_app_delete" ON "exam_marks" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "exam_marks_reseller_read" ON "exam_marks" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "exam_marks_admin_all" ON "exam_marks" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "exam_schedules_app_select" ON "exam_schedules" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_schedules_app_insert" ON "exam_schedules" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_schedules_app_update" ON "exam_schedules" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_schedules_app_delete" ON "exam_schedules" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "exam_schedules_reseller_read" ON "exam_schedules" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "exam_schedules_admin_all" ON "exam_schedules" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "exam_terms_app_select" ON "exam_terms" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_terms_app_insert" ON "exam_terms" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_terms_app_update" ON "exam_terms" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_terms_app_delete" ON "exam_terms" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "exam_terms_reseller_read" ON "exam_terms" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "exam_terms_admin_all" ON "exam_terms" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "exam_topic_assessments_app_select" ON "exam_topic_assessments" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_topic_assessments_app_insert" ON "exam_topic_assessments" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_topic_assessments_app_update" ON "exam_topic_assessments" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exam_topic_assessments_app_delete" ON "exam_topic_assessments" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "exam_topic_assessments_reseller_read" ON "exam_topic_assessments" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "exam_topic_assessments_admin_all" ON "exam_topic_assessments" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "exams_app_select" ON "exams" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exams_app_insert" ON "exams" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exams_app_update" ON "exams" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "exams_app_delete" ON "exams" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "exams_reseller_read" ON "exams" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "exams_admin_all" ON "exams" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "grade_bands_app_select" ON "grade_bands" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "grade_bands_app_insert" ON "grade_bands" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "grade_bands_app_update" ON "grade_bands" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "grade_bands_app_delete" ON "grade_bands" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "grade_bands_reseller_read" ON "grade_bands" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "grade_bands_admin_all" ON "grade_bands" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "grading_schemes_app_select" ON "grading_schemes" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "grading_schemes_app_insert" ON "grading_schemes" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "grading_schemes_app_update" ON "grading_schemes" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "grading_schemes_app_delete" ON "grading_schemes" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "grading_schemes_reseller_read" ON "grading_schemes" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "grading_schemes_admin_all" ON "grading_schemes" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "report_card_instances_app_select" ON "report_card_instances" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "report_card_instances_app_insert" ON "report_card_instances" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "report_card_instances_app_update" ON "report_card_instances" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "report_card_instances_app_delete" ON "report_card_instances" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "report_card_instances_reseller_read" ON "report_card_instances" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "report_card_instances_admin_all" ON "report_card_instances" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "report_cards_app_select" ON "report_cards" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "report_cards_app_insert" ON "report_cards" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "report_cards_app_update" ON "report_cards" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "report_cards_app_delete" ON "report_cards" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "report_cards_reseller_read" ON "report_cards" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "report_cards_admin_all" ON "report_cards" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "subject_topics_app_select" ON "subject_topics" AS PERMISSIVE FOR SELECT TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "subject_topics_app_insert" ON "subject_topics" AS PERMISSIVE FOR INSERT TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "subject_topics_app_update" ON "subject_topics" AS PERMISSIVE FOR UPDATE TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "subject_topics_app_delete" ON "subject_topics" AS PERMISSIVE FOR DELETE TO "roviq_app" USING (false);--> statement-breakpoint
CREATE POLICY "subject_topics_reseller_read" ON "subject_topics" AS PERMISSIVE FOR SELECT TO "roviq_reseller" USING (tenant_id IN (
      SELECT id FROM institutes
      WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
CREATE POLICY "subject_topics_admin_all" ON "subject_topics" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Grants for the new examination tables + live views (migrate path; dev/e2e get
-- these via the db-reset blanket GRANT + FORCE RLS loop). Mirrors the timetable migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "co_scholastic_areas", "co_scholastic_assessments", "exam_marks", "exam_schedules", "exam_terms", "exam_topic_assessments", "exams", "grade_bands", "grading_schemes", "report_card_instances", "report_cards", "subject_topics" TO roviq_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "co_scholastic_areas", "co_scholastic_assessments", "exam_marks", "exam_schedules", "exam_terms", "exam_topic_assessments", "exams", "grade_bands", "grading_schemes", "report_card_instances", "report_cards", "subject_topics" TO roviq_admin;--> statement-breakpoint
GRANT SELECT ON "co_scholastic_areas", "co_scholastic_assessments", "exam_marks", "exam_schedules", "exam_terms", "exam_topic_assessments", "exams", "grade_bands", "grading_schemes", "report_card_instances", "report_cards", "subject_topics" TO roviq_reseller;--> statement-breakpoint
GRANT SELECT ON "co_scholastic_areas_live", "co_scholastic_assessments_live", "exam_marks_live", "exam_schedules_live", "exam_terms_live", "exam_topic_assessments_live", "exams_live", "grade_bands_live", "grading_schemes_live", "report_card_instances_live", "report_cards_live", "subject_topics_live" TO roviq_app, roviq_reseller, roviq_admin;
