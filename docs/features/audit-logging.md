# Audit Logging

System-wide, immutable audit trail for all three scopes (platform, reseller, institute).

## Architecture

```
Mutation → AuditInterceptor → NATS JetStream (AUDIT.log)
                                    ↓
Service side-effects → AuditEmitter → NATS JetStream (AUDIT.log)
                                    ↓
                            AuditConsumer (batched)
                                    ↓
                        PostgreSQL audit_logs (partitioned)
                                    ↓
                        GraphQL query API (3 resolvers)
```

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `audit_logs` table | `libs/database/src/schema/audit/audit-logs.ts` | 20-column partitioned table with RLS |
| `AuditInterceptor` | `apps/api-gateway/src/audit/audit.interceptor.ts` | Gateway mutation capture (Layer 1) |
| `AuditEmitter` | `libs/backend/audit/src/audit-emitter.ts` | Service-level event emission (Layer 2) |
| `AuditConsumer` | `apps/api-gateway/src/audit/audit.consumer.ts` | Batched raw SQL writes from NATS |
| Resolvers | `apps/api-gateway/src/{admin,reseller,institute}/audit/*-audit.resolver.ts` | `adminAuditLogs`, `adminAuthEvents` (platform), `resellerAuditLogs` (reseller), `auditLogs`, `entityAuditTimeline` (institute) |
| Decorators | `libs/backend/audit/src/decorators/` | `@AuditMask()`, `@NoAudit()`, `@AuditInstitute()` |
| Partition workflow | `apps/api-gateway/src/audit/workflows/` | Temporal cron for monthly partition management |

## Database Schema

20 columns, partitioned by `created_at` (monthly), FORCE ROW LEVEL SECURITY:

- **Scope columns**: `scope`, `tenant_id` (nullable), `reseller_id` (nullable)
- **Subject column**: `subject_tenant_id` (nullable), the institute a platform or reseller action was about. `chk_audit_subject_tenant` keeps it NULL on institute-scoped rows
- **Actor columns**: `user_id`, `actor_id`, `impersonator_id`, `impersonation_session_id`
- **Event columns**: `action`, `action_type`, `entity_type`, `entity_id`, `changes` (JSONB), `metadata` (JSONB)
- **Tracing**: `correlation_id`, `ip_address`, `user_agent`, `source`
- **CHECK constraint** (`chk_audit_scope`): enforces scope/FK consistency

**Indexes live in the custom migration.** `audit_logs` is created there as a partitioned table, so its indexes are created there too, with `CREATE INDEX IF NOT EXISTS` (examples: `audit_logs_synthetic_origin_idx`, `audit_logs_subject_tenant_idx`).

## RLS Policies (5 roles)

| Role | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| `roviq_app` | scope='institute' + tenant match, or `subject_tenant_id` = tenant | **Denied** (no privilege) | **Denied** | **Denied** |
| `roviq_reseller` | their institutes + own reseller entries | **Denied** (no privilege) | **Denied** | **Denied** |
| `roviq_admin` | All | All | All | All |
| `roviq_pooler` | **Denied** (NOINHERIT) | — | — | — |

### Platform and reseller actions about an institute (ROV-311)

An institute also reads the platform- and reseller-scoped rows that name it in `subject_tenant_id`.

- **Naming the institute**: `@AuditInstitute('<argument path>')` on the resolver method (for example `@AuditInstitute('id')` or `@AuditInstitute('input.instituteId')`). When the arguments do not hold the id, call `markAuditInstitute(req, id)` in the resolver once the institute is known. A new platform or reseller mutation that acts on one institute must carry one of the two, or the institute will not see it. Nothing enforces this yet.
- **Refused actions**: the interceptor takes the subject from the arguments only when the mutation succeeded or the caller is a platform admin. A refused reseller action names an institute only if the server confirmed it with `markAuditInstitute`.
- **Database trigger**: `trg_audit_logs_check_subject_tenant` clears the subject of a reseller row whose institute belongs to another reseller.
- **What the institute gets**: the `auditLogs` query returns actor, action and the stated reason of such a row. IP address, user agent, impersonation ids are nulled and `metadata` is reduced to `{ reason }`. RLS exposes the whole row to SQL run as `roviq_app`, which only the gateway does.
- **Screen**: rows carry `scope`; the institute audit page marks them "Roviq platform" or "Reseller".
- **Not covered**: `adminStartImpersonation` (`@NoAudit`) and `adminUserDocumentDownloadUrl` (names no institute).
- **The migration is custom** (first line is a comment): `db:reset` replays `audit-logs-infra`, which re-creates the audit policies with their original text, so a policy change must be replayed after it.

### Partition children are sealed

Policies and GRANTs on `audit_logs` only cover access through the parent. Each `audit_logs_YYYY_MM` child is its own relation, so every child carries **no** privileges for `roviq_app` / `roviq_reseller` / `roviq_admin` and has FORCE RLS with no policies — direct `SELECT/INSERT/UPDATE/DELETE` on a child is `permission denied` for all runtime roles. This also holds after a partition is detached.

