# Testing

## Setup

Tests use Vitest 4 integrated with NX via `@nx/vitest` plugin. Each project with a `vitest.config.ts` automatically gets a `test` target. E2E projects under `e2e/` get an `e2e` target.

## Commands

```bash
# Unit tests (no DB, mocked)
pnpm test:unit                    # vitest: unit-node + unit-dom projects
pnpm test                         # nx run-many -t test (unit + integration, NX-cached)
nx run api-gateway:test           # single project
nx affected -t test               # only changed projects

# Integration tests (real PostgreSQL, roviq_test DB on port 5434)
pnpm test:int                     # vitest --project integration
                                  # starts dev Postgres/Redis/NATS itself if they are stopped (scripts/int-infra.ts)

# E2E tests (requires Docker stack: pnpm e2e:up)
pnpm test:e2e:api                 # Vitest GraphQL tests against api-gateway:3004
pnpm test:e2e:ui                  # Playwright UI tests across 3 portals

# Full pipeline
pnpm test:all                     # unit + int + e2e:api + e2e:ui

# Coverage
pnpm test:coverage                # unit-node + unit-dom with v8 coverage

# Teardown
pnpm e2e:down                     # stop Docker E2E containers (keeps volumes and .e2e/ build cache)
pnpm e2e:nuke                     # also wipe volumes and .e2e/

# Watch mode (single project)
nx run api-gateway:test --watch
```

## JetStream transport integration tests

Run `NATS_TEST_URL=nats://localhost:<test-port> pnpm nx run nats-jetstream:test:nats` against an isolated NATS server with JetStream enabled. The target always executes against the broker (no Nx result caching), needs no database, and runs the transport and stream-configuration suites. The same files are included in `pnpm test:int` in CI.

The transport suite exercises the actual NestJS JetStream publisher and pull workers: payload/header/context propagation, ACK removal, NAK redelivery, terminal DLQ routing, malformed JSON recovery, durable reconnects, bounded pulls/concurrency, shared workers, ordered/concurrent publishing, and broker payload limits. The stream suite checks every current `STREAMS` entry, including NOTIFICATION's interest retention and DLQ's limits retention, plus idempotency without losing stored messages.

Tests create UUID-prefixed streams/consumers and remove them after use. DLQ entries are purged only for each test's unique subject; an initially absent DLQ stream is removed once empty. The suite rejects an existing application DLQ consumer before publishing failures, so do not point it at an active app's broker. Start the `nats-test` infrastructure through Tilt and set `NATS_TEST_URL` to that broker. The default is `nats://localhost:4224`; application integration tests retain `NATS_URL` on port 4222. Integration setup prepares both brokers, and CI starts them separately so application DLQ consumers cannot receive transport-test failures.

Current header behavior differs from the original ROV-18 wrappers: missing tenant headers yield `undefined` on `JetStreamContext` and `null` in request context; missing correlation headers stay empty on `JetStreamContext`, while request context gets a generated UUID. Explicit headers override ambient context. Oversized messages are rejected according to the broker's advertised `max_payload`; a large message within that limit must round-trip.

## CI and pre-push

The local gate health-checks long-running infrastructure first, then waits for the Novu bootstrap and seed containers to exit successfully. It starts the API and notification service in that order without restarting their completed setup dependencies. Standalone setup containers use their exit status rather than `compose up --wait`, which expects a running or healthy service when no dependent is selected.

