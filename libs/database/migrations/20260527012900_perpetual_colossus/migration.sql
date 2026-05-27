CREATE TABLE "dlq_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"dlq_stream_seq" bigint NOT NULL UNIQUE,
	"original_subject" text NOT NULL,
	"origin_stream" text NOT NULL,
	"payload" jsonb,
	"error" text NOT NULL,
	"retry_count" integer NOT NULL,
	"correlation_id" text NOT NULL,
	"tenant_id" uuid,
	"failed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"replayed_at" timestamp with time zone,
	"replayed_by" uuid,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dlq_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "dlq_messages_status_idx" ON "dlq_messages" ("status");--> statement-breakpoint
CREATE INDEX "dlq_messages_origin_stream_idx" ON "dlq_messages" ("origin_stream");--> statement-breakpoint
ALTER TABLE "dlq_messages" ADD CONSTRAINT "dlq_messages_tenant_id_institutes_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "institutes"("id");--> statement-breakpoint
ALTER TABLE "dlq_messages" ADD CONSTRAINT "dlq_messages_replayed_by_users_id_fkey" FOREIGN KEY ("replayed_by") REFERENCES "users"("id");--> statement-breakpoint
CREATE POLICY "dlq_admin_all" ON "dlq_messages" AS PERMISSIVE FOR ALL TO "roviq_admin" USING (true) WITH CHECK (true);