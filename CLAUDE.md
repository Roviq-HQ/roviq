# Roviq

Multi-tenant institute management SaaS. Users are "Roviqians", usernames are "Roviq ID".

- **Say "institute", never "school" or "organization"**, everywhere: code, comments, docs, UI, Linear. The infra word is **"tenant"** (`tenant_id`, RLS, `withTenant()`, JWT claims, NATS headers).
- **Not in production yet.** You may reset the database, alter any migration, and rewrite code written by older models to cut bugs, tighten security or reduce debt. Use that freedom inside the issue you are working on; a rewrite or redesign that no issue asks for is a proposal to the user first.
- **Linear issues and this repository are public.** Hosting, provider, cost and backup details go in a Linear document, never in an issue, a comment, a commit or `docs/`.
- **Security findings stay out of everything public**: an issue, a comment, a commit, a branch or migration name, a pull request and `docs/`. None of them describes a vulnerability, names an `SF-NNN` entry or gives steps to exploit one. The detail lives in the Linear document "Security Findings Log" and in private plan documents; the public title says what changes, not what was wrong. A fixed finding may be described once its fix is merged, and after launch once it is deployed.
- **No personal information in anything public**: an issue, a comment, a commit, a pull request or `docs/`. That covers a person's name, e-mail, phone and location, and the developer's own computer: its hardware, memory, paths, user name and what else runs on it. Say "the development machine" and give the setting, not the measurement.

## What to work on

Before starting an issue, read the Linear document **"Roadmap: order of work"** (team Roviq): it names the current stage and the order of issues in it.

- Work on the current stage. Asked for something from a later stage? Say so once, then do it.
- Search Linear for the area first (`list_issues` with a keyword, newest first). If a newer issue partly replaces the one you were given, ask which applies before building.
- Read the whole issue and its comments, especially "Does NOT Change" and "Verification". Re-read them before you call the work done.
- Do what the issue asks, plus what keeps the checks green. A small pre-existing bug is fixed at once, in its own commit, the moment it is tested. A new feature, a redesign or a bigger pre-existing problem is a proposal to the user (a Linear issue through the `create-linear-issue` skill once they agree). This product has slipped by adding good ideas to the task in hand.
- A deviation from the issue is recorded as a comment on it. Nothing is silently deferred: deferred work is a new Linear issue with the current one as parent, and only when the user agrees.
- A review of the whole product from one role (CTO, product, security, a parent) is a Linear document; start from **"Role reviews: index and template"**.

## Dev environment