- `pnpm test:e2e:api` routes through the cacheable Nx target `api-gateway-e2e:test-e2e`; `pnpm test:e2e:ui` through `web-e2e-suite:e2e` (single invocation, single cache hash) covering web-admin-e2e, web-institute-e2e, web-reseller-e2e plus cross-portal.
- The UI target's cache inputs (`e2eFrontend`) include `e2eStack`: gateway, notification-service, `libs`, `ee`, migrations, seed scripts and the e2e Docker files. A backend-only change therefore re-runs the Playwright suite on pre-push instead of replaying a cached pass.
- `pnpm ci:check` — unified gate. Runs lint/typecheck/unit/integration/e2e in parallel; locally uses `nx affected` against `origin/main`, on CI runs the full suite. Invoked by `.husky/pre-push`. Bypass: `SKIP_PREPUSH=1 git push` or `git push --no-verify`.
- CI runs **five blocking jobs** on push/PR: `lint`, `typecheck`, `test` (unit — no DB), `build`, `e2e-api` (Docker stack + Vitest E2E). A sixth, `e2e-ui` (Docker stack + Playwright), is **paused on push/PR since 2026-11-16 (ROV-277)** and runs only on a manual trigger: `gh workflow run CI --ref <branch>`. Until it is re-enabled (remove the `if:` on the job), the Playwright suite is enforced only by the local pre-push gate; `git push --no-verify` or `SKIP_PREPUSH=1` skips it entirely. Integration tests (`pnpm test:int`) run as part of the `test` job against `roviq_test` via `DATABASE_URL_TEST`. Just before the full suite, the `test` job runs the named **User & Groups Security Invariants** step (`apps/api-gateway/src/__tests__/user-groups-security-invariants.integration.spec.ts`, ROV-205): real role abilities → `caslToSqlWhere()` → SQL under RLS, plus the 2,000-student group-rule performance budget. E2E jobs spin up `compose.e2e.yaml` with `--wait` and tear it down via `if: always()`.

- The `e2e-ui` job pins `ubuntu-24.04` because Playwright 1.59.1 supports Ubuntu 22.04/24.04, while `ubuntu-latest` can select unsupported Ubuntu 26.04. Recheck OS support when upgrading Playwright before changing this runner.
- Both e2e jobs start the stack with `pnpm e2e:up` (the same command as local) and restore `.e2e/nx/cache` and `.e2e/nx/workspace-data` via `actions/cache` (Nx ignores the cache folder without its index in `workspace-data`), so the api-gateway and notification-service builds are cache hits on most runs.
- After `pnpm e2e:up`, CI runs the Nx targets directly (`api-gateway-e2e:test-e2e`, `web-e2e-suite:e2e`). `pnpm test:e2e:api` / `pnpm test:e2e:ui` are for local use: they start and re-seed the stack first, which CI has already done.
- The UI job starts the stack in the background and installs Playwright browsers and runs codegen meanwhile; `Wait for E2E stack` prints the start-up log and fails the job if start-up failed.
- Playwright uses its default worker count everywhere (half the logical cores: 2 on a 4-vCPU GitHub runner). Tests must stay safe under `fullyParallel`.

## Security invariants

The auth invariants from Auth PRD v3.0 Section 21 (ROV-102). Where the database can enforce an invariant, it does, through a constraint, trigger, policy or GRANT, so a buggy or new code path cannot skip it. The application checks the same rules first to return a clear error. Where the rule lives outside PostgreSQL (an HTTP response, a code or ticket held in Redis), it is tested through the running API.

A test counts only if it attempts the forbidden action and expects a refusal. A test that writes a row and reads it back proves nothing and does not belong here.

`DB` = `libs/database/src/__tests__/auth-invariants-db.integration.spec.ts` (rules from the `rov-102-*` migrations), `RLS` = `libs/database/src/__tests__/security-invariants.integration.spec.ts`, `E2E` = `e2e/api-gateway-e2e/src/security-invariants.api-e2e.spec.ts`.

