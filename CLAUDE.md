# Important rules

### The app is currently not in production, so you are allowed to reset the db, alter any migration, alter any code/db table.

**Always use `pnpm tilt trigger` to run apps, migrations, seeds, and resets** — never run `pnpm db:push`, `pnpm db:seed`, `pnpm db:reset`, `nx serve`, or `nx dev` directly. Tilt manages the full dev environment. Always call it as `pnpm tilt …`, never bare `tilt`: the wrapper targets this checkout's own Tilt, while bare `tilt` can hit another instance's. Examples:

- `pnpm tilt trigger db-push` — push schema
- `pnpm tilt trigger db-seed` — seed data
- `pnpm tilt trigger db-clean` — reset DB + re-seed
- `pnpm tilt trigger api-gateway` — restart API
- `pnpm tilt trigger web` — restart web app
- `pnpm tilt trigger e2e-gateway` — run API e2e tests
- `pnpm tilt trigger e2e-ui` — run Playwright UI tests across all 3 e2e projects (web-admin-e2e, web-institute-e2e, web-reseller-e2e)
- `pnpm e2e:up` — start Docker e2e infra (stays running), MUST run it before e2e testing. It re-seeds every time. The e2e backend runs a fixed build with no watcher: run it again after a backend change and it rebuilds and recreates api-gateway and notification-service (about 45 s; 16 s when the backend is unchanged). `pnpm test:e2e:api` and `pnpm ci:check` do this themselves.
- `pnpm test:e2e:api` — Vitest E2E API tests against running api-gateway. **All new E2E API tests go here.**
- `pnpm test:e2e:ui` — Playwright UI tests across the 3 portal e2e projects plus cross-portal.
- `pnpm test:all` — full test pipeline: unit + integration + e2e:api + e2e:ui
- `pnpm ci:check` — unified lint/typecheck/test/e2e gate, run by `.husky/pre-push`. CI jobs, Nx cache targets, bypass flags: `docs/testing.md` → "CI and pre-push".

Tilt auto-detects file changes for app resources (api-gateway, web) — no `pnpm tilt trigger` needed after editing code, just check logs. Use `pnpm tilt trigger` only for manual tasks (db-push, db-seed, db-clean, e2e-gateway). After triggering or a file change, wait max **15 seconds** then check `pnpm tilt logs`.

Tilt `codegen` resource runs `pnpm codegen --watch` automatically — regenerates GraphQL types when schema or document files change. After adding/modifying GraphQL resolvers or frontend queries, check `pnpm tilt logs codegen` to confirm types regenerated.

Use `pnpm tilt logs <resource>` to check output when things fail (e.g., `pnpm tilt logs db-clean`, `pnpm tilt logs api-gateway`, `pnpm tilt logs e2e-gateway`).

## Parallel dev instances

Several agents work at the same time, each in its own git worktree with its own ports, containers and databases. Full details: `docs/infrastructure.md` → "Parallel dev instances".

- **Know which instance you are in before running or testing anything.** `pnpm instance:ports` prints the slot and every port. Slot 0 is the main checkout; `ROVIQ_INSTANCE=<n>` in `.env` means slot n.
- **Every port and URL written in this file, in `docs/` and in the skills is the slot 0 value.** In slot n add `n × 20`: slot 1 has web on `localhost:4220` (`admin.localhost:4220`, `reseller.localhost:4220`), API on 3025, e2e API on 3024, e2e web on 4221. Never type a slot 0 port from memory.
- **Never touch another instance.** Do not call another slot's ports, do not run `docker` commands against its Compose projects (`docker` / `roviq-e2e` belong to slot 0, `roviq-<n>` / `roviq-e2e-<n>` to slot n), and do not point a database client at its Postgres. Container names carry the project prefix, e.g. `roviq-1-postgres-1`.
- **Starting parallel work**: when the user asks for work to run beside another agent's, or the current checkout is busy with another branch, create an instance with `pnpm instance:new <slot> <branch>` from the main checkout and work there. Do not start a second Tilt in a checkout that has no instance of its own.
- **Browser testing**: cookies on `localhost` are shared across ports. Use a separate browser profile or context per instance, or a login in one instance signs the other out.
- New code must not hardcode a dev or e2e port. Read the instance variable with the slot 0 value as the default (`process.env.E2E_API_PORT ?? '3004'`, `${DEV_POSTGRES_PORT:-5434}`); the table is in `scripts/lib/instance.ts`.

## Identity

