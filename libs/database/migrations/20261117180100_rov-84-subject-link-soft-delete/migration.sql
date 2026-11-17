DROP INDEX "section_subjects_subject_section_key";--> statement-breakpoint
CREATE UNIQUE INDEX "section_subjects_subject_section_key" ON "section_subjects" ("subject_id","section_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "standard_subjects_subject_standard_key";--> statement-breakpoint
CREATE UNIQUE INDEX "standard_subjects_subject_standard_key" ON "standard_subjects" ("subject_id","standard_id") WHERE "deleted_at" IS NULL;