| # | Invariant | Enforced by | Proven by |
|---|---|---|---|
| 1 | `roviq_pooler` cannot query without `SET LOCAL ROLE` | GRANTs | RLS 1 |
| 2 | `roviq_app` cannot read `platform_memberships` | GRANTs | RLS 2 |
| 3 | `roviq_app` cannot read `reseller_memberships` | GRANTs | RLS 3 |
| 4 | `roviq_reseller` cannot read another reseller's institutes | RLS | RLS 4 |
| 5 | `roviq_reseller` cannot write to tenant tables | GRANTs | RLS 5 |
| 6 | `roviq_admin` sees all data | RLS | RLS 6 |
| 7 | An impersonation token cannot be refreshed | `chk_refresh_token_membership_scope`; refresh tokens only for a live membership (`refresh_tokens_guard`) | DB; E2E 7, 8 |
| 8 | An ended impersonation session stays ended | `impersonation_sessions_guard`; only `roviq_admin` writes sessions | DB; E2E 8 |
| 9 | Reseller suspension revokes every staff session | `resellers_revoke_sessions` trigger | DB; `reseller-suspension.integration.spec.ts` |
| 10 | Reseller suspension ends staff impersonations | `resellers_revoke_sessions` trigger | DB; `reseller-suspension.integration.spec.ts` |
| 11 | A password change revokes every session | `users_revoke_sessions_on_password_change` trigger | DB; `password-change.api-e2e.spec.ts` |
| 12 | A wrong portal is indistinguishable from a wrong password | application | E2E 12 |
| 13 | Cross-tenant data isolation | RLS | RLS 13 |
| 14 | A one-time impersonation code cannot be reused | Redis `GETDEL` | E2E 14 |
| 15 | Intra-institute impersonation respects the role hierarchy | application; the database refuses an impersonator with no membership in the institute | E2E 15; DB |
| 16 | Switching institute revokes the previous refresh token | application; a revoked token stays revoked (`refresh_tokens_guard`) | E2E 16; DB |
| 17 | A reseller cannot delete institutes | no reseller DELETE policy or GRANT; `institutes_delete_admin_only` refuses a soft delete | DB; E2E 17; `reseller-system-roles.spec.ts` |
| 18 | The system reseller cannot be suspended or deleted | `resellers_protect_system` trigger, which also stops the database superuser | DB; E2E 18 |
| 19 | A ws-ticket is single-use and expires | Redis `GETDEL` and 30-second TTL | E2E 19; `ws-ticket.store.spec.ts` |
| 20 | `revokeAllOtherSessions` keeps the current session | application | E2E 20 |
| 21 | `selectInstitute` needs a valid selection token | application | E2E 21 |
| 22 | A deactivated or deleted reseller team member loses their refresh tokens and reseller impersonation sessions; a reseller cannot deactivate another reseller's member | `reseller_memberships_revoke_sessions` trigger; `reseller_membership_own` policy | DB ("reseller member deactivation"); `reseller-team.integration.spec.ts` |
| 23 | A reseller access token issued before a role change or deactivation is refused | application: `ResellerAccessGuard` reads `auth:reseller-member-access:<id>` | `reseller-access.guard.spec.ts`; `reseller-team.integration.spec.ts` |
| 24 | A view-only impersonation session (reseller role below full admin, or platform support) cannot change anything | application: `ImpersonationSessionGuard` refuses mutations and non-GET HTTP on `impersonationReadOnly` | `impersonation-session.guard.spec.ts`; `impersonation.integration.spec.ts` |

Further rules the database enforces, tested in DB:

- A refresh token is issued only to an active membership of that user (for institute scope, in that institute), and a suspended or deleted reseller gets none.
- A revoked refresh token must carry a reason and cannot be un-revoked. A token cannot be re-pointed at another user or membership, or extended.
- An impersonation session can be opened only by someone with active access of that scope to the target institute (a reseller only into its own institutes). It cannot be re-pointed or extended.
- `roviq_app` reads only the sessions in its own institute and `roviq_reseller` only those in its own institutes. Neither can write any.

The E2E sections keep the numbering used when the suite was first written, which is one higher than the issue's from 16 on.

CI runs the database and session specs as the named step **Auth Security Invariants** in the `test` job, before the full integration suite. The E2E spec runs in the `e2e-api` job.

## Docker Compose Files

Compose files live under `docker/` and are selected explicitly per use case — this project does not use named `--profile` flags.

| File | What it starts | When to use |
|---|---|---|
| `compose.infra.yaml` | Postgres, Redis, NATS (infra only) | Local dev infrastructure — apps run via Tilt |
| `compose.dev.yaml` | Full dev stack (infra + apps, port 3000) | Running the stack in Docker instead of Tilt |
| `compose.e2e.yaml` | Migrated+seeded `roviq_test` stack on port 3004 (host 5435 for PG, 9004 for object storage) | `pnpm test:e2e:api`, `pnpm test:e2e:ui`, CI `e2e-api`/`e2e-ui` jobs |
| `compose.app.yaml` | Application-only bundle (no infra) | Compose-in-compose reuse |
| `compose.novu.yaml` | Novu notification stack | Notification smoke tests |

Convenience scripts:

