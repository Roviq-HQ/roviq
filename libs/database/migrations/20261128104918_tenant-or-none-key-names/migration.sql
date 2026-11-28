ALTER TABLE "application_document_files" DROP CONSTRAINT "application_document_files_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "issued_certificates" DROP CONSTRAINT "issued_certificates_pdf_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "tc_register" DROP CONSTRAINT "tc_register_pdf_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_notification_id_notifications_id_fkey";--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_sender_id_messaging_senders_id_fkey";--> statement-breakpoint
ALTER TABLE "export_reports" DROP CONSTRAINT "export_reports_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "institute_branding" DROP CONSTRAINT "institute_branding_logo_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "institute_branding" DROP CONSTRAINT "institute_branding_favicon_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "institute_branding" DROP CONSTRAINT "institute_branding_cover_image_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "leave_files" DROP CONSTRAINT "leave_files_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role_id_roles_id_fkey";--> statement-breakpoint
ALTER TABLE "staff_qualifications" DROP CONSTRAINT "staff_qualifications_certificate_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "tenant_user_profiles" DROP CONSTRAINT "tenant_user_profiles_profile_image_file_id_files_id_fkey";--> statement-breakpoint
ALTER TABLE "application_document_files" ADD CONSTRAINT "application_document_files_file_id_tenant_or_none_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "issued_certificates" ADD CONSTRAINT "issued_certificates_pdf_file_id_tenant_or_none_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "files"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tc_register" ADD CONSTRAINT "tc_register_pdf_file_id_tenant_or_none_fkey" FOREIGN KEY ("pdf_file_id") REFERENCES "files"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_sender_id_tenant_or_none_fkey" FOREIGN KEY ("sender_id") REFERENCES "messaging_senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_tenant_or_none_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "export_reports" ADD CONSTRAINT "export_reports_file_id_tenant_or_none_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD CONSTRAINT "institute_branding_cover_image_file_id_tenant_or_none_fkey" FOREIGN KEY ("cover_image_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD CONSTRAINT "institute_branding_favicon_file_id_tenant_or_none_fkey" FOREIGN KEY ("favicon_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "institute_branding" ADD CONSTRAINT "institute_branding_logo_file_id_tenant_or_none_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "leave_files" ADD CONSTRAINT "leave_files_file_id_tenant_or_none_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_tenant_or_none_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "staff_qualifications" ADD CONSTRAINT "staff_qualifications_certificate_file_id_tenant_or_none_fkey" FOREIGN KEY ("certificate_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_user_profiles" ADD CONSTRAINT "tenant_user_profiles_profile_image_file_id_tenant_or_none_fkey" FOREIGN KEY ("profile_image_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;