**Roviq** — multi-tenant institute management SaaS. Users = "Roviqians", usernames = "Roviq ID".
**NEVER say "school" or "organization"** — the domain term is **"institute"** everywhere (code, comments, docs, UI, Linear issues). The infra term is **"tenant"** (`tenant_id`, RLS policies, `withTenant()`, JWT claims, NATS headers).

## Hard Rules

If any of below rule applies to you then you `MUST` read full details: `sed -n '/\[TAGID\]/,/^---$/p' docs/references/hard-rules-reference.md`

- [NWKRD] **No workarounds — proper fixes only.** Root-cause bugs, don't patch symptoms. +5 proper, -5 hack
- [NACPR] **Test fully, then commit.** A change is committed automatically once it is tested thoroughly in the browser and by automated tests. Doing both is your job: never skip the browser pass and hand back `git add` + `git commit` instead. Output the commands for copy-paste only when the browser pass is truly impossible, and name the blocker. Push/merge only when the user asks. Conventional commits, header ≤100 chars
- [LNFST] **Linear first** — read the full issue (especially "Does NOT Change" + "Verification") before coding. Keep in sync
- [SECLG] **Log every security finding** in the Linear document "Security Findings Log" (team Roviq): append an `SF-NNN` entry using its template — impact, root cause, fix layer, proving test, issue. Append only: never edit or delete an entry; a status change (fixed, merged, reopened) is a new entry naming the old one. Read it before a security review
- [RSBFC] Instead of try-catch on errors: (1) web search latest docs + (2) Context7 MCP. Do BOTH every time
- [NTESC] **No type escape hatches** — never `any`, `as unknown`, `as never`. Search codebase → context7 → web → discuss with user
- [BFCMT] **Before commit** — browser-verify every touched code path yourself, without being asked (see "Browser Verification"); write/update tests; run `pnpm lint:fix`. Backend-only changes count: drive the UI flows that reach the changed code
- [PXERR] Found pre-existing issue? Fix it right now. It's bigger? Discuss user to create a linear issue using skill. — fix and commit them separately
- [RDPKG] Read `package.json` scripts before running app commands. Run `pnpm lint:fix` frequently
- [NPENV] `process.env['FOO']` banned (Biome); `process.env.FOO` banned until `FOO` is on `ProcessEnv` (TS)
- [NFEEI] Frontend must not import from `/ee`
- [SHCMT] **Comments: short and useful, WHY-only** (hidden constraint, non-obvious workaround). Skip if a reader can infer from code + name. No long block comments or docstrings restating what the code does
- [NTLSA] **No test-loosening shortcuts.** When a strict assertion (`toHaveBeenCalledWith({...})`, `toEqual({...})`) fails because a mock fixture is missing a field, FIX THE FIXTURE. Never weaken to `expect.objectContaining`, `expect.any`, partial-match, or `// eslint-disable` to make a failing test pass. The strict shape is what the test exists to enforce
- [NSDFR] **No skipping/deferring mandatory review items.** When fixing a code review (CTO review, PR review, Linear-issue verification), every H1/H2/H3/Mandatory item MUST be applied in this session. Never defer with "needs its own spec", "out of scope", or "follow-up issue" unless the user explicitly approved deferral. Recommended/M-items may be deferred only with the user's explicit go-ahead in this conversation
- [NRTOP] **Never demote a "required" parameter to optional** to avoid touching call sites. If making a parameter required surfaces N TS errors, fix all N — that's the point. Never paper over with `?`, default values, or runtime fallbacks just to keep callers compiling
- [NDDSN] **Never disable a default-on safety net** because it surfaces failures. Default-on validation, schema gates, lint rules, and CI checks exist to catch real bugs. If turning one on breaks N tests/sites, fix the N — don't revert the gate to opt-in
- [USKLS] **Invoke the matching project skill BEFORE the first Edit/Write in its domain.** Skills hold rules that override general assumptions and document patterns not visible in the code alone. When the file you're about to touch falls under a skill (tests, database, services, frontend, e2e, etc.), call the `Skill` tool first. Even if you "remember" the rules — the skill file is authoritative; memory drifts

## Architecture

- **api-gateway** — NestJS GraphQL API (Apollo, code-first). Three-scope auth (platform/reseller/institute). Port 3005 (slot 0).
- **web** — Next.js 16 (App Router) unified web app. Three scope directories: `admin/`, `reseller/`, `institute/`. Hostname middleware routes subdomains. Port 4200 (slot 0).
- **Shared libs** (`@roviq/*`): `database`, `common-types`, `nats-jetstream`, `resilience`, `graphql`, `auth`, `auth-backend`, `casl`, `i18n`, `ui`
- **Infra**: PostgreSQL 18 + RLS (four-role: `roviq_pooler`→`roviq_app`/`roviq_reseller`/`roviq_admin`), Redis 7, NATS 2.10 + JetStream, MinIO, Temporal — all in Docker via Tilt