```bash
pnpm infra:up       # docker compose -f docker/compose.infra.yaml up -d
pnpm e2e:up         # scripts/e2e-compose.sh up -d --build --wait (re-seeds; recreates the backend if its source changed), then novu-bridge-sync
pnpm e2e:clean      # re-run migrate+seed on existing e2e stack
pnpm e2e:down       # stop e2e stack, keep volumes and .e2e/
pnpm e2e:nuke       # stop e2e stack, wipe volumes and .e2e/
```

Every e2e compose call goes through `scripts/e2e-compose.sh`. It sets `E2E_WORKSPACE`/`E2E_UID`/`E2E_GID` and pre-creates the bind-mount targets; calling `docker compose -f docker/compose.e2e.yaml` directly fails with "run via scripts/e2e-compose.sh".

**Database per test type:**

| Test type | Database | Port | Connection |
|---|---|---|---|
| Unit | None (mocked) | — | — |
| Integration | `roviq_test` | 5434 | `DATABASE_URL_TEST` in `.env` |
| E2E (all) | `roviq_test` (Docker) | 5435 (host) → 5432 (container) | Docker Compose |
| Dev runtime | `roviq` | 5434 | `DATABASE_URL` in `.env` |

## E2E Architecture

```
docker/compose.e2e.yaml
├── postgres (clean roviq_test DB via init-db.sh)
├── nats
├── redis
├── migrate-and-seed (db:reset --test + seed-e2e, exits)
├── api-gateway (waits for migrate-and-seed; builds api-gateway + notification-service, then `nx serve`)
├── notification-service (waits for api-gateway healthy; runs the output it built)
└── [profile: vitest] vitest-e2e
```

Backend services share one toolchain-only image (`roviq-e2e-backend`, target `e2e` in `docker/Dockerfile.backend`: Node, curl, procps, pnpm). Nothing is installed or copied at image build time:

- The host checkout, including the host's `node_modules`, is bind-mounted at its **host path** (pnpm's bin shims embed absolute paths, so mounting at `/app` breaks module resolution).
- Containers run as the invoking user, so files they write stay owned by you (or the CI runner).
- `.e2e/dist` and `.e2e/nx` (git-ignored) are mounted over `dist/` and `.nx/` inside the containers. The host's `dist/` and `.nx/` are never touched, so Tilt's dev gateway and the e2e stack run side by side.
- Only `migrate-and-seed` declares the image `build`; the other services reference the tag. Several build definitions for one tag give it a new ID on every `up --build`, which recreates the containers.
- `novu-bridge-sync` is in the `setup` profile and is run by `pnpm e2e:up` after the stack is healthy. As a plain service it made `up --wait` fail intermittently with `exited (0)`.
- Requires a Linux host on the Node major in `.nvmrc`; run `pnpm install` on the host after dependency changes — there is no image rebuild.

### E2E stack decisions (ROV-277, 2026-11-16)

Each row is a decision with its reason. Evidence and timings: `docs/changelogs/testing-troubleshooting.md`, entries dated 2026-11-16.

