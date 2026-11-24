-- SF-082: the audit and dead-letter consumers connected as the owner role. They now log in as
-- roviq_audit_writer, which may only INSERT into audit_logs and dlq_messages. Production creates
-- the role with its own password before migrating; the development password below is used only
-- when the role does not exist yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'roviq_audit_writer') THEN
    CREATE ROLE roviq_audit_writer WITH LOGIN NOINHERIT PASSWORD 'roviq_audit_writer_dev';
  END IF;
END
$$;--> statement-breakpoint
ALTER ROLE roviq_audit_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO roviq_audit_writer;--> statement-breakpoint
GRANT INSERT ON TABLE audit_logs, dlq_messages TO roviq_audit_writer;--> statement-breakpoint
-- ON CONFLICT reads the conflict key and, under forced row security, checks the new row against a
-- SELECT policy. SELECT is granted on the key columns only, so the role still reads no content.
GRANT SELECT (id, created_at) ON TABLE audit_logs TO roviq_audit_writer;--> statement-breakpoint
GRANT SELECT (dlq_stream_seq) ON TABLE dlq_messages TO roviq_audit_writer;--> statement-breakpoint
CREATE POLICY audit_writer_insert ON audit_logs FOR INSERT TO roviq_audit_writer WITH CHECK (true);--> statement-breakpoint
CREATE POLICY audit_writer_conflict_key ON audit_logs FOR SELECT TO roviq_audit_writer USING (true);