`lock_down_partitions(parent)` applies the seal. It runs inside `ensure_monthly_partition()` on every call (boot, daily timer, `db-reset`, Temporal), so new partitions are born sealed and any sibling reopened by a later blanket `GRANT ... ON ALL TABLES` is re-sealed within a day. Always query the parent; never name a partition in application SQL.

## Partition Management (Temporal)

Monthly partitions created via Temporal cron workflow:

- **Schedule**: 25th of each month at 2 AM UTC (5-day safety margin)
- **Task queue**: `audit-maintenance`
- **Workflow**: `auditPartitionManagement`
- **Activities**: `createNextMonthPartition` (idempotent), `enforceRetention` (detach, not drop), `verifyPartitionHealth`
- **DDL path**: activities run as `roviq_admin`, which owns no tables, so they call the `SECURITY DEFINER` functions `ensure_monthly_partition()` and `detach_monthly_partition()` rather than issuing partition DDL themselves
- **Retention**: 1 year default (per-tenant tiers deferred to billing)

### Running the worker

```bash
npx ts-node apps/api-gateway/src/audit/workflows/partition.worker.ts
```

### Registering the schedule

```bash
npx ts-node apps/api-gateway/src/audit/workflows/partition.schedule.ts
```

## CASL Authorization

`read:AuditLog` ability required. Granted to:
- `platform_admin`, `platform_support` (via `manage:all` / `read:all`)
- `reseller_full_admin`
- `institute_admin` (via `manage:all`)

Not granted to: `teacher`, `student`, `parent`

## UI Components (`@roviq/ui`)

- `<AuditDiffRenderer>` — visual JSONB diff (UPDATE/CREATE/DELETE)
- `<ImpersonationBadge>` — scope-colored impersonation indicator
- `<EntityTimeline>` — embeddable entity audit history

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL_AUDIT` | pg Pool of the audit and dead-letter consumers, as `roviq_audit_writer` (INSERT into `audit_logs` and `dlq_messages` only) | `postgresql://roviq_audit_writer:roviq_audit_writer_dev@localhost:5434/roviq` |
| `TEMPORAL_ADDRESS` | Temporal server for partition workflow | `localhost:7233` |

## Institute Portal (ROV-76)

Route: `apps/web/src/app/[locale]/institute/(dashboard)/audit/`

- Uses `auditLogs` query (institute scope, RLS enforced by `roviq_app`)
- Frontend does NOT filter by tenant — RLS handles isolation
- `<ImpersonationBadge>` on all impersonated entries (purple=platform, blue=reseller, grey=intra-institute)
- `<AuditDiffRenderer>` in detail sheet for changes visualization
- Filters via nuqs: entityType, actionType, userId, dateRange (dateFrom/dateTo)
- Changes preview column: first changed field + count of additional fields
- `<Can I="read" a="AuditLog">` authorization guard
- i18n: en + hi (shared `auditLogs` namespace)

## Observability (ROV-78)

### OTel Metrics

| Metric | Type | Labels | Location |
|--------|------|--------|----------|
| `audit_events_published_total` | Counter | scope, source, entity_type | AuditInterceptor |
| `audit_events_error_total` | Counter | error_type | AuditInterceptor |
| `audit_impersonation_total` | Counter | scope | AuditInterceptor |
| `audit_events_consumed_total` | Counter | — | AuditConsumer |
| `audit_events_dlq_total` | Counter | error_type | AuditConsumer |

### Dashboard

File: `docker/openobserve/dashboards/audit-logging.json`, loaded by `pnpm observability:load`
(`docs/infrastructure.md` → "Observability").

9 panels in 3 rows:
1. Pipeline health: throughput (by scope), consumer lag, dead-lettered events
2. Errors and scope: error rate, events by scope, events by source
3. Impersonation and entities: impersonated actions, top entity types, events published

### Alert rules

Files: `docker/openobserve/alerts/` (the five `audit_*.json` files)

| Alert | Condition | Severity |
|-------|-----------|----------|
| `audit_dlq_depth` | `sum(audit_events_dlq_total) > 0` for 1 min | critical |
| `audit_consumer_lag` | `jetstream_consumer_num_pending` of `audit-log-writer` > 30 for 5 min | warning |
| `audit_event_spike` | events in the last hour > 3x the 7-day hourly average, for 5 min | warning |
| `audit_impersonation_volume` | more than 10 impersonated actions in one scope in an hour | info |
| `audit_partition_creation` | no event consumed and the day of the month is 28 or later, for 1 hour | warning |

## Testing

- **Unit tests**: `pnpm test` (interceptor: 38, consumer: 12, emitter: 9, helpers: 17)
- **Integration tests**: `pnpm test:int` (15 audit + 22 security invariants)
- **E2E tests**: `pnpm tilt trigger e2e-gateway` (RLS, CHECK, idempotency, impersonation)