| Decision | Why | Do not |
|---|---|---|
| One toolchain-only image (`e2e` target) for all backend services; host checkout and `node_modules` bind-mounted | The old three ~2 GB images cost 4-8 minutes per CI job to install, build and export what the runner already had | Bake source or `node_modules` back into the e2e image |
| Mount the checkout at its host path | pnpm's `.bin` shims hard-code the host path in `NODE_PATH`; at `/app` the gateway failed with `Cannot find module 'axios'` | Mount at `/app` |
| Container `dist/` and `.nx/` live in git-ignored `.e2e/` | Keeps the host's `dist/` and Nx state untouched so Tilt's dev gateway and the e2e stack run together; CI can cache the folder directly | Point the mount at the host's `dist/` |
| Containers run as the invoking user | Files written into the bind mount stay owned by the developer or the CI runner, so no `chmod`/`chown` steps | Hard-code a UID |
| api-gateway is the only Nx builder; notification-service runs its output | Two Nx processes writing `dist/libs` at once race | Run `nx serve` in a second container on the same `dist` |
| Only `migrate-and-seed` declares the image `build` | Several build definitions for one tag gave it a new ID on every `up --build`, recreating the containers | Add `build:` to another service using the shared tag |
| `novu-bridge-sync` is in the `setup` profile and run by `pnpm e2e:up` | `up --wait` fails intermittently with `exited (0)` on a one-shot service nothing depends on | Start a leaf one-shot service from `up --wait` |
| Every compose call goes through `scripts/e2e-compose.sh` | It sets the workspace path and UID the compose file requires and creates the mount targets | Call `docker compose -f docker/compose.e2e.yaml` directly |
| CI caches `.e2e/nx/cache` together with `.e2e/nx/workspace-data` | Nx ignores the cache folder without its index (`machine.db`) | Cache the cache folder alone |
| CI runs the Nx test targets directly after `pnpm e2e:up` | `pnpm test:e2e:*` start and re-seed the stack a second time | Use `pnpm test:e2e:*` in CI steps |
| Playwright uses its default worker count (no CI override) | One worker made the suite fully serial; tests are `fullyParallel`-safe | Reintroduce `workers: 1` to hide a flaky test |
| Preflight polls 20s, prints the gateway log, then runs `e2e:up` | A single 1s probe misfired | Shorten it back to a single probe |
| The gateway container builds once and runs that output with plain `node`. `scripts/e2e-compose.sh` puts a hash of the backend source in the backend containers' environment (`E2E_BACKEND_FINGERPRINT`), so `up` recreates them when that source changed; `ci:check` always recreates them (ROV-288) | `nx serve` in the container rebuilt only the app, never `dist/libs`, so a library change left it failing to compile; its restarts died with `EADDRINUSE` or failed unrelated Playwright tests mid-run | Put a watcher back in the e2e stack |
| **The Playwright CI job is paused on push/PR** (manual `workflow_dispatch` only) | Owner decision for a single-developer repo: the job took ~11.5 min and the suite already runs on every push via pre-push. Planned for a few months | Delete the job; re-enable by removing its `if:` |
| The UI target's cache hashes backend sources (`e2eStack`) | With the CI job paused, a backend-only change would otherwise replay a cached UI pass and never run the suite | Remove `e2eStack` from `e2eFrontend` while the CI job is paused |

Known gaps accepted with these decisions:

- `git push --no-verify` or `SKIP_PREPUSH=1` skips the Playwright suite with no CI backstop.
- Re-seeding (`e2e:clean`, `e2e-seed`) resets the database under a live gateway; a gateway reload during it crashes the gateway until preflight restarts it.
- The e2e stack needs a Linux host on the Node major in `.nvmrc`.
- The `build` and `test` CI jobs now cache the Nx index (`.nx/workspace-data/*.db*`) with `.nx/cache`. On the host that index is named after `/etc/machine-id`, so it only helps if GitHub runners share a machine id; the `Report Nx cache index` step in each job says whether it did. Nx's supported way to share a cache across machines is a remote cache (Nx Cloud or `@nx/shared-fs-cache`), not adopted here.

### Deterministic Seed Data

`scripts/seed.ts` uses deterministic UUIDs (`SEED_IDS`) so E2E tests can reference entities directly without querying:

| Entity | ID | Credentials |
|---|---|---|
| Saraswati Vidya Mandir (NEP + CBSE) | `00000000-0000-4000-a000-000000000101` | — |
| Rajasthan Public School (Traditional + BSEH) | `00000000-0000-4000-a000-000000000102` | — |
| Admin user | `00000000-0000-4000-a000-000000000201` | admin / admin123 |
| Teacher user | `00000000-0000-4000-a000-000000000202` | teacher1 / teacher123 |
| Student user | `00000000-0000-4000-a000-000000000203` | student1 / student123 |
| Free plan | `00000000-0000-4000-a000-000000000001` | — |
| Pro plan | `00000000-0000-4000-a000-000000000002` | — |

### What Goes Where

| Test type | Tool | Location | Tests what |
|---|---|---|---|
| GraphQL queries/mutations | Vitest + fetch | `e2e/api-gateway-e2e/src/` | Auth flows, audit, RLS isolation |
| HTTP flow (billing lifecycle) | Vitest | `e2e/api-gateway-e2e/src/` | Billing CRUD, subscription lifecycle |
| RLS isolation | Vitest | `e2e/api-gateway-e2e/src/` | Cross-tenant data leakage prevention |
| Audit trail | Vitest | `e2e/api-gateway-e2e/src/` | Mutation → NATS → audit log entry |
| Novu notifications | Vitest | `e2e/api-gateway-e2e/src/` | Novu API smoke, login notification flow |
| Paid billing | Vitest | `e2e/api-gateway-e2e/src/` | Paid plan assignment, gateway interaction |
| Browser UI | Playwright | `e2e/<app>-e2e/src/` | Login flows, institute picker |

