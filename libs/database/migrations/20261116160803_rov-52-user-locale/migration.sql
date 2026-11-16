ALTER TABLE "users" ADD COLUMN "preferred_locale" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_locale_check" CHECK ("preferred_locale" IN ('en', 'hi'));