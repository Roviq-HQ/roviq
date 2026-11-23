# Important rules

### The app is currently not in production, so you are allowed to reset the db, alter any migration, alter any code/db table. Some of the code is written by older models, so if you are fable 5.2 or above, you are allowed to completely change anything to reduce bugs, tighten security, less technical debt, faster launching of the product, and a lot of things. Use that freedom inside the issue you are working on: a rewrite or redesign that no issue asks for is a proposal to the user first.

## Dev environment

Tilt runs everything: apps, databases, migrations, seeds. Never run `pnpm db:*`, `nx serve` or `nx dev` yourself, and always type `pnpm tilt …`, never bare `tilt` (the wrapper targets this checkout's own Tilt). Commands and resources: `docs/infrastructure.md` → "Tilt commands"; test commands: `docs/testing.md` → "Commands".

- **Start of a session**: `pnpm tilt get uiresources`. No answer means Tilt is down: start it (`pnpm tilt up`) before anything else.
- **After a code change** the apps restart themselves; `pnpm tilt trigger <resource>` is for `db-push`, `db-seed`, `db-clean` and the e2e resources. Read results with `pnpm tilt logs <resource>`.
- **The dev gateway can miss a restart.** When the running app contradicts the code or a passing test, compare the process start time with your last edit and run `pnpm tilt trigger api-gateway` (steps: `docs/infrastructure.md` → "When the dev app looks wrong").
- **Type errors are not in the app log.** The backend apps run from source unchecked: use `pnpm nx run <project>:typecheck`.
- **GraphQL types** regenerate through the `codegen` resource, which needs the gateway up. After a resolver or query change, confirm in `pnpm tilt logs codegen`, or run `pnpm codegen` once the gateway answers.
- **`.env` is read when Tilt starts.** A changed variable reaches the apps only after Tilt restarts.
- **E2E**: `pnpm test:e2e:api` and `pnpm ci:check` rebuild and re-seed the e2e stack themselves. Before any other e2e run, and after a backend change, run `pnpm e2e:up`.

## Parallel dev instances

Several agents work at the same time, each in its own git worktree with its own ports, containers and databases. Full details: `docs/infrastructure.md` → "Parallel dev instances".

- **Know which instance you are in before running or testing anything.** `pnpm instance:ports` prints the slot and every port. Slot 0 is the main checkout; `ROVIQ_INSTANCE=<n>` in `.env` means slot n.
- **Every port and URL written in this file, in `docs/` and in the skills is the slot 0 value.** In slot n add `n × 20`: slot 1 has web on `localhost:4220` (`admin.localhost:4220`, `reseller.localhost:4220`), API on 3025, e2e API on 3024, e2e web on 4221. Never type a slot 0 port from memory.
- **Never touch another instance.** Do not call another slot's ports, do not run `docker` commands against its Compose projects (`docker` / `roviq-e2e` belong to slot 0, `roviq-<n>` / `roviq-e2e-<n>` to slot n), and do not point a database client at its Postgres. Container names carry the project prefix, e.g. `roviq-1-postgres-1`.
- **Starting parallel work**: when the user asks for work to run beside another agent's, or the current checkout is busy with another branch, create an instance with `pnpm instance:new <slot> <branch>` from the main checkout and work there. Do not start a second Tilt in a checkout that has no instance of its own.
- **Do not wait for a busy checkout.** When the next task is ready and your worktree still has uncommitted work or a test run in progress, start the next task in another instance at once. There are four extra slots (1 to `MAX_SLOT` in `scripts/lib/instance.ts`). If none is unused, find a stale one and reuse it; do not create a plain `git worktree` outside the slots. A slot is stale when all of these hold: its branch's PR is merged (or `git rev-list --count origin/main..HEAD` is 0), `git status --short` is empty, and its Tilt does not answer. Reuse it with `git switch -c <branch> origin/main` in that checkout, `pnpm install`, `pnpm tilt up`. A slot with unmerged commits or uncommitted files is not stale, however old: leave it, and if every slot is in real use, tell the user.
- **Browser testing**: cookies on `localhost` are shared across ports. Use a separate browser profile or context per instance, or a login in one instance signs the other out.
- New code must not hardcode a dev or e2e port. Read the instance variable with the slot 0 value as the default (`process.env.E2E_API_PORT ?? '3004'`, `${DEV_POSTGRES_PORT:-5434}`); the table is in `scripts/lib/instance.ts`.

## What to work on

Before starting an issue, read the Linear document **"Roadmap: order of work"** (team Roviq). It names the current stage and the order of issues inside it.

- Work on the current stage. Asked for something from a later stage? Say so once, then do it.
- Do what the issue asks, plus what keeps the checks green. A small pre-existing bug is still fixed at once in its own commit; a new feature, a redesign or a rewrite is a proposal to the user. This product has slipped by adding good ideas to the task in hand.
- Every new or changed operation that takes an id needs a test in which another institute's or reseller's id is refused.
- Linear issues and this repository are public. Hosting, provider, cost and backup details go in a Linear document, never in an issue, a comment, a commit or `docs/`.
- A review of the whole product from one role (CTO, product, security, a parent) is a Linear document; start from **"Role reviews: index and template"**.

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
- [MDLSP] **Fable plans, reviews and owns security and migrations; Opus builds and tests; Sonnet does the volume work.** Applies when the session runs on a Fable model. **Fable**: planning, task breakdown, review, and by its own hand everything security-sensitive (auth, permissions, RLS, data exposure, security findings) and every database migration. **Opus 5.5 or newer** (`Agent`, `model: "opus"`): feature code, new tests, debugging, and the browser pass. **Sonnet** (`model: "sonnet"`): high-volume, simple-shape work with a clear "done": searches and inventories, reading logs and test output, mechanical edits after an API change, translation and message files, docs and write-ups from supplied facts (Linear comments, decision records and status updates included), test fixes that follow a signature change, lint and obvious type fixes. Every brief is self-contained (files, rules, how to verify, what to report). A browser brief names the instance URLs, the logins and every workflow the change can reach, and tells the subagent to drive each one to its end (normal flow, boundary and forbidden cases, refresh, account switch), to check console, network and stored data, and to report every other anomaly it notices, related or not. Fable reviews every result against the diff, the test output and the browser evidence before accepting it, sends the subagent back for any workflow it skipped, and never reports a claim it has not checked. Subagents do not commit, push, or run Tilt/database commands; the main session does **Resume before you spawn**: give a follow-up or small task to an agent that already worked in that checkout (`SendMessage`), because a fresh agent first re-reads the rules, skills and code; spawn a new one only when no agent has the context or the work runs in parallel. Brief only what was asked plus what keeps the checks green; propose extras to the user instead of adding them.

## Architecture

- **api-gateway** — NestJS GraphQL API (Apollo, code-first). Three-scope auth (platform/reseller/institute). Port 3005 (slot 0).
- **web** — Next.js 16 (App Router) unified web app. Three scope directories: `admin/`, `reseller/`, `institute/`. Hostname middleware routes subdomains. Port 4200 (slot 0).
- **Shared libs** (`@roviq/*`): `database`, `common-types`, `nats-jetstream`, `resilience`, `graphql`, `auth`, `auth-backend`, `casl`, `i18n`, `ui`
- **Infra**: PostgreSQL 18 + RLS (four-role: `roviq_pooler`→`roviq_app`/`roviq_reseller`/`roviq_admin`), Redis 7, NATS 2.10 + JetStream, S3-compatible object storage (RustFS in dev), Temporal — all in Docker via Tilt

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
- **One full gate per branch: the one `git push` runs.** While fixing, run only the spec files you touched. Do not run `pnpm ci:check` by hand after each round of fixes; it takes 8 minutes and the push repeats it. If you do run it in the background, close its input (`< /dev/null`) or it waits forever.
- **Commit and open the PR as soon as the issue's own flows pass.** Do not hold a tested branch open to add extras; extras found later are a second, small PR.
- **Retire a subagent once its reported usage passes about 400,000 tokens.** Every step of a resumed agent re-reads its whole history, so an old agent costs more per step than a fresh one costs to start. Ask it for a short handover (state of the tree, decisions, what is left), then give the next task to a new agent with that handover as its brief. "Resume before you spawn" applies below that size only. Run one builder at a time; research or a browser pass may run beside it.
- **Before sending an agent to an instance, prove it is usable**: gateway answers 200, the dev database has this branch's tables, the e2e stack has every service. A blocked agent costs its whole start-up.
- **In a parallel instance**, check `pnpm tilt get uiresources` at the start of a session: its Tilt and containers may have stopped with the previous session.

### Deviations & Deferred Work

- **Deviations** — spec drifts, trade-offs, user-rejected approaches: add as a comment on the current Linear issue, update linear docs/projects
- **Deferred work** — if the user asks to defer something, create a new Linear issue with skill with proper labels and set the current issue as parent. Nothing is silently deferred

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
- `@EventPattern` classes go in module `controllers`, and the app's `main.ts` calls `connectJetStreamMicroservice()` (`pnpm check:event-handlers`)
- `defineStateMachine` for status transitions · `calendarDaysBetween` / `isValidDateRange` / `rangesOverlap` from `@roviq/common-types/date-range`
- UI: `<Button>` and `<FieldInfoPopover>` from `@roviq/ui`, `useTranslations()`, `useFormatDate()`, scope-prefixed nav hrefs
- Testids: `testIds` registry from `@roviq/ui/testing/testid-registry` + `page.getByTestId()`; literal `data-testid` fails `pnpm check:testids`
- Seed credentials/names only from `e2e/shared/seed-fixtures.ts`
- Errors: `BusinessException(ErrorCode.X, …)` on the backend; frontend branches on `extensions.code` (`isAppError`, `extractGraphQLErrorCode`) and shows translated copy — never `err.message`
- Files: reference `files.id` and return `FileRef`; upload with `<FileUpload>`, attach with `FileService.verifyUploads` + `markFilesReady(tx, …)`; never a URL column, a typed-in URL or a raw S3 call
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
- When making infrastructure, convention, or architectural changes, create/update a Linear issue to document the change. Also create/update documents/prd/projects on linear.
- When you need the product requirements document (PRD), read it in Linear.
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