## Test Structure

```
tests/                                        # Project-wide tests (doc sync, cross-cutting validations)
libs/shared/common-types/src/__tests__/       # CASL types, role ability definitions
libs/frontend/auth/src/__tests__/             # JWT decode, token expiry logic
libs/backend/casl/src/__tests__/              # AbilityFactory (caching, conditions, rule merging)
apps/api-gateway/src/auth/__tests__/          # AuthService (login, register, refresh, logout)
e2e/api-gateway-e2e/
├── src/
│   ├── helpers/                              # Shared E2E helpers (gql-client, auth, ws-client)
│   ├── auth.e2e.test.ts                      # Auth flow (login, selectInstitute, refresh, logout)
│   ├── audit.e2e.test.ts                     # Audit pipeline + RLS + immutability
│   └── rls-isolation.e2e.test.ts             # Cross-tenant data isolation
├── global-setup.ts                           # API readiness check
└── vitest.config.ts
e2e/playwright.config.ts                      # Unified Playwright config (all 3 portals + cross-portal)
e2e/web-admin-e2e/src/                        # Admin portal specs + auth setup
e2e/web-institute-e2e/src/                    # Institute portal specs + auth setup
e2e/web-reseller-e2e/src/                     # Reseller portal specs + auth setup
e2e/cross-portal/src/                         # Cross-portal tests (multi-context, all auth states)
e2e/shared/                                   # Shared POM (LoginPage), SEED, E2E_USERS, preflight, console-guardian
```

## Unit Tests

Unit tests mock external dependencies (repositories, Redis, JWT). No running infrastructure needed.

Key coverage:

- **AuthService**: password hashing, token generation, refresh rotation, reuse detection, logout
- **AbilityFactory**: Redis caching, DB fallback, condition placeholder resolution, role+user rule merging
- **JWT decode**: payload extraction, expiry with configurable buffer
- **Tenant extension**: UUID validation, AsyncLocalStorage context isolation
- **Circuit breaker**: creation, registry, failure thresholds, fallbacks

## E2E Tests

### Docker-based (recommended for CI and clean runs)

Uses `docker/compose.e2e.yaml` to spin up isolated infrastructure + services + test runners. No local setup required beyond Docker.

### Local (for rapid iteration)

Requires `pnpm tilt up` for infrastructure. Tilt handles migrations and seeding automatically.

### API Gateway — Vitest

Hits the GraphQL API via shared helpers (`gql-client.ts`, `auth.ts`).

#### Typed GraphQL operations

Operations live in `e2e/api-gateway-e2e/src/operations/*.graphql` (op names prefixed `E2e*` to avoid clashes with `apps/web` ops). `pnpm codegen` emits `TypedDocumentNode` constants in `src/__generated__/graphql.ts`. Specs import the `*Document` constants and pass them to `gql()` — variables and `data` shape are inferred, no manual generic.

**Two-tier schema drift coverage:**

| Tier | Job | Gate | What it catches |
|---|---|---|---|
| 1 (fast) | `lint` | `pnpm check:codegen-drift` | Stale `*.generated.ts` — a `.graphql` op file changed but the emitted `TypedDocumentNode` wasn't regenerated |
| 2 (thorough) | `e2e-api` | `pnpm codegen` → `git diff schema.graphql` | Stale `schema.graphql` — a resolver `@Field`/`@Query` changed but `pnpm codegen` wasn't rerun, so the schema itself is wrong |

Tier 2 runs the live api-gateway (already up in `e2e-api` at port 3004), introspects it, regenerates `schema.graphql`, and asserts `git diff` is clean. A resolver change shipped without `pnpm codegen` → tier 1 passes silently (generated files still match stale schema) but tier 2 fails with: *"schema.graphql is stale — run `pnpm codegen` locally and commit the update"*.

Coverage:

