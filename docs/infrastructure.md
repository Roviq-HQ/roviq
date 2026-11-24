# Infrastructure

## Dev Environment

[Tilt](https://docs.tilt.dev/) orchestrates the dev environment. Infra runs in Docker (via `docker/compose.infra.yaml`), apps run locally.

```bash
pnpm tilt up              # Start everything
pnpm tilt down            # Stop everything
pnpm tilt get uiresources # Check resource status
```

Tilt UI: http://localhost:10350

### Tilt commands

Run apps, migrations, seeds and resets through Tilt, always as `pnpm tilt …` (the wrapper targets
this checkout's Tilt).

| Command | What it does |
|---|---|
| `pnpm tilt trigger db-push` | Push the schema |
| `pnpm tilt trigger db-seed` | Seed data |
| `pnpm tilt trigger db-clean` | Reset the database and re-seed |
| `pnpm tilt trigger api-gateway` | Restart the API |
| `pnpm tilt trigger web` | Restart the web app |
| `pnpm tilt trigger e2e-gateway` | Run the API e2e tests |
| `pnpm tilt trigger e2e-ui` | Run the Playwright UI tests for all 3 e2e projects (web-admin-e2e, web-institute-e2e, web-reseller-e2e) |
| `pnpm tilt logs <resource>` | Read a resource's output, e.g. `db-clean`, `api-gateway`, `typecheck`, `codegen` |

The app resources (api-gateway, notification-service, web) restart on file changes, so a trigger
is only for the manual resources. The test commands (`pnpm e2e:up`, `pnpm test:e2e:api`,
`pnpm ci:check` and the rest) are in `docs/testing.md` → "Commands".

### When the dev app looks wrong

Check these before debugging the code:

1. **Stale gateway.** `node --watch` sometimes misses a file change. Find the process and its start
   time, and compare with your last edit:
   `ss -ltnp | grep :<API port>` gives the pid, `ps -o lstart -p <pid>` the start time. If it is
   older than the edit, `pnpm tilt trigger api-gateway` and wait for `/api/health/ready`.
2. **Stale type-check.** The `typecheck` resource watches with built library types and can show an
   error for a symbol that exists. `pnpm nx run <project>:build` is the answer that counts.
3. **Codegen ran while the gateway was restarting.** It fails with `ECONNREFUSED`; run
   `pnpm codegen` again once the gateway answers.
4. **Changed `.env`.** Tilt reads it once at start. Stop Tilt and `pnpm tilt up` again; check a
   running process with `tr '\0' '\n' < /proc/<pid>/environ | grep NAME`.
5. **Schema behind the branch.** `pnpm tilt logs db-push`; `pnpm tilt trigger db-clean` resets and
   re-seeds this instance's own database.

### How the backend apps run in dev

`api-gateway` and `notification-service` run from their TypeScript sources, not from `dist/`
(`pnpm run dev:gateway`, `pnpm run dev:notifications`, which Tilt runs):

- `node --watch` with `@swc-node/register`: SWC transpiles each file as it loads, with decorator
  metadata, using the app's `tsconfig.app.json`; `@roviq/*` resolve to library sources through the
  `paths` in `tsconfig.base.json`. `scripts/dev-ts-resolve.ts` maps a relative `./x.js` import to
  `./x.ts`, as tsc's node16 resolution does (the `import()` of the billing module needs it).
- An edit to any file the process loaded, app or library, restarts it: the old process shuts down
  gracefully (below) and the new one answers about 5 s later. No `pnpm tilt trigger` is needed.
- Nothing reads `dist/`, so `nx build`, `pnpm codegen` or `pnpm e2e:up` beside the dev servers
  cannot break them.
- Type errors do not stop the start: the Tilt `typecheck` resource (`pnpm run typecheck:watch`)
  type-checks both apps and the library sources they import in watch mode. `pnpm typecheck`
  (Nx builds with `tsc`) stays the gate; production images, the e2e stack and CI build with `tsc`.
- Both apps stop on SIGTERM or SIGINT through `enableGracefulShutdown` (`@roviq/telemetry`):
  stop listening, `app.close()` (consumers and workers stop in `onModuleDestroy`; HTTP and the
  JetStream microservice close; NATS, Temporal client, database pools and Redis close in
  `onApplicationShutdown`), flush telemetry (at most 2 s), exit 0. After 10 s it exits 1 and logs
  the hooks still running.

To run more than one dev environment at once, see [Parallel dev instances](#parallel-dev-instances).

## Docker Services

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 18 | 5434 | Primary database with RLS |
| Redis 7 | 6379 | CASL ability caching |
| NATS 2.10 | 4222 (client), 8222 (monitoring) | Inter-service messaging (JetStream) |
| Object storage (RustFS) | 9002 (API), 9003 (console), 9004 (e2e API) | S3-compatible object storage |
| Temporal | 7233 (gRPC) | Workflow orchestration |
| Temporal UI | 8233 | Temporal dashboard |
| Mailpit | 1025 (SMTP), 8025 (web/API), 8026 (e2e API) | Catches every email the notification service sends in dev and e2e |
| OpenObserve v1.1.2 | 5080 (UI and API), 5081 (OTLP gRPC) | Logs, metrics, traces, dashboards and alerts in one container. Off by default: see [Observability](#observability) |

### Object storage

The dev, e2e and app Compose stacks run [RustFS](https://github.com/rustfs/rustfs)
(`rustfs/rustfs`, pinned, Apache 2.0) as the S3-compatible store, in the `object-storage`
service. Production uses a managed S3 service instead (`docs/deployment.md` → "Object storage").
The local API is at `http://localhost:9002`; the console is at `http://localhost:9003`. The e2e
stack publishes its own store on `E2E_STORAGE_PORT` (9004), because tests and browsers on the
host open presigned URLs.

- **Buckets**: two, split by visibility: `roviq-private` (signed URLs only) and `roviq-public`
  (readable without sign-in, branding only). `pnpm storage:init` (`scripts/storage-init.ts`)
  creates both, sets the public read policy and a CORS rule on the private bucket for the
  origins in `ALLOWED_ORIGINS`; it is safe to re-run. Tilt runs it as the
  `storage-init` resource before the gateway, and the e2e stack runs it in `migrate-and-seed`.
  The app never creates buckets.
- **Acceptance check**: `pnpm storage:check` (`scripts/storage-check.ts`) tests the store behind
  the `S3_*` variables for everything the app relies on (uploads refused when size or type
  differ, server-side copy, private bucket closed to anonymous reads, stable signed URLs). Run it
  before pointing any environment at a new provider or a new RustFS version.
- **Why not MinIO**: MinIO stopped publishing community images in 2025; `quay.io/minio/minio`
  and `minio/minio` can no longer be pulled. The application talks plain S3
  (`@aws-sdk/client-s3`) and uses nothing provider-specific.
- The image runs as uid 10001, so `/data` must be a named volume, not a host bind mount.
- Retry a failed start with `pnpm tilt trigger object-storage`, then check
  `pnpm tilt logs object-storage`.

How files are stored and served: `docs/architecture.md` → "File storage".

## Parallel dev instances

Several agents (or people) can work at the same time, each in its own git worktree with its own
containers, databases and ports. Each worktree is an **instance** with a slot number from 0 to 4.
Slot 0 is the main checkout and uses the default ports listed above.

```bash
pnpm instance:new 1 parmody1/rov-123-some-branch   # worktree at ../roviq-1, .env for slot 1, pnpm install
cd ../roviq-1
pnpm tilt up                                       # its own Tilt on port 10370
```

| Command | What it does |
|---------|--------------|
| `pnpm instance:new <slot> <branch> [path]` | Creates the worktree (new branches start from the current HEAD), copies this checkout's `.env` re-targeted at the slot, sets `TILT_PORT` for Claude Code sessions in `.claude/settings.local.json`, runs `pnpm install` |
| `pnpm instance:env <slot>` | Re-targets the current checkout's `.env` at a slot. Safe to re-run; slot 0 restores the defaults |
| `pnpm instance:ports [slot]` | Prints every port of the slot and whether it is in use |
| `pnpm tilt <args>` | Runs `tilt` against this checkout's Tilt port |

How it works:

- **Ports**: every host port is `default + slot × 20`. Slot 1 has web on 4220, API on 3025,
  PostgreSQL on 5454, Tilt UI on 10370, and the e2e stack on API 3024 / web 4221 / PostgreSQL 5455.
  The table lives in `scripts/lib/instance.ts`.
- **Containers**: each slot has its own Compose projects (`roviq-<slot>` for dev, `roviq-e2e-<slot>`
  for e2e), so containers, networks and volumes are separate. Slot 0 keeps `docker` and `roviq-e2e`.
- **Configuration**: everything is in the worktree's root `.env`. Local URLs are shifted in place and
  a generated block at the end holds `ROVIQ_INSTANCE`, the compose project names and the
  `DEV_*_PORT` / `E2E_*_PORT` variables. Compose files, the Tiltfile, scripts and e2e configs read
  these with the slot 0 value as the default.
- **Outside Tilt**: `scripts/instance-env.sh` exports the instance variables from `.env`. The
  `pnpm` scripts that need them (`test:e2e:api`, `test:e2e:ui`, `dev:web`, `tilt`) source it.

Things to know:

- In a slot other than 0, plain `tilt trigger` talks to the main Tilt on 10350. Use `pnpm tilt …`,
  or export `TILT_PORT`. Claude Code sessions opened in the worktree have it set already.
- Browser cookies on `localhost` are shared across ports. Use a separate browser profile per instance. The Playwright MCP browser already has one per Claude session (`PLAYWRIGHT_MCP_ISOLATED` in `.claude/settings.json`).
- Unset `NX_WORKSPACE_ROOT_PATH` in a worktree's shell if it is set, or Nx uses the main checkout.
- **Reusing a stale slot.** When every slot has a worktree, reuse one that is stale: its branch's
  PR is merged (or `git rev-list --count origin/main..HEAD` is 0), `git status --short` is empty,
  and its Tilt does not answer (`pnpm tilt get uiresources` fails). In that checkout:
  `git fetch origin`, `git switch -c <branch> origin/main`, `pnpm install`, `pnpm tilt up`. A slot
  with unmerged commits or uncommitted files is not stale, however old: leave it, and if every
  slot is in real use, tell the user.
- A `../roviq-<slot>` folder that is not a worktree (left behind by containers, owned by root)
  blocks `pnpm instance:new` for that slot. Use another slot and tell the user.
- Remove an instance with `pnpm tilt down`, `docker compose -p roviq-<slot> down -v`, then
  `git worktree remove ../roviq-<slot>`.

## Observability

One container, OpenObserve, stores logs, metrics and traces and holds the dashboards and alerts.
The apps export to it directly over OTLP gRPC; there is no collector and no scraper.

```
api-gateway, notification-service (OpenTelemetry SDK) ──OTLP gRPC──▶ OpenObserve (5081)
gateway and admin portal ◀──HTTP queries── OpenObserve (5080) ──alert email──▶ Mailpit (dev)
```

- **Turning it on in dev**: `pnpm tilt trigger observability` starts the `openobserve` container, runs `pnpm observability:load` and restarts the two backend dev servers. A dev server exports telemetry when this instance's OpenObserve answers at its start (`scripts/dev-telemetry-env.sh` sets `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`); otherwise no OpenTelemetry SDK loads, the metric instruments in the code are no-ops and log lines carry no trace ids. `pnpm tilt trigger observability-off` stops the container and restarts the dev servers without telemetry. Sign in to the UI at `http://localhost:<DEV_OPENOBSERVE_PORT>` with the dev credentials in `.env.example`.
- **What exports**: the api-gateway and the notification service both preload `libs/backend/telemetry/src/init-telemetry.ts` (the dev scripts with `-r`, the production images with `node --require`). The notification service reports as `OTEL_SERVICE_NAME=notification-service`.
- **Traces**: auto-instrumented via `@opentelemetry/auto-instrumentations-node`. Sampling: 100% in dev, 10% in production. Requests to `/api/health*` and to the notification service's `/webhooks/` (a secret travels in the path or the query) are not traced.
- **Metrics**: exported every 10s in dev (60s in production). A series is named after its instrument with dots turned into underscores (`http.server.duration` is `http_server_duration_bucket`, `_count`, `_sum`); the service is the label `service_name`. Query them with PromQL in OpenObserve or through its PromQL-compatible HTTP API, which `OpenObserveClient` and the admin portal's `/api/metrics` route use.
- **Logs**: the Pino instrumentation sends every log record to OpenObserve with its `trace_id` and `span_id`, so a trace shows its log lines.
- **Personal data**: `libs/backend/telemetry/src/redaction.ts` decides what leaves the process. What is exported and what is not is listed in `docs/deployment.md` → "Telemetry and shutdown".
- **JetStream metrics**: the api-gateway reads stream and consumer state from NATS on each metric export and sends it as gauges (`apps/api-gateway/src/admin/monitoring/jetstream-metrics.ts`): `jetstream_stream_total_messages`, `jetstream_stream_total_bytes`, `jetstream_stream_consumer_count` (label `stream_name`) and `jetstream_consumer_num_pending`, `jetstream_consumer_num_redelivered`, `jetstream_consumer_num_ack_pending` (labels `stream_name`, `consumer_name`).
- **A new metric source**: when one of the apps already talks to the source and the numbers are few, the app exports them as OpenTelemetry gauges, as it does for JetStream. For a tool that only offers a `/metrics` page to be scraped, do not write a bridge in the apps: add one scraper container (an OpenTelemetry Collector with its scrape receiver) that pushes to OpenObserve's remote-write endpoint. No source needs one today.
- **Dashboards and alerts** live in `docker/openobserve/`: `dashboards/*.json` (OpenObserve's own export format, so a dashboard edited in the UI can be exported and committed), `alerts/*.json` (PromQL alerts; `context_attributes` holds `severity`, `component` and `runbook`) and `alert-email-template.json`. `pnpm observability:load` (`scripts/observability-load.ts`) creates or updates them through the API, creates the email destination `roviq_ops_email` and creates the metric stream an alert reads when it has no data yet. It changes nothing when OpenObserve already matches the files. Alert emails go to `OPENOBSERVE_ALERT_EMAILS`, else to `OPENOBSERVE_USER`; in dev they land in Mailpit.
- **Per-tenant API usage** (ROV-184): the api-gateway counter `roviq.api.requests` (Apollo plugin `TenantApiRequestsPlugin`) adds 1 per GraphQL operation over HTTP from an institute-scope caller, labelled `tenant_id`. graphql-ws subscriptions are not counted. Series: `roviq_api_requests`. The platform-admin query `adminTenantAnalytics` (module `apps/api-gateway/src/admin/monitoring/tenant-analytics/`, ability `read SystemHealth`) reads it with `sum by (tenant_id)(increase(…[24h]))` for `apiCalls24h` and a 7-point 1-day-step range for `activityTrend7d`; `activeUsers24h` comes from `refresh_tokens` (distinct users with a token created or used in the last 24h). When OpenObserve is unreachable the query still answers, with `metricsAvailable: false` and null API-call fields. A tenant's calls made before its series had two samples are not counted, because `increase()` needs two.
- **Notification delivery** (ROV-329): the notification service's instruments (`apps/notification-service/src/telemetry/`) carry only the labels in `NOTIFICATION_METRIC_LABELS`, never a person, an address or an institute. `notification_delivery` counts each delivery row written (sends, skips and the provider's later reports; a held message's `DEFERRED` row is counted by `notification_deferred` instead), labels `channel`, `status`, `provider` (adapter name or `none`) and `reason` (the skip reason, or the adapter's error code without its numeric SMTP suffix, `other` for a code outside the table, else `none`). `notification_delivery_duration` is the provider call in milliseconds (`channel`, `provider`). `notification_deferred` counts deferrals (`channel`, `reason`). `notification_event_lag` is the age in seconds of the oldest unacknowledged event of each consumer of the `NOTIFICATION` stream (`stream`, `consumer`). `notification_canary_last_success` is the unix time the provider last accepted the delivery canary (`channel`); at start it is read from the latest SENT canary row, or set to the start time for a channel never sent. `notification_worker_running` is 1 while this instance's Temporal worker runs and 0 when it stopped; an instance with the worker off reports nothing. `notification_breaker_opened` counts each time a circuit breaker opens (`channel`, `provider`, `reason`: the error code that opened it). The eight `notification_*` alerts read these; each section of [Notification delivery alerts](runbooks/notification-delivery.md) says what to check. The platform-admin query `adminNotificationHealth` (`apps/api-gateway/src/admin/monitoring/notification-health/`, ability `read SystemHealth`) gives the admin Monitoring page the 24-hour sends and failures per channel (`metricsAvailable: false` and null counts when OpenObserve is unreachable) and the canary's last success per channel from `notification_deliveries`. The 24-hour counts use `increase()`, which needs two samples, so the first message of a new series is not counted.
- **File sweeper** (ROV-300): the api-gateway counter `file_sweeper_files_total` counts files the hourly sweeper handled, labelled `action` (`pending`, `rejected`, `deleted`, `retired_timed`, `retired_unused`, `purge`) and `result` (`removed`, `failed`, `skipped`). For the two `retired_*` actions, `removed` means the file was marked DELETED, not yet erased. A steady `failed` count means storage refuses deletes. See `docs/architecture.md` → "File sweeper".
- **Resource bounds**: OpenObserve grows into the memory it is given and preallocates write-ahead-log files, so both compose files cap the container (`mem_limit`, `cpus`) and set its cache, memtable and write-ahead-log sizes and a retention period (7 days in dev).

### Health checks and system health (ROV-184)

- **`GET /api/health`** (terminus) checks all five dependencies and returns 503 if any is down: Postgres (`select 1` on the shared pool), Redis (`PING`), NATS (`rtt()` on the shared DLQ NATS connection), Temporal (gRPC health service on one lazy connection) and object storage (both buckets answer a `HeadBucket`). Each check times out after 2s. Indicators live in `apps/api-gateway/src/health/indicators/`. The e2e stack's own readiness probe is a GraphQL query.
- **`GET /api/health/ready`** checks only Postgres, Redis and NATS, which every request needs. Readiness probes (Tilt's api-gateway resource) use it, so a Temporal or object storage outage degrades the features that use them without taking the gateway out of rotation.
- **System health poller**: `SystemHealthService` (`apps/api-gateway/src/admin/monitoring/system-health/`) probes the same five plus `API_GATEWAY` (event-loop delay p99 from `perf_hooks.monitorEventLoopDelay`) every 15s. A reachable service slower than its threshold in `DEGRADED_THRESHOLD_MS` is `DEGRADED` (API_GATEWAY 200ms, Postgres 500ms, Redis 100ms, NATS 200ms, Temporal and object storage 1s). Each poll increments hourly Redis hashes `monitoring:uptime:<SERVICE>:<hourEpoch>` (`REDIS_KEYS.SYSTEM_HEALTH_UPTIME`, `{ up, total }`, TTL 25h); `uptimePercent` sums the last 24 buckets.
- **GraphQL** (platform scope, ability `read SystemHealth`): `adminSystemHealth` (services, per-stream JetStream lag = summed `num_pending` of the stream's consumers, connections, firing OpenObserve alerts, pending DLQ count), `adminConnectionMetrics` (graphql-ws connections and in-flight HTTP requests on the answering instance) and the subscription `adminSystemHealthUpdated`, which sends the current snapshot on subscribe and then a new one whenever a service status, stream lag, the alert set or the DLQ count changes. The change signal is the in-process pubSub topic `MONITORING.system_health_updated`; it is never published to NATS. Counters and the subscription are per gateway instance.
- **OpenObserve client**: `OpenObserveClient` (`apps/api-gateway/src/admin/monitoring/openobserve.client.ts`) reads `OPENOBSERVE_URL` (else `http://localhost:$DEV_OPENOBSERVE_PORT`), `OPENOBSERVE_ORG`, `OPENOBSERVE_USER` and `OPENOBSERVE_PASSWORD`, with a 3s timeout. When OpenObserve is unreachable or the credentials are unset, `alertsAvailable` is `false` and `alerts` is empty. An alert is firing when it is enabled and its last outcome is `firing`; its `severity` attribute `critical` or `page` shows as CRITICAL, `warning` or `ticket` as WARNING, anything else as INFO.

## Database

### Roles
- `roviq` — bootstrap superuser, owns all tables. Used for **migrations only** (`DATABASE_URL_MIGRATE`), never at runtime.
- `roviq_pooler` — NOINHERIT login role used by the connection pool (`DATABASE_URL`). Assumes one of the three scoped roles below via `SET LOCAL ROLE` per request.
- `roviq_app` — institute-scoped runtime role (NOLOGIN, RLS enforced via `app.current_tenant_id`).
- `roviq_reseller` — reseller-scoped runtime role (NOLOGIN, RLS enforced via `app.current_reseller_id`).
- `roviq_admin` — platform admin runtime role (NOLOGIN, policy-based RLS bypass via `app.is_platform_admin`).

### RLS Policies
Tenant-scoped tables (`memberships`, `roles`, `refresh_tokens`, `profiles`, `student_guardians`) have:
- `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- Tenant isolation policy: `tenant_id = current_setting('app.current_tenant_id', true)::uuid`
- Admin bypass policy: `current_setting('app.is_platform_admin', true) = 'true'`

Platform tables that hold people (`users`, `phone_numbers`, `auth_providers` and the `user_*` tables) have RLS too: `docs/architecture.md` → "Multi-Tenancy: RLS over Schema-per-Tenant" describes who reads them.

### Migrations

Every database is built by `drizzle-kit migrate` from `libs/database/migrations/`; nothing pushes the schema. Tilt's `db-push` resource builds an empty database with `pnpm db:reset --if-empty` and then applies pending migrations, on `pnpm tilt up` and whenever a migration is added; `db-seed` follows. A database built by an older chain is not migrated: `pnpm tilt trigger db-clean` rebuilds it. `pnpm check:migrations` (in the pre-push gate and CI) builds an empty database from the chain and fails when a table lacks FORCE RLS or the schema has a change no migration carries. For manual use:

```bash
pnpm run db:migrate       # Apply pending migrations
pnpm run db:seed          # Seed test data
pnpm run db:reset         # Drop DB + rebuild it from the migrations (or use db-clean in Tilt UI)
pnpm run db:reset --seed  # Drop + rebuild + seed in one step
pnpm run db:studio        # Open Drizzle Studio (visual DB browser)
```

### Time-partitioned tables

A fixed list of `CREATE TABLE foo_YYYY_MM PARTITION OF foo` breaks the day the clock passes the
last partition, in production and in tests alike. Use
`ensure_monthly_partition(parent regclass, month_start timestamptz)` (migration
`baseline-custom`) and wire both places; skipping one brings the problem back:

- **The create migration** backfills:
  `SELECT ensure_monthly_partition('foo'::regclass, gs) FROM generate_series(date_trunc('month', NOW()), date_trunc('month', NOW()) + interval '6 months', interval '1 month') gs;`
- **At app start and daily**: an `OnModuleInit` provider on the dedicated pool. Pattern:
  `apps/api-gateway/src/audit/audit-partition-maintainer.ts`. Start-up alone misses long-lived
  processes.

A partitioned table and its indexes are created in a custom migration (`CREATE INDEX IF NOT
EXISTS`), not declared in the Drizzle schema.

The parent's RLS and GRANTs do not cover a partition queried by name.
`ensure_monthly_partition` calls `lock_down_partitions(parent)`, which strips every non-owner
privilege from each child and forces RLS with no policies. Never create a partition with a raw
`CREATE TABLE … PARTITION OF` and never name a partition in application SQL. Detach with
`detach_monthly_partition(parent, name)`. More: `docs/features/audit-logging.md`.

## NATS JetStream Streams

| Stream | Subjects | Retention |
|--------|----------|-----------|
| INSTITUTE | INSTITUTE.> | workqueue |
| ADMIN | ADMIN.> | workqueue |
| NOTIFICATION | NOTIFICATION.> | workqueue |
| DLQ | *.DLQ, *.*.DLQ | limits |

Messages carry `correlation-id` and `tenant-id` in NATS headers.
Failed messages (after max retries) are published to `{subject}.DLQ` with full error context.
Max delivery attempts are configured at the consumer level, not the stream level.

## Environment Variables

Environment variables live in `.env` (gitignored). Copy `.env.example` to `.env` on first setup.

| Variable | Purpose |
|----------|---------|
| DATABASE_URL | Application runtime (roviq_app, non-superuser, RLS enforced) |
| DATABASE_URL_ADMIN | Admin operations (roviq_admin, policy-based RLS bypass) |
| DATABASE_URL_MIGRATE | Migrations only (roviq superuser, schema changes) |
| REDIS_URL | Redis for CASL caching |
| NATS_URL | NATS JetStream server |
| JWT_SECRET | Access token signing |
| JWT_REFRESH_SECRET | Refresh token signing (must differ from JWT_SECRET) |
| JWT_EXPIRATION | Access token TTL (e.g. 15m) |
| JWT_REFRESH_EXPIRATION | Refresh token TTL (e.g. 7d) |
| S3_ENDPOINT | Object storage endpoint the server uses |
| S3_PUBLIC_ENDPOINT | Object storage endpoint the browser can reach; presigned URLs are signed for it |
| S3_REGION | Object storage region |
| S3_ACCESS_KEY | Object storage access key |
| S3_SECRET_KEY | Object storage secret key |
| S3_BUCKET_PRIVATE | Bucket for files served through signed URLs |
| S3_BUCKET_PUBLIC | Bucket for files readable without sign-in (branding) |
| S3_PUBLIC_BASE_URL | Stable base URL of the public bucket (a CDN in production) |
| TEMPORAL_ADDRESS | Temporal server (host:port) |
| FILE_SWEEPER_WORKER_ENABLED | `true` runs the hourly file sweeper worker in this gateway and creates its Temporal schedule (ROV-300). Unset or anything else: off |
| COMPLIANCE_EXPORT_WORKER_ENABLED | `true` runs the compliance export worker (task queue `compliance-export`) in this gateway (ROV-296). Unset or anything else: off, and requested exports stay PENDING |
| TC_ISSUANCE_WORKER_ENABLED | `true` runs the TC issuance worker (task queue `tc-issuance`, or `TEMPORAL_TC_TASK_QUEUE`) in this gateway (ROV-232). Unset or anything else: off, and a requested TC stays REQUESTED |
| INSTITUTE_SETUP_WORKER_ENABLED | `true` runs the institute setup worker (task queue `institute-setup`) in this gateway (ROV-232). Unset or anything else: off, and an approved institute request never finishes setup |
| AUDIT_PARTITION_WORKER_ENABLED | `true` runs the audit partition worker (task queue `audit-maintenance`) in this gateway and creates or updates its `audit-partition-cron` schedule (ROV-232). Unset or anything else: off, and audit partitions past retention are never detached |
| STRIPE_SECRET_KEY | Stripe API key (use sk_test_... for dev) |
| STRIPE_WEBHOOK_SECRET | Validates incoming Stripe webhook signatures |
| SENTRY_DSN | Sentry error tracking (leave empty to disable) |
| ALLOWED_ORIGINS | Comma-separated allowed origins for CORS and WebAuthn |
| API_GATEWAY_PORT | API Gateway port (optional, defaults to 3005) |
| WEB_PORT | Web app port (optional, defaults to 4200) |
| API_GATEWAY_INSPECT_PORT, NOTIFICATION_SERVICE_INSPECT_PORT | Node inspector ports of the Tilt-run gateway and notification service (defaults 9229, 9230). Per-instance, so parallel instances do not fight over 9229 |
| ROVIQ_INSTANCE, ROVIQ_COMPOSE_PROJECT, ROVIQ_E2E_COMPOSE_PROJECT, DEV_*_PORT, E2E_*_PORT, TILT_PORT | Generated by `pnpm instance:new` / `instance:env` for slots other than 0. See "Parallel dev instances" |
| OTEL_EXPORTER_OTLP_ENDPOINT | OTLP gRPC endpoint of OpenObserve; unset turns telemetry off. Leave unset in dev: Tilt's `observability` sets it |
| OTEL_EXPORTER_OTLP_HEADERS | gRPC metadata for the exporters: `authorization=Basic <base64 of user:password>,organization=<org>,stream-name=default` |
| OPENOBSERVE_URL, OPENOBSERVE_ORG, OPENOBSERVE_USER, OPENOBSERVE_PASSWORD | Where the gateway, the admin portal's proxy routes and `pnpm observability:load` query OpenObserve, and as whom |
| OPENOBSERVE_ALERT_EMAILS | Comma-separated recipients of alert emails, each an OpenObserve user (default: OPENOBSERVE_USER) |
| OTEL_SERVICE_NAME | Service name reported in traces and metrics |
| OTEL_SERVICE_VERSION | Service version reported in traces and metrics |
| LOG_LEVEL | Pino log level (default: info) |
| NEXT_PUBLIC_API_URL | Public API base URL for browser-side requests (default: http://localhost:3005) |
| NEXT_PUBLIC_OPENOBSERVE_URL | Browser-reachable OpenObserve URL for the admin portal's "Open in OpenObserve" links (default: http://localhost:5080) |
