# Testing Troubleshooting Changelog

Append-only log of testing-infrastructure issues (slow pre-push, Docker rebuilds, flaky suites, cache misses, etc.) and their fixes.

**Rules:**

- Append only. Never edit or delete existing entries — once landed, they stay.
- Newest entry at the bottom.
- Each entry: date, status (`diagnosed` → `fixed`), scope, root cause, fix, references.
- When a `diagnosed` entry gets fixed, append a new `fixed` entry that references the diagnosis date — do not modify the original.

---

## 2026-04-16 — `diagnosed` — husky pre-push takes ~5 minutes

**Scope:** `.husky/pre-push`, `pnpm test:int`, `pnpm test:e2e:api`, `pnpm test:e2e:ui`.

**Root cause:** The hook runs four suites sequentially without any affected-based skipping and without going through Nx targets, so nothing ever hits Nx cache — every push pays full cost even when the diff is unrelated.

**Planned fix:** Replace `.husky/pre-push` with a script that (a) resolves a base SHA from pre-push stdin (fallback `origin/main`), (b) uses `nx show projects --affected` to decide which suites to run, (c) invokes each suite through Nx targets so unchanged inputs hit the cache. Escape hatch: `SKIP_PREPUSH=1 git push`.

**Notes:** E2E Nx projects (`api-gateway-e2e`, `web-{admin,reseller,institute}-e2e`) already carry `implicitDependencies` on `api-gateway`/`web`, so `nx affected` wiring is trivial. Integration tests do not yet have an Nx target and need one to be cacheable.

---

## 2026-04-16 — `diagnosed` — `pnpm e2e:up` rebuilds backend image on unrelated file changes

