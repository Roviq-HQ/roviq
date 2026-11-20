CREATE INDEX "application_document_files_file_id_idx" ON "application_document_files" ("file_id");--> statement-breakpoint
CREATE INDEX "leave_files_file_id_idx" ON "leave_files" ("file_id");--> statement-breakpoint
CREATE INDEX "idx_staff_qualifications_certificate_file" ON "staff_qualifications" ("certificate_file_id") WHERE certificate_file_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_document_files_file_id_idx" ON "user_document_files" ("file_id");--> statement-breakpoint
CREATE INDEX "idx_user_profiles_profile_image_file" ON "user_profiles" ("profile_image_file_id") WHERE profile_image_file_id IS NOT NULL;