- Login: multi-institute (platformToken + memberships), single-institute (direct accessToken), wrong password, non-existent user
- selectInstitute: manage-all abilities for institute_admin, limited for teacher, condition placeholders resolved for student, rejected without token, rejected for wrong tenant
- `me` query: valid token, missing token, invalid token
- Refresh: token rotation, reused token rejection (rotation-reason cascade only — see `docs/auth.md` "Token Refresh")
- Logout: success, refresh token invalidation after logout
- Audit: full pipeline (mutation → NATS → consumer → DB), GraphQL query API, pagination, RLS isolation, immutability, @NoAudit opt-out
- RLS isolation: cross-tenant notification config isolation, unauthenticated rejection
- Notifications: the `notifications.api-e2e.spec.ts` suite auto-skips at test collection when Novu is unreachable. `probeNovuReachableSync` (in `e2e/api-gateway-e2e/src/helpers/novu.ts`) runs a synchronous TCP probe against `NOVU_API_URL` with a ~3s timeout at module load; on failure the suite is skipped with a specific reason in the Vitest output rather than letting each test time out at 30s. To force-skip locally during unrelated e2e runs, point `NOVU_API_URL` at any closed port (e.g. `NOVU_API_URL=http://localhost:59999`).

### Password policy

`NEW_PASSWORD_MIN_LENGTH` (in `libs/shared/common-types/src/lib/policy/password-policy.ts`) is the single source for the minimum-length policy enforced by `changePassword` on the server, the `@roviq/common-types` Zod schema on the client, and the e2e fixtures. Update that constant — not duplicates — when the policy changes.

### Playwright UI Tests (all portals)

A single `e2e/playwright.config.ts` drives all 3 portals plus cross-portal tests. One `globalSetup` runs `pnpm e2e:up` (idempotent), one `webServer` starts Next.js on port 4201 (separate from dev port 4200). Subdomain routing: `admin.localhost:4201` (platform), `reseller.localhost:4201` (reseller), `localhost:4201` (institute).

**Project groups** (Playwright `--project` filter):

| Group | Portal | Auth | What it tests |
|---|---|---|---|
| `admin-setup` | admin | — | Produces `admin.json` storageState |
| `institute-setup` | institute | — | Produces `institute.json` storageState |
| `reseller-setup` | reseller | — | Produces `reseller.json` storageState |
| `admin-login` | admin | none | Login form, validation, redirect |
| `institute-login` | institute | none | Login form, institute picker |
| `admin` | admin | admin | Dashboard, institutes, audit logs, navigation |
| `institute` | institute | institute | Students, staff, guardians, academics, groups, settings |
| `reseller` | reseller | reseller | Billing, plans, subscriptions |
| `cross-portal` | all | all 3 | Multi-portal flows (e.g., institute visible to both admin and reseller) |

**Running subsets:**

```bash
pnpm test:e2e:ui                              # all portals + cross-portal
pnpm test:e2e:ui -- --project=admin*          # admin setup + login + authenticated
pnpm test:e2e:ui -- --project=institute*      # institute only
pnpm test:e2e:ui -- --project=cross-portal    # cross-portal only
pnpm test:e2e:ui -- --project=admin -g "dashboard"  # single test by grep
```

### Cross-Portal Tests

Tests in `e2e/cross-portal/src/` verify flows that span multiple portals. They depend on all 3 auth setup projects and use `browser.newContext({ storageState })` to switch between authenticated portal sessions within a single test.

Example: admin sees an institute → reseller portal also lists it.

Pattern:
1. Create context with admin storageState → navigate admin portal → assert
2. Close admin context
3. Create context with reseller storageState → navigate reseller portal → assert
4. Close reseller context

## Quality Guardrails

Beyond correctness, the test suite enforces a few cross-cutting quality properties.

### Accessibility (axe-core)

Every Playwright test runs a WCAG 2.0/2.1 A+AA scan via `@axe-core/playwright` on its final page state. The scan is configured in `e2e/shared/console-guardian.ts` and is on by default (`checkAccessibility: true`).