**Scope:** [docker/Dockerfile.backend:48](../../docker/Dockerfile.backend#L48), [.dockerignore](../../.dockerignore).

**Root cause:** The `dev` stage does `COPY --chown=node:node . .` as a single layer. Any change anywhere in the build context (including `apps/web/**`, `docs/**`, `e2e/**`) invalidates the layer, forcing a rebuild of every downstream service that uses `target: dev` (`api-gateway`, `notification-service`, `migrate-and-seed`, `vitest-e2e`, `rls-tests`). The copied files for `apps/api-gateway/src`, `libs`, `ee`, `dist`, and `scripts` are immediately shadowed at runtime by the volume mounts declared in `compose.e2e.yaml`, so the COPY is doing work that gets thrown away on container start.

**Planned fix:** Split the COPY into targeted directories (`apps/api-gateway`, `apps/notification-service`, `libs`, `ee`, `scripts`, `docker`, plus root configs) and add `apps/web`, `e2e`, `docs`, `.github`, `.husky` to `.dockerignore` so they never enter the backend build context.

---

## 2026-04-16 — `diagnosed` — Next.js rebuilds on every E2E UI run

**Scope:** [package.json](../../package.json) `dev:web:e2e` script, [e2e/playwright.config.ts:117](../../e2e/playwright.config.ts#L117).

**Root cause:** `dev:web:e2e` runs `rm -rf .next && next build` unconditionally, wiping Next's build cache before every Playwright run so Turbopack/webpack recompiles from scratch. Playwright's `webServer.reuseExistingServer: false` additionally forces a web-server restart every run, preventing reuse of an already-warm server on port 4201.

**Planned fix:** Drop `rm -rf .next` from `dev:web:e2e` (Next's build is content-hashed; unchanged `apps/web` is near-instant). Set `reuseExistingServer: !process.env.CI` so local reruns reuse a running server.

---

## 2026-04-17 — `fixed` — e2e api-gateway restart loop silently wipes host `dist/` via bind mount

**Scope:** [docker/compose.e2e.yaml](../../docker/compose.e2e.yaml) `api-gateway` + `notification-service`, host `pnpm run dev:gateway` / `tilt trigger api-gateway`.

**Root cause:** The e2e `api-gateway` service had `restart: unless-stopped` and bind-mounts `../dist:/app/dist`. When the image's `node_modules` went stale (new npm dep in `package.json` not mirrored into the pre-built image), the container crashed at build (`Cannot find module 'date-fns-tz'` on 2026-04-17), restarted, crashed again — 636 times. Each restart, `@nx/js:tsc`'s `compileTypeScriptWatcher` (see [@nx/workspace/src/utilities/typescript/compilation.js](../../node_modules/.pnpm/@nx+workspace@22.6.5_@swc-node+register@1.11.1_@emnapi+core@1.9.2_@emnapi+runtime@1.9.2_88211a056b9f8bab847602a5649bf277/node_modules/@nx/workspace/src/utilities/typescript/compilation.js)) calls `rmSync("/app/dist/apps/api-gateway", { recursive, force })` at startup; through the bind mount that deleted the host's `dist/apps/api-gateway/`. The host's `@nx/js:node` then forked against a missing `main.js` and crashed with "Could not find …/main.js. Make sure your build succeeded." Reproduced 8–60 s after each host `dev:gateway` start.

**Diagnosis difficulty:** Host-side JS spies (`NODE_OPTIONS=--require` hooking `fs.rmSync`/`fs.unlink`/`fs.rename`) and `strace -f` on the pnpm process tree **never saw the deletion** because it happened inside a container (separate PID namespace). System-wide `sudo bpftrace` on `sys_enter_unlinkat`/`sys_enter_rmdir` surfaced the culprit: `comm=MainThread path=/app/dist/apps/api-gateway`, a container-side path.

**Fix:** In [docker/compose.e2e.yaml](../../docker/compose.e2e.yaml), change `restart: unless-stopped` → `restart: on-failure:3` for `api-gateway` and add `restart: on-failure:3` to `notification-service`. Caps a bad restart storm at 3 attempts instead of infinite. The `../dist:/app/dist` bind mount is kept (e2e reuses host's build for fast startup); the restart cap is the guardrail. General diagnosis + recovery flow documented at [docs/troubleshooting.md](../troubleshooting.md).

**Escape hatch for recurrence:** `docker stop roviq-e2e-api-gateway-1 && pnpm e2e:down && pnpm e2e:up`. Never revert the restart policy back to `unless-stopped` — if a container needs to keep retrying, fix its image first.

---

## 2026-04-17 — `fixed` — e2e stack switched to named volumes for `dist/` + nx cache

**Scope:** [docker/compose.e2e.yaml](../../docker/compose.e2e.yaml) `api-gateway` + `migrate-and-seed`, [package.json](../../package.json) `e2e:down`/`e2e:nuke` scripts.

**Context:** Supersedes the earlier fix on 2026-04-17 that kept `../dist:/app/dist` and relied on `restart: on-failure:3` as the sole guardrail. Even with the restart cap, (a) the one-time `rmSync` at container boot still wiped the host's `dist/apps/api-gateway/`, killing any concurrent host `pnpm run dev:gateway`, and (b) the container's `nx serve` and host's `nx serve` both wrote to the same `dist/` directory when run in parallel, racing over partial emits. That pattern — sharing host build output with a container — is non-standard for Node.js dev stacks.

**Root cause of the non-standard pattern:** `../dist:/app/dist` was mounted to "reuse host's build output for fast e2e startup." It saves ~60–90s on first boot but produces hard-to-diagnose corruption whenever host + container are both active.

**Fix:** Follow the industry-standard isolation pattern:

- `api-gateway` and `migrate-and-seed` now mount `e2e_dist:/app/dist` (named volume, shared between the two services, isolated from host).
- `api-gateway` also mounts `e2e_nx_cache:/app/.nx/cache` (named volume) so the container's nx cache persists across `e2e:down` + `e2e:up` cycles. Cold starts after stop/start restore cached outputs in seconds instead of paying a full ~90s rebuild.
- `pnpm e2e:down` no longer passes `-v` — it stops containers but preserves both named volumes. New `pnpm e2e:nuke` script is the explicit opt-in for a clean slate (passes `-v`).
- `restart: on-failure:3` kept — still valuable for transient-failure self-healing (Postgres/Temporal slow start) and for a clear failure signal on hard bugs.

**Verification:** Post-change, `docker inspect roviq-e2e-api-gateway-1` shows `policy=on-failure:3`, `Mounts` uses `volume` type for `/app/dist` and `/app/.nx/cache`, and host `/home/priyanshu/roviq/dist/apps/api-gateway/src/main.js` survived a full `pnpm e2e:nuke && pnpm e2e:up` cycle untouched.

**Do NOT:**

- Revert `e2e_dist:/app/dist` back to `../dist:/app/dist` — this is the exact regression we just eliminated.
- Add `-v` back to `e2e:down` — makes every teardown pay full cold-rebuild cost.
- Revert `restart: on-failure:3` to `unless-stopped` — removes clear failure signal (see previous entry).

---

## 2026-04-17 — `fixed` — husky pre-push runtime cut from ~5 min to seconds via `pnpm ci:check`

**Resolves:** the three 2026-04-16 `diagnosed` entries above (slow pre-push, backend image rebuilds on unrelated changes, Next.js rebuilds on every UI run).

**Scope:**

- [.husky/pre-push](../../.husky/pre-push) — now a one-line delegate to `pnpm ci:check`
- [scripts/ci-check.sh](../../scripts/ci-check.sh) — new unified CI gate, affected-mode locally, full-suite under `CI=true`
- [package.json](../../package.json) — `ci:check` script + `test:int`/`test:e2e:api`/`test:e2e:ui` rerouted through Nx targets
- [docker/Dockerfile.backend](../../docker/Dockerfile.backend) — `dev`, `build`, and `migrator` stages split into per-directory COPYs so unrelated edits don't bust the layer hash
- [docker/Dockerfile.backend.dockerignore](../../docker/Dockerfile.backend.dockerignore) — denylist expanded with `apps/web`, `docs`, `.github`, `.husky`, `.cursor`, `.vscode`, `**/coverage`, `**/playwright-report`, `**/test-output`
- [apps/web/next.config.js](../../../apps/web/next.config.js) — `experimental.turbopackFileSystemCacheForBuild: true` (Next 16.2)
- [apps/web/src/app/api/__e2e-ready/route.ts](../../../apps/web/src/app/api/__e2e-ready/route.ts) — readiness + build-fingerprint probe
- [e2e/playwright.config.ts](../../../e2e/playwright.config.ts) — `reuseExistingServer: !process.env.CI`, `webServer.url` points at the probe, new `web-env-check` setup project that all portal-setups depend on
- [e2e/shared/web-env-check.setup.ts](../../../e2e/shared/web-env-check.setup.ts) — asserts running web server's `NEXT_PUBLIC_*` env matches E2E expectations, fails fast on stale-build reuse
- [nx.json](../../../nx.json) — new `namedInputs`: `integrationSources`, `e2eBackend`, `e2eFrontend`; `sharedGlobals` extended with `pnpm-workspace.yaml` and `pnpm-lock.yaml`
- [tools/integration-tests/](../../../tools/integration-tests/) — new tools-only Nx project owning the cross-cutting `test:int` target with `cache: true` + `parallelism: false`
- [tools/web-e2e-suite/](../../../tools/web-e2e-suite/) — new tools-only Nx project owning the cacheable `e2e` target that runs Playwright once across all portals + cross-portal (avoids the 3× redundancy of `nx run-many -t e2e -p 'web-*-e2e'`)
- [e2e/api-gateway-e2e/project.json](../../../e2e/api-gateway-e2e/project.json) — new `test-e2e` target with `cache: true` + `inputs: ["e2eBackend"]`

**Changes that resolve each diagnosis:**

1. **Slow pre-push (5 min → seconds).** `scripts/ci-check.sh` reads pre-push stdin, computes `git merge-base HEAD origin/main` (with edge-case handling for new branches, deletions, force-push, multi-ref, detached HEAD, empty stdin), and runs lint/typecheck/unit through `nx affected` + integration/e2e through cacheable Nx targets in parallel with isolated per-suite logs. Empty diff → ~2s exit. Identical inputs to a prior run → cache hit on every suite.

2. **Backend image rebuilds on unrelated changes.** `Dockerfile.backend` `dev`, `build`, and `migrator` stages now COPY only the directories each stage needs; `apps/web`, `docs`, `e2e`, `.github`, `.husky`, `.cursor`, `.vscode`, coverage/playwright outputs are excluded via the per-Dockerfile `Dockerfile.backend.dockerignore` so they never enter the build context. `package.json:e2e:up` sets `COMPOSE_BAKE=true` so the shared `dev` stage is built once instead of once per dependent service (api-gateway, migrate-and-seed, vitest-e2e, rls-tests). Build stage uses BuildKit cache mount on `.nx/cache` so single-app changes replay the other app from cache.

3. **Next.js rebuilds on every UI run.** `dev:web:e2e` no longer runs `rm -rf .next`. `apps/web/next.config.js` opts into `experimental.turbopackFileSystemCacheForBuild` (Next 16.2 beta) so SWC transforms / RSC outputs / module metadata persist across builds. Playwright `reuseExistingServer: !process.env.CI` lets local reruns skip rebuild + restart entirely. `web-env-check` project + `/api/__e2e-ready` route close the stale-env loophole that server reuse would otherwise open.

**Other deliberate trade-offs:**

- E2E targets are cached despite hitting a real backend. Schema, migrations, and seed scripts (`scripts/seed.ts`, `seed-ids.ts`, `db-reset.ts`, `db-baseline.ts`) are part of the `e2eBackend`/`e2eFrontend` input hashes, and `pnpm e2e:clean` re-seeds before each run, so the only uncovered risk is manual DB edits — covered by the documented `NX_SKIP_NX_CACHE=1 git push` escape hatch.
- `tools/integration-tests` and `tools/web-e2e-suite` are tools-only projects. They have no source files, so `nx affected` will not pick them up automatically. `ci-check.sh` always invokes their targets and lets the target's input hash decide cache hit vs miss. The integration target's `inputs: ["integrationSources"]` and the e2e suite's `inputs: ["e2eFrontend"]` carry the full hash contract.
- `pnpm e2e:up` and `pnpm e2e:clean` are pre-run synchronously by `ci-check.sh` once before any e2e suite launches. Running them inside the parallel suites would race two `migrate-and-seed` containers over the same DB. Trade-off: ~30s wasted on cache-hit-only runs. Acceptable price for correctness.
- E2E API and E2E UI run **sequentially** (api → ui) inside one parallel job slot, even though they're both cached. They share `roviq_test` on port 5435 and any non-idempotent test would race across suites if parallelised. Other suites (lint, typecheck, unit, integration) run alongside this serial e2e block — integration uses port 5433 (dev DB), no DB collision.
- A `flock` on `/tmp/roviq-ci-check.lock` prevents concurrent invocations from corrupting shared `roviq_test` state. Second invocation exits 1 with a clear message.
- The per-portal `web-{admin,institute,reseller}-e2e:e2e` targets are intentionally NOT routed into `pnpm ci:check`. They remain unchanged (uncached) for direct dev invocation; the unified `web-e2e-suite:e2e` target replaces them in the gated workflow because per-portal Playwright invocations without `--project=` filtering re-run the full suite each time.
- `apps/web/src/app/api/__e2e-ready/route.ts` is **gated** in production: `NODE_ENV=production` returns 404 unless `E2E_PROBE=1` is set. The route exposes `NEXT_PUBLIC_*` (already public) plus `NEXT_BUILD_ID`; the gate prevents accidental disclosure on real deployments.
- `pre-commit` (lint:fix + lint-staged + typecheck + test:unit) is intentionally NOT modified. It overlaps with `pre-push`'s `ci:check` for these targets, but every overlapping target is Nx-cached — the second run hits cache and is near-instant. Defense in depth at low marginal cost.

**Bypass / escape hatches (documented in `scripts/ci-check.sh` header and CLAUDE.md):**

- `SKIP_PREPUSH=1 git push` — this script's env-var bypass (local only, ignored under `CI=true`)
- `HUSKY=0 git push` — husky's documented global disable
- `git push --no-verify` — git-native, skips all client-side hooks
- `NX_SKIP_NX_CACHE=1 git push` — forces Nx to re-execute cached targets
- `pnpm dlx rimraf apps/web/.next` — wipe Next's persistent Turbopack cache after a dep upgrade leaves a stale hit
- `pnpm nx reset` — full Nx cache nuke

**Do NOT:**

- Replace `pnpm ci:check` in `.husky/pre-push` with the prior 4-line sequential script. The script's affected-mode logic is what makes pre-push fast.
- Remove `parallelism: false` from `integration-tests:test:int`, `api-gateway-e2e:test-e2e`, or `web-e2e-suite:e2e`. They share `roviq_test`; concurrent runs would corrupt seed state.
- Drop the `web-env-check` Playwright project or the `/api/__e2e-ready` route. They're the only thing that catches a port-bound but mis-built web server when `reuseExistingServer: !CI` is true.
- Move `pnpm e2e:clean` back into the e2e target commands. Parallel `migrate-and-seed` runs race; the script-level pre-run is intentional.

---

## 2026-05-08 — `fixed` — E2E UI visual snapshots are opt-in

**Scope:** [e2e/playwright.config.ts](../../e2e/playwright.config.ts), [package.json](../../package.json), [apps/web/src/app/api/e2e-ready/route.ts](../../apps/web/src/app/api/e2e-ready/route.ts), [e2e/web-admin-e2e/src/visual-regression.e2e.spec.ts](../../e2e/web-admin-e2e/src/visual-regression.e2e.spec.ts), [e2e/web-institute-e2e/src/visual-regression.e2e.spec.ts](../../e2e/web-institute-e2e/src/visual-regression.e2e.spec.ts), [e2e/web-reseller-e2e/src/visual-regression.e2e.spec.ts](../../e2e/web-reseller-e2e/src/visual-regression.e2e.spec.ts).

**Context:** `pnpm test:e2e:ui` was failing only on visual snapshot diffs after functional E2E issues were fixed. The authenticated dashboard/subscription screenshots were stale relative to the current shell/sidebar/dashboard states, while the user explicitly did not want snapshot expectation changes in the normal test path.

**Root cause:** Visual snapshot tests were part of the default UI E2E suite and failed the gate whenever UI baselines drifted. Separately, the readiness probe used `/api/__e2e-ready`; Next App Router treats underscore-prefixed route segments as private, so the route was not included in the production build and Playwright webServer readiness timed out.

**Fix:**

- Moved the readiness probe to `/api/e2e-ready`, kept the `E2E_PROBE=1` production gate, and updated Playwright readiness checks to use the routable path.
- Set the E2E web build/start env explicitly to `NEXT_PUBLIC_API_URL=http://localhost:3004` and empty `NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER`, matching the Docker E2E stack.
- Added `E2E_VISUAL_SNAPSHOTS=1` as the opt-in gate for visual snapshot specs. Normal `pnpm test:e2e:ui` skips them; force-run with `E2E_VISUAL_SNAPSHOTS=1 pnpm test:e2e:ui`.
- Fixed related functional UI E2E failures exposed during the run: guardian consent selector scoping, role-settings login/session isolation, role row lookup, restore ordering, toast locator strictness, and missing `nav.*`/`common.saving` i18n keys.

**Verification:** `pnpm test:e2e:ui` passes with `213 passed, 19 skipped`. `E2E_VISUAL_SNAPSHOTS=1 pnpm exec playwright test e2e/web-admin-e2e/src/visual-regression.e2e.spec.ts --config e2e/playwright.config.ts --project admin --list` lists the visual snapshot tests, proving the opt-in path still discovers them. `pnpm lint:fix` passes. `NEXT_PUBLIC_API_URL=http://localhost:3004 pnpm typecheck` passes; plain `pnpm typecheck` needs the Tilt dev API on port 3005 because codegen defaults to the dev GraphQL URL.

**Do NOT:**

- Reintroduce `/api/__e2e-ready`; the underscore segment is private in the Next App Router build output.
- Update visual snapshot PNGs as part of the default E2E fix path unless the user explicitly approves baseline changes.
- Remove the `E2E_VISUAL_SNAPSHOTS=1` gate from visual specs without replacing it with another explicit opt-in.

---

## 2026-05-08 — `fixed` — `ci:check` passes E2E web env to the Nx UI target

**Scope:** [scripts/ci-check.sh](../../scripts/ci-check.sh), [docs/changelogs/testing-troubleshooting.md](./testing-troubleshooting.md).

**Context:** Running `pnpm ci:check` failed in `web-env-check` with `Expected: "http://localhost:3005"` and `Received: "http://localhost:3004"` after the E2E UI fixes landed.

**Root cause:** `ci:check` prebuilt the Next E2E web app with `NEXT_PUBLIC_API_URL=http://localhost:3004`, but later invoked `pnpm -s nx run web-e2e-suite:e2e` without exporting the same env. Nx loaded the repo `.env`, where `NEXT_PUBLIC_API_URL=http://localhost:3005`, so `web-env-check` compared the already-built E2E server against the dev API default.

**Fix:** Export `NEXT_PUBLIC_API_URL=http://localhost:3004` and empty `NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER` on the `web-e2e-suite:e2e` invocation inside `ci:check`, matching the host-side E2E web build and the package `test:e2e:ui` script.

**Verification:** `pnpm ci:check` passes.

---

## 2026-05-20 — `fixed` — UI E2E suite re-seeds between API E2E mutations

**Scope:** [tools/web-e2e-suite/project.json](../../tools/web-e2e-suite/project.json), [package.json](../../package.json), [apps/web/src/app/[locale]/admin/(dashboard)/institutes/_components/reseller-combobox.tsx](../../apps/web/src/app/[locale]/admin/(dashboard)/institutes/_components/reseller-combobox.tsx), [apps/web/src/app/[locale]/admin/(dashboard)/institutes/new/page.tsx](../../apps/web/src/app/[locale]/admin/(dashboard)/institutes/new/page.tsx).

**Context:** Five Playwright tests failed under direct `nx run web-e2e-suite:e2e` invocation: two admin `forms-improved.e2e.spec.ts` cases timed out waiting for `create-institute-submit-btn` to enable; three `students-create.e2e.spec.ts` cases timed out waiting for `students-new-standard-select` to enable.

**Root cause (two independent bugs):**

1. **Reseller combobox auto-default poisons `canSubmit`.** `ResellerCombobox` runs a `useEffect` that calls `onChange(systemReseller.id)` once resellers load. In the admin create form that `onChange` is `field.handleChange`, which marks the field touched. TanStack Form v1.29 computes `canSubmit = (submissionAttempts===0 && !isTouched && !hasOnMountError) || (!isValidating && !isSubmitting && isValid)`; once touched flips, the first clause is false and the second is false on a blank form, so the shared `<form.SubmitButton>` stays disabled forever. The two tests that click submit on a blank form to surface inline errors observed the perma-disabled button.
2. **API E2E academic-year mutation polluted INSTITUTE_1.** `institute.api-e2e.spec.ts` calls `createAcademicYear` + `activateAcademicYear` on INSTITUTE_1, flipping the seed year `…000501` (which holds every seeded standard) to inactive and a new year `2031-32` to active. The student create form picks the active year via `useAcademicYearsForStudents`, queries `useStandardsForYear`, gets zero results, and keeps the standard select disabled. The `pnpm e2e:clean` pre-run before `pnpm test:e2e:api` was gone by the time UI tests started, and a direct `nx run web-e2e-suite:e2e` invocation never re-seeded.

**Fix:**

- Added an `onDefault?: (id) => void` prop to `ResellerCombobox`. The admin create form passes `(id) => form.setFieldValue('resellerId', id, { dontUpdateMeta: true })`, so the auto-default writes the value without flipping `isTouched`. The shared filter/edit callers keep falling back to `onChange`.
- Added an uncached `e2e-seed` target on `web-e2e-suite` that runs `pnpm e2e:clean`, and wired `e2e` `dependsOn: ["e2e-seed"]`. Calling the Nx target directly (CI, `pnpm test:e2e:ui`, ad-hoc `nx run web-e2e-suite:e2e`) now re-seeds before Playwright starts, clearing any state mutated by an earlier `api-gateway-e2e` run.
- Dropped the now-redundant `pnpm e2e:clean` from `test:e2e:ui` to avoid double-seeding.

**Why this is safe despite the 2026-04-16 "Do NOT" entry:** `ci-check.sh` no longer launches `api-gateway-e2e` and `web-e2e-suite` as separate parallel jobs — they share one launched bash slot and run sequentially. Only `web-e2e-suite` (not `api-gateway-e2e`) gets the dependsOn, so at most one `migrate-and-seed` container runs at a time. The original race scenario (two parallel suites racing the seed) cannot occur in the current `ci-check.sh` layout.

**Verification:**

- `PGPASSWORD=roviq_dev psql -h localhost -p 5435 -U roviq -d roviq_test` showed two `academic_years` rows for INSTITUTE_1 (the inactive seed year and the test-created active `2031-32`); after `pnpm e2e:clean` only the seed row remains.
- All 5 previously failing tests pass; `pnpm lint:fix` and `pnpm typecheck` pass.

**Do NOT:**

- Re-add `pnpm e2e:clean` to `test:e2e:ui` — the Nx target's `e2e-seed` dependency already covers it; two seeds add ~30s with no benefit.
- Add `e2e-seed` as a dependency to `api-gateway-e2e:test-e2e`. The `ci-check.sh` Phase 2 already seeds before the API suite, and adding a second dependency would race with `web-e2e-suite:e2e-seed` if a future refactor parallelises the two e2e suites.

---
