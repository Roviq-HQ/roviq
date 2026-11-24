-- The audit_logs trigger reads institutes.id and institutes.reseller_id for reseller-scope entries,
-- and runs as the inserting role: the audit writer may read those two columns and nothing else.
GRANT SELECT (id, reseller_id) ON TABLE institutes TO roviq_audit_writer;
