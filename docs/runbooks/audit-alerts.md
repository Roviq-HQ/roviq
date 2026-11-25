# Audit alerts

Five OpenObserve alerts in `docker/openobserve/alerts/audit_*.json` watch the audit pipeline: the
gateway publishes each audited action to the `AUDIT` stream, and its audit consumer
(`apps/api-gateway/src/audit/audit.consumer.ts`, durable `audit-log-writer`) writes it to
`audit_logs`. Each section below is what to check first when one fires.

## Consumer lag

`audit_consumer_lag` (warning): over 30 audit events have waited 5 minutes for
`audit-log-writer`. The audit log is incomplete until they are written.

1. The AUDIT stream in the Monitoring page's "Queue backlog (NATS)": a backlog that only grows
   means the consumer is not running or cannot write.
2. The gateway and PostgreSQL under "Services": the consumer writes through its own pool
   (`DATABASE_URL_AUDIT`, role `roviq_audit_writer`).
3. The gateway's log for `AuditConsumer` errors.

## Dead-lettered audit events

`audit_dlq_depth` (critical): audit events were dead-lettered (`audit_events_dlq_total`, label
`error_type`: `malformed_json` or `db_write_failure`), so some actions are missing from the audit
log.

1. The Dead Letter Queue tab (admin Observability page): the `AUDIT` messages and their error.
2. `db_write_failure`: the gateway's log names the failed insert; a missing monthly partition or
   a refused grant are the usual causes.
3. Fix the cause and replay the messages from the tab; a replayed entry is written once.

## Event spike

`audit_event_spike` (warning): audit events in the last hour are over three times the 7-day
hourly average.

1. The admin audit log, last hour: who made the changes and in which institute.
2. A bulk import or a planned migration explains it; otherwise confirm with the institute or
   the reseller that the change was intended.

## Impersonation volume

`audit_impersonation_volume` (info): more than 10 actions were taken while impersonating users
in one scope (label `scope`) in the last hour.

1. The admin impersonation sessions page: who impersonated whom, the stated reason and the
   session length.
2. End a session that is not expected, and review its actions in the audit log.

## Partition creation

`audit_partition_creation` (warning): it is the 28th or later and no audit event has been
consumed, so next month's `audit_logs` partition may not be ready.

1. The audit consumer is running (see "Consumer lag" above).
2. Temporal schedule `audit-partition-cron` (task queue `audit-maintenance`) ran this month; the
   gateway also creates the partitions at start and once a day
   (`apps/api-gateway/src/audit/audit-partition-maintainer.ts`).
