# Infrastructure

## Dev Environment

[Tilt](https://docs.tilt.dev/) orchestrates the dev environment. Infra runs in Docker (via `docker/compose.infra.yaml`), apps run locally.

```bash
pnpm tilt up              # Start everything
pnpm tilt down            # Stop everything
pnpm tilt get uiresources # Check resource status
```

Tilt UI: http://localhost:10350

To run more than one dev environment at once, see [Parallel dev instances](#parallel-dev-instances).

## Docker Services

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 18 | 5434 | Primary database with RLS |
| Redis 7 | 6379 | CASL ability caching |
| NATS 2.10 | 4222 (client), 8222 (monitoring) | Inter-service messaging (JetStream) |
| MinIO | 9002 (API), 9003 (console) | S3-compatible object storage |
| Temporal | 7233 (gRPC) | Workflow orchestration |
| Temporal UI | 8233 | Temporal dashboard |
| OTel Collector | 4317 (gRPC), 4318 (HTTP), 13133 (health) | OpenTelemetry collector — receives traces/metrics/logs, fans out to Tempo/Loki/Prometheus |
| Tempo | 3200 | Distributed tracing backend (Grafana Tempo 2.7.2) |
| Loki | 3100 | Log aggregation backend |
| Prometheus | 9090 | Metrics scraping and storage |
| Grafana | 3001 | Observability dashboards — also embedded in admin-portal at `/observability` |

### MinIO Image

Both Compose stacks use `quay.io/minio/minio:latest`, the upstream Quay image. The
Docker Hub reference `minio/minio:latest` no longer permits pulls. See the
[upstream container documentation](https://github.com/minio/minio/blob/master/docs/docker/README.md).
Retry a failed deployment with `pnpm tilt trigger minio`, then check `pnpm tilt logs minio`.
The local API is at `http://localhost:9002`; the console is at `http://localhost:9003`.

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
- Browser cookies on `localhost` are shared across ports. Use a separate browser profile per instance.
- A new instance has an empty Novu. Run `pnpm tilt trigger novu-setup` there if you need notifications.
- Unset `NX_WORKSPACE_ROOT_PATH` in a worktree's shell if it is set, or Nx uses the main checkout.
- Remove an instance with `pnpm tilt down`, `docker compose -p roviq-<slot> down -v`, then
  `git worktree remove ../roviq-<slot>`.

## Observability

The stack is wired end-to-end via OpenTelemetry:

```
App (OTel SDK) → OTel Collector (4317) → Tempo   (traces)
                                        → Loki    (logs)
                                        → Prometheus (metrics, namespace: roviq)
                                             ↓
                                        Grafana (3001) ← embedded in admin-portal
```

- **Traces**: auto-instrumented via `@opentelemetry/auto-instrumentations-node`. Sampling: 100% in dev, 10% in production.
- **Metrics**: exported every 10s in dev (60s in production). Metric names are prefixed `roviq_`.
- **Per-tenant API usage** (ROV-184): the api-gateway counter `roviq.api.requests` (Apollo plugin `TenantApiRequestsPlugin`) adds 1 per GraphQL operation over HTTP from an institute-scope caller, labelled `tenant_id`. graphql-ws subscriptions are not counted. Prometheus series: `roviq_roviq_api_requests_total`. The platform-admin query `adminTenantAnalytics` (module `apps/api-gateway/src/admin/monitoring/tenant-analytics/`, ability `read SystemHealth`) reads it with `sum by (tenant_id)(increase(…[24h]))` for `apiCalls24h` and a 7-point 1-day-step range for `activityTrend7d`; `activeUsers24h` comes from `refresh_tokens` (distinct users with a token created or used in the last 24h). When Prometheus is unreachable the query still answers, with `metricsAvailable: false` and null API-call fields. A tenant's calls made before its series was first scraped are not counted, because `increase()` needs two samples.
- **Logs**: OTel Pino instrumentation injects `trace_id`/`span_id` into log records for correlation (log shipping to Loki requires a separate pipeline — not yet configured).
- **Grafana dashboard**: provisioned at `docker/grafana/dashboards/overview.json`, accessible at http://localhost:3001/d/roviq-overview or via the admin-portal Observability page.

### Health checks and system health (ROV-184)

- **`GET /api/health`** (terminus) checks all five dependencies and returns 503 if any is down: Postgres (`select 1` on the shared pool), Redis (`PING`), NATS (`rtt()` on the shared DLQ NATS connection), Temporal (gRPC health service on one lazy connection) and MinIO (`$S3_ENDPOINT/minio/health/live`). Each check times out after 2s. Indicators live in `apps/api-gateway/src/health/indicators/`. The e2e stack has no MinIO, so its `/api/health` is 503 by design; its own readiness probe is a GraphQL query.
- **`GET /api/health/ready`** checks only Postgres, Redis and NATS, which every request needs. Readiness probes (Tilt's api-gateway resource) use it, so a Temporal or MinIO outage degrades the features that use them without taking the gateway out of rotation.
- **System health poller**: `SystemHealthService` (`apps/api-gateway/src/admin/monitoring/system-health/`) probes the same five plus `API_GATEWAY` (event-loop delay p99 from `perf_hooks.monitorEventLoopDelay`) every 15s. A reachable service slower than its threshold in `DEGRADED_THRESHOLD_MS` is `DEGRADED` (API_GATEWAY 200ms, Postgres 500ms, Redis 100ms, NATS 200ms, Temporal and MinIO 1s). Each poll increments hourly Redis hashes `monitoring:uptime:<SERVICE>:<hourEpoch>` (`REDIS_KEYS.SYSTEM_HEALTH_UPTIME`, `{ up, total }`, TTL 25h); `uptimePercent` sums the last 24 buckets.
- **GraphQL** (platform scope, ability `read SystemHealth`): `adminSystemHealth` (services, per-stream JetStream lag = summed `num_pending` of the stream's consumers, connections, firing Prometheus alerts, pending DLQ count), `adminConnectionMetrics` (graphql-ws connections and in-flight HTTP requests on the answering instance) and the subscription `adminSystemHealthUpdated`, which sends the current snapshot on subscribe and then a new one whenever a service status, stream lag, the alert set or the DLQ count changes. The change signal is the in-process pubSub topic `MONITORING.system_health_updated`; it is never published to NATS. Counters and the subscription are per gateway instance.
- **Prometheus client**: `PrometheusClient` (`apps/api-gateway/src/admin/monitoring/prometheus.client.ts`) reads `PROMETHEUS_URL`, else `http://localhost:$DEV_PROMETHEUS_PORT`, with a 3s timeout. When Prometheus is unreachable, `alertsAvailable` is `false` and `alerts` is empty.

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

Platform tables (`users`, `institutes`, `phone_numbers`, `auth_providers`) have **no RLS**.

### Migrations

Tilt runs schema push and seeding automatically on `pnpm tilt up`. A database that was never set up (no migration baseline, no users) is bootstrapped first with `pnpm db:reset --if-empty`, because a bare schema push does not create the prereq functions, grants and custom migrations. For manual use:

```bash
pnpm run db:push          # Push Drizzle schema to DB
pnpm run db:seed          # Seed test data
pnpm run db:reset         # Nuke DB + re-push schema (or use db-clean in Tilt UI)
pnpm run db:reset --seed  # Nuke + push + seed in one step
pnpm run db:studio        # Open Drizzle Studio (visual DB browser)
```

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
| S3_ENDPOINT | MinIO/S3 endpoint |
| S3_ACCESS_KEY | MinIO/S3 access key |
| S3_SECRET_KEY | MinIO/S3 secret key |
| S3_BUCKET_PREFIX | Prefix for tenant-scoped buckets |
| TEMPORAL_ADDRESS | Temporal server (host:port) |
| STRIPE_SECRET_KEY | Stripe API key (use sk_test_... for dev) |
| STRIPE_WEBHOOK_SECRET | Validates incoming Stripe webhook signatures |
| SENTRY_DSN | Sentry error tracking (leave empty to disable) |
| ALLOWED_ORIGINS | Comma-separated allowed origins for CORS and WebAuthn |
| API_GATEWAY_PORT | API Gateway port (optional, defaults to 3005) |
| WEB_PORT | Web app port (optional, defaults to 4200) |
| ROVIQ_INSTANCE, ROVIQ_COMPOSE_PROJECT, ROVIQ_E2E_COMPOSE_PROJECT, DEV_*_PORT, E2E_*_PORT, TILT_PORT | Generated by `pnpm instance:new` / `instance:env` for slots other than 0. See "Parallel dev instances" |
| OTEL_EXPORTER_OTLP_ENDPOINT | OTel Collector gRPC endpoint (default: http://localhost:4317) |
| OTEL_SERVICE_NAME | Service name reported in traces and metrics |
| OTEL_SERVICE_VERSION | Service version reported in traces and metrics |
| LOG_LEVEL | Pino log level (default: info) |
| NEXT_PUBLIC_API_URL | Public API base URL for browser-side requests (default: http://localhost:3005) |
| NEXT_PUBLIC_GRAFANA_URL | Grafana base URL for the admin-portal Observability iframe (default: http://localhost:3001) |