- **NX libs** — every NX library must have a `package.json` in its root (alongside `project.json`)

See `docs/architecture.md` for full details.

## Three-Scope Auth Model

Three scopes, each with its own login mutation, scope guard, DB wrapper, and module group:

| Scope     | Login mutation   | Guard decorator     | DB wrapper       | TTL    | Portal URL           | Local URL                 |
| --------- | ---------------- | ------------------- | ---------------- | ------ | -------------------- | ------------------------- |
| platform  | `adminLogin`     | `@PlatformScope()`  | `withAdmin()`    | 5 min  | `admin.roviq.com`    | `admin.localhost:4200`    |
| reseller  | `resellerLogin`  | `@ResellerScope()`  | `withReseller()` | 10 min | `reseller.roviq.com` | `reseller.localhost:4200` |
| institute | `instituteLogin` | `@InstituteScope()` | `withTenant()`   | 15 min | `app.roviq.com`      | `localhost:4200`          |

All tokens are `type: 'access'` with `scope` field. No more `isPlatformAdmin` or `type: 'platform'`.

- **Guards/decorators** live in `@roviq/auth-backend` (`libs/backend/auth/`)
- **Scope guards** use `createScopeGuard(scope)` factory
- **CASL** lives in `@roviq/casl` (`libs/backend/casl/`) — authorization only, not authentication
- **DB roles**: `roviq_pooler` (NOINHERIT LOGIN) → assumes `roviq_app`/`roviq_reseller`/`roviq_admin` via `SET LOCAL ROLE`
- **DATABASE_URL** uses `roviq_pooler`, **DATABASE_URL_MIGRATE** uses `roviq` (superuser)

## Code Layout

Folder trees for `apps/api-gateway` and `apps/web`: `docs/architecture.md` → "Monorepo Structure" / "Web App Structure". Web routes live under `apps/web/src/app/[locale]/{admin,reseller,institute}/`; `middleware.ts` rewrites hostname → scope.

**Common UI components** live in `apps/web/src/components/` (`@web/components/*`). Check `docs/frontend.md` → "Common components" before building one, and add one line there per new common component.

## Workflow

### Runtime Verification

Compilation passing does NOT mean it works. After any change to NX project.json, tsconfig, path aliases, Docker compose, infra configs, env vars, or new library scaffolding — **you MUST run the actual app** (`pnpm tilt trigger api-gateway` and check `pnpm tilt logs api-gateway`) and verify it starts without runtime errors. Fix iteratively until clean.

### Browser Verification — automatic, never optional

Automated tests passing does NOT mean it works for a user. Before you report any code change as done, open the running app in a browser (Playwright MCP) and exercise it. Do this on your own initiative: do not wait to be asked, do not ask permission, and do not end with an offer to "run a browser pass if you want".

- **What to cover**: every touched code path through the real UI — the normal flow, one boundary or forbidden case, then a refresh and an account or portal switch. For a backend change, find the screens that call the changed resolver or service and drive those (an auth change means logging in on each portal, a wrong-portal login, logout, impersonation start and end).
- **Check the result, not just the click**: read the screen, the browser console and the network responses, and confirm the stored effect (the row, the event, the status) through the UI or a query.
- **Where**: this instance's dev app (`pnpm instance:ports`), in a browser context of its own. If the dev app or database is broken or behind, fix it first (`pnpm tilt trigger …`, including `db-clean`); that is part of the task, not a reason to skip.
- **No UI reaches the code?** Say so, and verify the same paths against the running gateway (GraphQL requests plus a database read) instead.
- **Report**: list each flow you drove and what you saw. Anything you could not verify is named with its reason. "Not browser-tested" is acceptable only with a blocker you tried and failed to remove.
- A failed browser check is a bug: fix it, add a regression test, and verify again.

### Phase Completion — Bug-Free Gate

After completing each phase/issue, before declaring done:

1. **Run tests**: `pnpm test` — fix any failures iteratively until all pass
2. **Browser-verify**: follow "Browser Verification" above for every touched code path — fix and re-verify until clean
3. **Run lint**: `pnpm lint:fix` — fix any errors
4. **Run typecheck**: `pnpm typecheck` if touching TypeScript (runs `nx run-many -t build`; raw `tsc --noEmit` is a no-op here because root tsconfig uses composite project references with `files: []`)
5. **Write/update tests**: Every new code path must have tests before moving on
6. **Write/update docs**: Update relevant docs in the same batch
7. **Re-read the original Linear issue + comments**: Cross-check every spec item against your implementation. Confirm no deviation or missed requirement
8. **RLS audit**: When changing models, verify and report RLS status for every affected table
9. **Fix iteratively**: If anything fails, fix and re-run until clean. Do NOT move to the next phase with known failures