- **Only `critical` impact fails the test** — missing form labels, non-keyboard-reachable controls, zero-contrast text. These are real barriers.
- **Serious / moderate / minor violations** (color contrast variance, landmark nesting, etc.) are surfaced as `a11y-non-critical` test annotations in the HTML report so they can be triaged over time without blocking CI.
- Known third-party noise is excluded: `[data-novu-inbox]`, `[data-sonner-toaster]`, and the Radix UI rules `scrollable-region-focusable`, `aria-hidden-focus`, `document-title`.
- Opt out per-test when needed: `test.use({ checkAccessibility: false })` — used by visual-regression specs where a11y is already covered elsewhere.
- The fixture also reports missing i18n keys, unexpected console errors, and GraphQL responses that contain an `errors` array.

### Visual regression (Playwright screenshots)

Per-portal `visual-regression.e2e.spec.ts` files snapshot the login page, dashboard, and a representative data table. `toHaveScreenshot()` compares against PNG baselines committed to `e2e/web-*-e2e/src/visual-regression.e2e.spec.ts-snapshots/`.

- 1% diff tolerance (`maxDiffPixelRatio: 0.01`) absorbs font-rendering and antialiasing drift.
- Update baselines after intentional UI changes: `pnpm test:e2e:ui -- --update-snapshots` (needs `pnpm e2e:up` first). Commit the regenerated PNGs in the same PR as the UI change.
- First-run behavior: Playwright auto-creates baselines when none exist. The first CI run after adding a new screenshot test passes; subsequent runs compare.

### CI guardrail scripts

Lightweight grep-based checks that catch degradation in test hygiene:

| Script | Enforces | Wired into CI |
|---|---|---|
| `scripts/ci-check-integration-mocks.sh` | `*.integration.spec.ts` files cannot mock the database (Drizzle/Database/Pool). If a file needs a DB mock, it should be renamed to `*.spec.ts` (unit). | Yes — via `pnpm test:check-integration` |
| `scripts/ci-check-skips.sh` | Every static `.skip()`/`.todo()` must include a `ROV-xxx` Linear reference. Runtime conditional skips (`test.skip(condition, 'reason')`) are allowed. | **Deferred** — script exists but not wired pending orphaned-skip cleanup (tracked in ROV-233) |

Both scripts are pure grep — fast enough to run in the `lint` job without extra install steps.

## Adding Tests

**Unit tests:** Create `__tests__/your-file.test.ts` in the relevant project. The project's `vitest.config.ts` picks it up automatically. NX caches results — only re-runs when source files change.

**Project-wide tests:** Add `*.test.ts` files in `tests/`. These run with their own `tests/vitest.config.ts` (not NX-managed). Run via `npx vitest run --config tests/vitest.config.ts`. Use this for cross-cutting validations like doc sync checks that don't belong to any specific lib.

**API e2e (Vitest):** Add `*.e2e.test.ts` files under `e2e/api-gateway-e2e/src/`. Use shared helpers from `src/helpers/`.

**Portal e2e:** Add `*.e2e.spec.ts` files under `e2e/web-<scope>-e2e/src/`. The unified `e2e/playwright.config.ts` picks them up automatically — no per-project config needed.

**Cross-portal e2e:** Add `*.e2e.spec.ts` files under `e2e/cross-portal/src/`. Use `browser.newContext({ storageState })` with the pre-built auth files to switch portals within a test.

## E2E Quick Reference

| What | Value |
|---|---|
| E2E database | `roviq_test` (NOT `roviq`) |
| E2E postgres port (host) | `5435` |
| E2E API gateway port | `3004` |
| Query from host | `psql -h localhost -p 5435 -U roviq -d roviq_test` |
| Query from Docker | `docker exec roviq-e2e-postgres-1 psql -U roviq -d roviq_test` |

These are the instance 0 values. In a parallel dev instance every port is shifted by `slot × 20` and the compose project is `roviq-e2e-<slot>`: see `docs/infrastructure.md` → "Parallel dev instances".
| Full reset | `pnpm e2e:down && pnpm e2e:up` |
| Re-seed only | `pnpm e2e:clean` |
| Code changes | Backend containers run a fixed build. After editing backend code run `pnpm e2e:up` (or `pnpm test:e2e:api`, which calls it): it recreates api-gateway and notification-service when the backend source changed |
| Seeding | Every `compose up` re-runs `migrate-and-seed` (an exited one-shot is started again), so `pnpm e2e:up` already resets and seeds `roviq_test`. Pass `--no-deps` to `run` for anything that must not re-seed |
