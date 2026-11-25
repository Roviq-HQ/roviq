# Roviq documentation

Start here. Every document under `docs/` is listed on this page.

## Start

| Document | Read it to |
|----------|------------|
| [Product overview](product.md) | Learn what Roviq does, who uses it, the editions and what is not built yet |
| [Getting started](getting-started.md) | Run Roviq on your machine and log in |
| [Architecture](architecture.md) | See the system on one diagram, the repository layout and the main design decisions |
| [Security overview](security.md) | Learn how institutes are kept apart and how access is controlled |
| [Contributing](../CONTRIBUTING.md) | Learn how a change gets from a branch to `main` |
| [Security policy](../SECURITY.md) | Report a vulnerability |

## How the system works

| Document | Covers |
|----------|--------|
| [Architecture](architecture.md) | Multi-tenancy and RLS, notifications, file storage, dates and time zones |
| [Auth](auth.md) | The three scopes, tokens, sessions, impersonation, CASL abilities |
| [Frontend](frontend.md) | The three portals, shared components and libraries, layout |
| [Infrastructure](infrastructure.md) | Tilt, Docker services, parallel dev instances, the database, environment variables |
| [Testing](testing.md) | Test types, commands, the e2e stack, CI and the pre-push gate |
| [Deployment](deployment.md) | What a production deploy needs |

## Guides

How to do one task.

| Document | Task |
|----------|------|
| [Forms](guides/forms.md) | Build a form with the `@roviq/ui` form kit |
| [Events](guides/events.md) | Publish and consume events over NATS JetStream |
| [Dependency updates](dependency-updates.md) | Update and upgrade npm dependencies |
| [Working method](working-method.md) | Verify a change in the browser; work with subagents |
| [Troubleshooting](troubleshooting.md) | Find the cause when the dev or e2e environment misbehaves |

## Features

One document per product area: data model, operations, permissions, events, screens.

| Document | Area |
|----------|------|
| [Institutes](features/institutes.md) · [API](features/institutes-api.md) | The tenant, academic years, standards, sections, subjects |
| [Students](features/students.md) | Student records, enrolment, year-end promotion |
| [Staff and guardians](features/staff-and-guardians.md) | Staff, qualifications, guardians and their links to students |
| [Attendance, leaves and holidays](features/attendance.md) | Daily attendance, leave requests, the holiday calendar |
| [Timetable](features/timetable.md) | Weekly timetables and per-date overrides |
| [Examinations](features/examinations.md) | Exams, marks, results, report cards |
| [Certificates](features/certificates.md) | Transfer certificates and other certificates |
| [Audit logging](features/audit-logging.md) | The audit trail of every scope |
| [Billing](../ee/docs/billing.md) · [Payments library](../ee/docs/payments-library.md) | Enterprise Edition: plans, subscriptions, invoices, payment gateways |

## User guides

Written for the people who use the product, not for developers.

- [Admin portal](user-guides/admin-portal.md)
- [Reseller portal](user-guides/reseller-portal.md)
- [Institute portal](user-guides/institute-portal.md) · [Timetable](user-guides/timetable.md)

## Reference

Rules to look up, not to read through.

- [Hard rules](references/hard-rules.md): the full text of each tagged rule in `CLAUDE.md`
- [Mistakes](references/mistakes.md): each line of the quick mistake reference, with its reason and gate
- [Frontend UX rules](references/frontend-ux.md): the full text of each rule in the `frontend-ux` skill

## Operations

- Runbooks: [Audit alerts](runbooks/audit-alerts.md) · [DLQ message spike](runbooks/dlq-messages.md) · [EventBus emit failures](runbooks/eventbus-emit-failures.md) · [JetStream stream migrations](runbooks/stream-migrations.md) · [Notification delivery alerts](runbooks/notification-delivery.md)
- Alert rules and dashboards: `docker/openobserve/`, loaded into OpenObserve by `pnpm observability:load` ([Observability](infrastructure.md#observability))
- [Testing-infrastructure changelog](changelogs/testing-troubleshooting.md): append-only log of test-infrastructure problems and their fixes

## Writing docs

These rules apply to every Markdown file in the repository. `pnpm check:docs` enforces the ones a
script can check, and runs in the pre-push gate.

**Where a document goes**

| You are writing | It goes in |
|-----------------|------------|
| How one part of the system works (design, contracts, data flow) | The matching top-level file (`architecture.md`, `auth.md`, …); a new top-level file only for a new cross-cutting area |
| Steps for one developer task | `guides/` |
| One product area | `features/<area>.md`, one file per area |
| Help for end users | `user-guides/` |
| What to do when an alert fires or an operation is risky | `runbooks/` |
| Full text behind a rule list | `references/` |
| What production needs | `deployment.md` |
| Enterprise Edition | `ee/docs/` |
| What the product does, for someone deciding whether to use it | `product.md`; a claim goes there only when the feature is built |
| A plan, spec, PRD, decision record, review, test checklist or session note | Not in this repository: these are Linear documents |

**Rules**

1. **Describe the system as it is now.** No history, no "recently added", no plans. Why a change
   happened belongs in the commit and the Linear issue; an issue id in brackets, `(ROV-123)`, is
   enough to point there. A limit the reader must know is one sentence where it applies ("half-day
   is not a status"); work to be done is a Linear issue, not a list in a document.
2. **One home for each fact.** Write it once and link to it from elsewhere. Do not copy commands,
   ports, credentials or rule text into a second file.
3. **Check every statement against the source** before writing it: the path exists, the command
   runs, the name is spelled as in the code.
4. **Update docs in the same change as the code.** A renamed file, command, variable or operation
   is fixed in every document that names it (`git grep` the old name).
5. **Every document is listed on this page**, and every link and path in it resolves.
6. **Keep a document one type.** A guide does not explain the design; a reference does not teach.
   Link across instead.
7. **Claim only what is built.** `README.md` and `product.md` are read by people deciding whether
   to use Roviq. A feature is named there when a user can use it today, and a limit is stated
   plainly.
8. **Do not list what the code already lists** (every file in a folder, every field of a table)
   unless the document adds meaning to each item. Such lists go stale first.

**Format**

- File names are `kebab-case.md`. One `#` title, sentence case headings, no skipped levels.
- Links are relative. A repository path in prose goes in backticks, written from the repository
  root (`apps/web/src/middleware.ts`). A link whose path has brackets or parentheses is written
  `[text](<path>)`.
- A port or URL is the slot 0 value (`docs/infrastructure.md` → "Parallel dev instances").
- Say "institute", never "school" or "organization" ("tenant" for the infrastructure side).
  `SCHOOL` is fine as the institute type.
- Code blocks name their language. Tables for lookups, numbered lists for steps, prose for reasons.
- Hosting, provider, cost and backup details never go in this repository.