### Manual acceptance handoff

- Prepare minimal, clearly named synthetic fixtures during implementation; insert into approved local dev via Tilt in seconds, using additive/idempotent writes. Only if needed to review from ui.
- Reuse running apps/infra. No rebuild, full seed/reset, or separate review environment just for handoff.
- Verify fixtures and logins. In a temporary file's **Manual acceptance**, list URL, credentials/roles, records with IDs/direct links, and numbered steps with exact expected results. The user performs checks, not setup.
- Define observable acceptance criteria before coding. For UI changes, verify the normal browser flow, a boundary/forbidden case, and refresh/account switching. Add regression tests for discovered bugs.
- Report what was verified, what remains unverified, and supporting evidence; distinguish automated results from pending manual acceptance.
- Keep one-time scripts, hooks and generated review files out of the feature commit. Remove them after the user finishes review; retain regression tests. Delete database fixtures only when requested.
- Preserve database approval scope; production writes require explicit approval.

### Do not waste the user's time

Each line is a mistake that cost a session 10 to 40 minutes.

- **Search Linear before coding.** `list_issues` with a keyword query for the area, newest first. An old or reopened issue may be partly replaced by a newer one; if so, ask which applies before building anything.
- **Commit each pre-existing fix the moment it is tested**, before going back to the feature. Splitting mixed work into commits afterwards is slow and error-prone.
- **Read the real result of `git push`.** Redirect its output to a file and look for `[ci:check] FAILED`. Never append `; echo exit=$?` or pipe it through `tail`: both report success for a failed push.
- **Typecheck one project**: `pnpm nx run <project>:typecheck`. A hand-run `tsc` over the workspace prints hundreds of unrelated lines.
- **Browser pass**: run a whole flow (log in, navigate, act, wait for the final text, return what you need) in one `browser_run_code` call (`browser_run_code_unsafe` in newer Playwright MCP versions) instead of one click per call. Wait for the expected text before a screenshot. If the browser is unavailable, find out why first; do not write a headless script and then repeat the pass.
- **In a parallel instance**, check `pnpm tilt get uiresources` at the start of a session: its Tilt and containers may have stopped with the previous session.

### Deviations & Deferred Work

- **Deviations** — spec drifts, trade-offs, user-rejected approaches: add as a comment on the current Linear issue
- **Deferred work** — if the user asks to defer something, create a new Linear issue with proper labels and set the current issue as parent. Nothing is silently deferred

## i18n Fields

1. **DB stores full JSONB, API returns full JSONB, frontend resolves locale** — `i18nText('name')` stores `{ "en": "Science", "hi": "विज्ञान" }`. GraphQL returns the whole object (NOT a resolved string). Frontend uses `useI18nField()` hook to pick the right locale with fallback chain: current → `en` → first available. NEVER resolve locale in resolvers or services.
2. **Only human-readable, tenant-authored text gets `i18nText()`** — Institute names, section names, role names, plan names. NEVER for: emails, usernames, phone numbers, UDISE codes, UUIDs, enum values, or any language-independent field.
3. **Zod validates `en` key exists** — Use `i18nTextSchema` from `@roviq/i18n`. English is required, other locales optional. Forms use `<I18nInput>` component showing one field per locale from the tenant's `supportedLocales` config.

## Quick Mistake Reference

Full rationale + enforcing CI gate for each line: `docs/references/mistake-reference.md`. Read it before touching the area a line names.