Tilt runs everything: apps, databases, migrations, seeds. Never run `pnpm db:*`, `nx serve` or `nx dev` yourself, and always type `pnpm tilt …`, never bare `tilt` (the wrapper targets this checkout's own Tilt). Commands and resources: `docs/infrastructure.md` → "Tilt commands"; test commands: `docs/testing.md` → "Commands".

- **Start of a session**: `pnpm tilt get uiresources`. No answer means Tilt is down: start it (`pnpm tilt up`) before anything else.
- **After a code change** the apps restart themselves; `pnpm tilt trigger <resource>` is for `db-push`, `db-seed`, `db-clean` and the e2e resources. Read results with `pnpm tilt logs <resource>`.
- **The dev gateway can miss a restart.** When the running app contradicts the code or a passing test, compare the process start time with your last edit and run `pnpm tilt trigger api-gateway` (steps: `docs/infrastructure.md` → "When the dev app looks wrong").
- **Type errors are not in the app log.** The backend apps run from source unchecked: use `pnpm nx run <project>:build` (there is no `typecheck` target; `pnpm typecheck` builds every project). A bare `tsc --noEmit` at the root checks nothing.
- **GraphQL types** regenerate through the `codegen` resource, which needs the gateway up. After a resolver or query change, confirm in `pnpm tilt logs codegen`, or run `pnpm codegen` once the gateway answers.
- **`.env` is read when Tilt starts.** A changed variable reaches the apps only after Tilt restarts.
- **E2E**: `pnpm test:e2e:api` and `pnpm ci:check` rebuild and re-seed the e2e stack themselves. Before any other e2e run, and after a backend change, run `pnpm e2e:up`.
- **After a change to project.json, tsconfig, path aliases, Compose files, env vars or a new library**, start the real app and read its log: a green build does not prove it boots.
- Run tasks through `pnpm nx` (`run`, `run-many`, `affected`); read `package.json` scripts and `--help` instead of guessing a command or a flag.

## Parallel dev instances

Several agents work at once, each in its own worktree ("instance", slot 0 to 4) with its own ports, containers and databases. Details and the stale-slot procedure: `docs/infrastructure.md` → "Parallel dev instances".

- **Know your slot before running anything**: `pnpm instance:ports`. Slot 0 is the main checkout.
- **Every port and URL in this file, `docs/` and the skills is the slot 0 value.** Slot n adds `n × 20` (slot 1: web 4220, API 3025). Never type a port from memory.
- **Never touch another instance**: not its ports, not its containers (`roviq-<n>-…`, `roviq-e2e-<n>`), not its database.
- **Do not wait for a busy checkout.** Start the next task in another slot: `pnpm instance:new <slot> <branch>` from the main checkout, or reuse a stale slot. No plain `git worktree`, no second Tilt in a checkout without its own instance.
- In a slot other than 0, prefix `nx`, `vitest`, Tilt commands and `git push` with `env -u NX_WORKSPACE_ROOT_PATH`, or Nx uses the main checkout.
- Never `git stash`: the stash is shared by every worktree.
- New code never hardcodes a dev or e2e port: read the instance variable with the slot 0 default (`process.env.E2E_API_PORT ?? '3004'`); the table is `scripts/lib/instance.ts`.

## Finishing a change

A change is done when all of this is true. Do it without being asked, and do not hand the user commands to run instead.

1. **Tests exist and pass** for every new code path. While working, run only the spec files you touched, save the output to a file and grep it. Every new or changed operation that takes an id has a test in which another institute's or reseller's id is refused.
2. **You drove it in the browser** (Playwright MCP, this instance's dev app): every touched path through the real UI — normal flow, one boundary or forbidden case, a refresh, an account or portal switch. Backend-only changes count: drive the screens that reach the code. Check the screen, the console, the network responses and the stored effect. Method and time-savers: `docs/working-method.md` → "Browser pass". A failed check is a bug: fix it, add a regression test, check again. If no UI reaches the code, say so and verify against the running gateway instead.
3. **`pnpm lint:fix` and `pnpm check:docs` are clean, docs are updated** in the same change (rules: "Docs" below), and for a model change you have checked RLS on every affected table.
4. **Commit** (conventional commit; header and body lines ≤ 100 characters; the subject starts in lower case), a pre-existing fix in its own commit. The hook refuses a bad message and leaves the files staged: confirm with `git log --oneline -1` before staging the next group. Commit and open the PR as soon as the issue's own flows pass; extras are a second, small PR.
5. **Push and merge only when the user asks.** The push runs the one gate for the branch (`pnpm ci:check`): do not run it by hand first. One gate runs per machine and a push waits its turn; before pushing, run `pnpm ci:queue` and message the other local sessions (branch, slot, whether it adds a migration). Redirect the push output to a file and look for `[ci:check] FAILED`; never judge it by `; echo $?` or through `tail`. Details: `docs/working-method.md` → "Pushing".
6. **Merge by squash, always**: `gh pr merge <n> --squash`, never `--merge` or `--rebase`. One pull request is one commit on `main`, titled as a conventional commit. Rebase only when the gate or GitHub reports a conflict or a forked migration chain, not because `main` moved on. Keep pull requests independent of each other; when one must build on another, merge the first, rebase the second onto `main`, and push it again before merging. After merging one that adds a migration, tell the other sessions.
7. **Report** each flow you drove and what you saw, and name anything you could not verify with its reason.

## Hard rules

Full text of a rule: `sed -n '/\[TAGID\]/,/^---$/p' docs/references/hard-rules.md`. Read it when the rule applies to what you are doing.

- [NWKRD] No workarounds: find the root cause and fix it properly.
- [NACPR] [BFCMT] Test fully (automated and in the browser), then commit. See "Finishing a change".
- [LNFST] Linear first. See "What to work on".
- [PXERR] A pre-existing bug is fixed now, in its own commit; a bigger one is raised with the user.
- [SECLG] Every security finding is appended to the Linear document "Security Findings Log" as an `SF-NNN` entry. Append only; a status change is a new entry. Read it before a security review.
- [SECPV] A security finding is written only in Linear documents. Issue, commit, branch, migration and pull request names are neutral and carry no `SF-NNN`.
- [RSBFC] Stuck on a library or an error? Look it up (web search and Context7, both) before wrapping it in try-catch.
- [NTESC] No `any`, `as unknown`, `as never`.
- [NTLSA] Never weaken an assertion to make a test pass: fix the fixture.
- [NRTOP] Never make a required parameter optional to spare call sites: fix the call sites.
- [NDDSN] Never switch off a check, lint rule or gate because it finds failures: fix the failures.
- [NSDFR] Every mandatory review item is applied in the same session unless the user approves deferring it.
- [NPENV] `process.env['FOO']` is banned; `process.env.FOO` only once `FOO` is on `ProcessEnv`.
- [NFEEI] Frontend never imports from `/ee`.
- [SHCMT] Comments are short and say why, not what. Default to none.
- [USKLS] Invoke the matching project skill before the first edit in its domain (tests, database, backend services, frontend). The skill file wins over memory.
- [MDLSP] On a Fable session: Fable plans, reviews, and writes security-sensitive code and migrations itself; Opus (`model: "opus"`) builds and tests; Sonnet does simple volume work. Briefs are self-contained; subagents do not commit, push or run Tilt or database commands; Fable checks every claim against the diff and the test output before repeating it. Pace rules: `docs/working-method.md` → "Working with subagents".

## Architecture

- **api-gateway**: NestJS GraphQL API (Apollo, code-first), port 3005. **notification-service**: NestJS, consumes NATS events. **web**: Next.js 16 App Router, port 4200, one app with three scope directories (`admin/`, `reseller/`, `institute/`) under `apps/web/src/app/[locale]/`; `middleware.ts` maps hostname to scope.
- **Libraries** are `@roviq/*`; every Nx library has a `package.json` beside its `project.json`, and a new one needs a Vitest alias in `apps/api-gateway/vitest.config.ts`.
- **Infra** (Docker, through Tilt): PostgreSQL 18 with RLS, Redis 7, NATS JetStream, S3-compatible storage, Temporal.
- Folder trees and details: `docs/architecture.md`. Common UI components live in `apps/web/src/components/`: check `docs/frontend.md` → "Common components" before building one, and add a line there for a new one.

Three auth scopes, each with its own login, guard and database wrapper (`docs/auth.md`):

| Scope     | Login mutation   | Guard               | DB wrapper       | Local URL                 |
| --------- | ---------------- | ------------------- | ---------------- | ------------------------- |
| platform  | `adminLogin`     | `@PlatformScope()`  | `withAdmin()`    | `admin.localhost:4200`    |
| reseller  | `resellerLogin`  | `@ResellerScope()`  | `withReseller()` | `reseller.localhost:4200` |
| institute | `instituteLogin` | `@InstituteScope()` | `withTenant()`   | `localhost:4200`          |

The app connects as `roviq_pooler` and each wrapper switches to `roviq_app`, `roviq_reseller` or `roviq_admin` with `SET LOCAL ROLE`. Guards and decorators are in `@roviq/auth-backend`; CASL (`@roviq/casl`) is authorization only.

## Quick mistake reference

Rationale and the enforcing gate for each line: `docs/references/mistakes.md`. Read it before touching the area a line names.

- `selectInstitute(membershipId)`, not `tenantId` · abilities live on `Membership`, not `User`
- `withTenant/withReseller/withAdmin(db, ctx, fn)` with the branded ctx — no `$transaction`, no `tenantTransaction()` · the caller's own account rows: `withUser(db, user, fn)`, never `withAdmin` with the user id in the `WHERE`
- `assertTenantContext()` / `assertResellerContext()` / `assertPlatformContext()` / `assertInstituteWithReseller()` instead of inline `ForbiddenException`
- A scope guard is not tenant isolation: institute/reseller code never passes a caller-supplied id to `withAdmin` code without an ownership check · platform operations live in `admin/` resolvers (`pnpm check:admin-context-reach`)
- Foreign keys do not apply RLS: read every caller-supplied id under the caller's own context before storing a reference to it
- Every institute- or reseller-scope operation that takes an id is listed in `foreign-id-coverage.ts` with the spec that sends it another institute's id (`foreign-id-coverage.spec.ts`)
- A `*.service.ts` never queries the database: every query is a repository method, one per unit of work (`pnpm check:service-db-access`)
- `mk*Ctx()` only in workflow activities, seeders, event-consumer repos, integration fixtures (`pnpm check:synthetic-context-usage`)
- `ability.can()`, never role checks · scope decorators at class level, not `APP_GUARD` · `GqlAuthGuard` from `@roviq/auth-backend`
- Every `@CheckAbility` pair must be reachable by a role, every grant used (`ability-coverage.spec.ts`)
- An operation that applies a role's row condition declares `rows: 'scoped'` on `@CheckAbility` and is listed in `row-scope-coverage.ts`; without it the guard refuses a conditional role (`row-scope-coverage.spec.ts`)
- Reads from `<table>Live` views, writes to the base table · new soft-deletable table needs a `*Live` view, every `pgTable` needs RLS · ``.default(sql`uuidv7()`)``
- A schema change reaches a database only through a generated migration; an index, foreign key or unique rule the schema can express is declared there, not in custom SQL (`pnpm check:migrations`)
- An alert on one event reads a gauge, never `increase()` or `rate()` of a counter: a series born at 1 has no increase, so the first event after a restart is lost
- Security rules live in PostgreSQL where possible (GRANT, RLS, CHECK, trigger), not only in services; test by attempting the forbidden write as the role
- `eventBus.emit(EVENT_PATTERNS.…)` via `EventBusService`, never `natsClient.emit` · every event prefix needs a stream
- `@EventPattern` classes go in module `controllers`, and the app's `main.ts` calls `connectJetStreamMicroservice()` (`pnpm check:event-handlers`)
- `defineStateMachine` for status transitions · `calendarDaysBetween` / `isValidDateRange` / `rangesOverlap` from `@roviq/common-types/date-range`
- i18n text (`i18nText()`, tenant-authored names only): the database and the API carry the whole `{ en, hi }` object, the frontend picks the locale with `useI18nField()`; never resolve a locale in a resolver or service · validate with `i18nTextSchema`, edit with `<I18nInput>`
- A message that reports a problem passes the six-point test (what, which one, so what, first steps, where, when it ends): `docs/frontend.md` → "Messages that report a problem"
- UI: `<Button>` from `@roviq/ui`, `useTranslations()`, `useFormatDate()`, scope-prefixed nav hrefs
- Hindi copy is the Hindi people speak: English office words in Devanagari (एडमिशन, सेशन, कोड), never textbook words (पहचानकर्ता, अनुमोदन): `docs/frontend.md` → "Hindi copy"
- Field help: a topic from `apps/web/src/help` passed as `help={…}`; nothing between a label and its input; instructions after the input (`pnpm check:field-help`)
- Testids: `testIds` registry from `@roviq/ui/testing/testid-registry` + `page.getByTestId()`; literal `data-testid` fails `pnpm check:testids`
- A form's submit error stays in the form, never `toast.error`: `setServerFieldError` under the field, or `setFormSubmitError` + `<form.SubmitError />` above the submit button (`pnpm check:form-errors`)
- Errors: `BusinessException(ErrorCode.X, …)` on the backend; frontend branches on `extensions.code` (`isAppError`, `extractGraphQLErrorCode`) and shows translated copy — never `err.message`
- Files: reference `files.id` and return `FileRef`; upload with `<FileUpload>`, attach with `FileService.verifyUploads` + `markFilesReady(tx, …)`; never a URL column, a typed-in URL or a raw S3 call
- Seed credentials and names only from `e2e/shared/seed-fixtures.ts` · e2e database is `roviq_test` · `REDIS_KEYS` constants · impersonation tokens never refresh
- Verify a doc statement or an assertion against the source, not memory

## Docs

`docs/README.md` lists every document and holds the writing rules ("Writing docs"). Read the index before looking for a doc, and the rules before writing one. Before a commit that changes behaviour, and when closing an issue, run the `update-docs` skill: it lists every place in the repository and in Linear a change is recorded.

- **Describe the system as it is now**: no history, plans, known-gap lists or session notes. A plan, spec, PRD, decision or review is a Linear document; work not done is a Linear issue.
- **One home for each fact**: find the document that owns it and edit that; link from elsewhere, never copy.
- **Same change as the code**: `git grep` every renamed file, command, variable or operation across `docs/`, `CLAUDE.md` and `.claude/skills/`.
- **A new document** goes in the folder the index names for its type, and gets a line in `docs/README.md`.
- **`pnpm check:docs`** must pass: every link and backticked path resolves, every doc is in the index.
- `docs/deployment.md` gets a section when a change needs something from production. `docs/changelogs/testing-troubleshooting.md` is append-only: after fixing a testing-infra problem append an entry, never edit an old one.
- An infrastructure, convention or architecture change is recorded in a Linear issue or document as well as in `docs/`.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->