- `selectInstitute(membershipId)`, not `tenantId` · abilities live on `Membership`, not `User`
- `withTenant/withReseller/withAdmin(db, ctx, fn)` with the branded ctx — no `$transaction`, no `tenantTransaction()`
- `assertTenantContext()` / `assertResellerContext()` / `assertPlatformContext()` / `assertInstituteWithReseller()` instead of inline `ForbiddenException`
- A scope guard is not tenant isolation: institute/reseller code never passes a caller-supplied id to `withAdmin` code without an ownership check · platform operations live in `admin/` resolvers (`pnpm check:admin-context-reach`, `docs/auth.md`)
- `mk*Ctx()` only in workflow activities, seeders, event-consumer repos, integration fixtures (`pnpm check:synthetic-context-usage`)
- `ability.can()`, never role checks · scope decorators at class level, not `APP_GUARD` · `GqlAuthGuard` from `@roviq/auth-backend`
- Every `@CheckAbility` pair must be reachable by a role, every grant used (`ability-coverage.spec.ts`)
- Reads from `<table>Live` views, writes to the base table · new soft-deletable table needs a `*Live` view, every `pgTable` needs RLS · ``.default(sql`uuidv7()`)``
- `eventBus.emit(EVENT_PATTERNS.…)` via `EventBusService`, never `natsClient.emit` · every event prefix needs a stream
- `defineStateMachine` for status transitions · `calendarDaysBetween` / `isValidDateRange` / `rangesOverlap` from `@roviq/common-types/date-range`
- UI: `<Button>` and `<FieldInfoPopover>` from `@roviq/ui`, `useTranslations()`, `useFormatDate()`, scope-prefixed nav hrefs
- Testids: `testIds` registry from `@roviq/ui/testing/testid-registry` + `page.getByTestId()`; literal `data-testid` fails `pnpm check:testids`
- Seed credentials/names only from `e2e/shared/seed-fixtures.ts`
- Errors: `BusinessException(ErrorCode.X, …)` on the backend; frontend branches on `extensions.code` (`isAppError`, `extractGraphQLErrorCode`) and shows translated copy — never `err.message`
- `REDIS_KEYS` constants · new `@roviq/*` lib → add vitest alias in `apps/api-gateway/vitest.config.ts` · impersonation tokens never refresh
- Save test/build output to a temp file and grep it — don't re-run · e2e DB is `roviq_test` · verify docs/assertions against source, not memory
- Security rules live in PostgreSQL where possible (GRANT, RLS, CHECK, trigger), not only in services; test by attempting the forbidden write as the role
- `pnpm tilt …`, never bare `tilt` · no hardcoded dev/e2e ports in code or tests — instance variables with slot 0 defaults

## Skills (when needed, not always loaded)

Domain-specific rules live in `.claude/skills/` and load only when relevant:

- `/frontend-ux` — UX patterns, accessibility, i18n, responsive, Indian user context
- `/testing-unit` — Vitest unit tests, mocking, factories, shared conventions
- `/testing-integration` — NestJS integration tests with real PostgreSQL + RLS
- `/testing-e2e` — E2E API tests (Vitest only), subscriptions, webhooks
- `/testing-frontend` — Component tests (RTL) + Playwright UI tests across 3 portals
- `/drizzle-database` — Drizzle v1 beta, schema patterns, RLS, migrations
- `/backend-service` — Service layer rules, scope→DB mapping, status mutations, event naming, ownership boundaries

## Key Docs

- `docs/architecture.md` — system architecture
- `docs/auth.md` — authentication (three-scope model, JWT, refresh, impersonation)
- `docs/frontend.md` — frontend patterns
- `docs/infrastructure.md` — infra setup
- `docs/deployment.md` — what production needs: build-time web variables, migration order, database-enforced rules, Redis on the request path. Add to it when a change needs something from production
- `docs/getting-started.md` — onboarding
- `docs/testing.md` — test strategy, CI jobs, compose files
- `docs/references/mistake-reference.md` — full Quick Mistake Reference with CI gates
- `docs/dependency-updates.md` — supply-chain-safe dependency updates with 24h/7d release-age gates; minors auto-batch via `pnpm deps:update`, majors migrate one-at-a-time through Claude Code via `pnpm deps:upgrade`
- `docs/plans/` — design docs and implementation plans
- `docs/changelogs/testing-troubleshooting.md` — **append-only** log of testing-infra issues (slow pre-push, Docker rebuilds, flaky suites, Nx cache misses) and their fixes. After fixing ANY testing-related issue, append a new entry — never edit or delete existing entries. If a fix resolves a prior `diagnosed` entry, append a new `fixed` entry that references the diagnosis date.

## Docker Compose Files

Pick the compose file explicitly — no `--profile` flags. All five files: `docs/testing.md` → "Docker Compose Files". E2E stack is `docker/compose.e2e.yaml` (`roviq_test`, PG host port 5435, API port 3004 in slot 0; always start it through `pnpm e2e:up`, which picks this instance's project and ports).

## Nx

- Run tasks via `pnpm nx` (`run`, `run-many`, `affected`), not the underlying tool. Use the Nx MCP tools. Invoke the `nx-workspace` skill to explore and the `nx-generate` skill before any scaffolding.
- Never guess CLI flags — check `--help` or nx_docs (advanced config, migrations, plugin options; not basic generator syntax). Plugin best practices: `node_modules/@nx/<plugin>/PLUGIN.md` when present.
