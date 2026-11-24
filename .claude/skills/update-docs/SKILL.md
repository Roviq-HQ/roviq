---
name: update-docs
description: Use when a change is ready to commit or an issue is being closed, when the user says "update docs", when a file, command, variable, operation or setting was renamed or removed, or when something written earlier (a doc, a README, a Linear issue, comment, document, project or milestone) no longer matches the code
---

# Updating the records after a change

A change is recorded in two places: the repository (what the system is now) and Linear (what was asked, decided, deviated from and left open). Both are updated in the same change as the code. Writing rules for Markdown: `docs/README.md` → "Writing docs"; read them before the first edit.

## 1. List what changed

Work from the diff, not from memory:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- .env.example '*.md' | head -200
```

Write down every name that was added, renamed or removed: files, commands, env variables, GraphQL operations, events, tables, columns, enum values, error codes, routes, abilities, settings. Then `git grep` each old name across `docs/`, `ee/docs/`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md` and `.claude/skills/`.

## 2. Update each home

Go through every row. A row that does not apply is skipped; a row that applies is never left for later.

**Repository** (public)

| What changed | Where it is recorded |
|--------------|----------------------|
| How a part of the system works | The top-level doc that owns it (`docs/architecture.md`, `docs/auth.md`, `docs/frontend.md`, `docs/infrastructure.md`, `docs/testing.md`, `docs/security.md`) |
| One product area's behaviour | `docs/features/<area>.md` |
| Something a user can now do, or can no longer do | `README.md` and `docs/product.md`, only once it is built and usable |
| A setting, a secret, a migration step or anything production needs | `.env.example`, the app's env validation, and a section in `docs/deployment.md` |
| Steps for a developer task | `docs/guides/` |
| A new shared UI component | `docs/frontend.md` → "Common components" |
| A new event or stream | `docs/guides/events.md` |
| A rule agents must follow, a new gate, a trap | `CLAUDE.md` (one line), full text in `docs/references/`, and the matching skill in `.claude/skills/` |
| A fix to test tooling | Append to `docs/changelogs/testing-troubleshooting.md`; never edit an old entry |
| A new document | A line in `docs/README.md`, in the folder the index names for its type |
| Enterprise Edition | `ee/docs/` |

**Linear** (issues, comments, projects and milestones are public; documents hold what must stay private)

| What changed | Where it is recorded |
|--------------|----------------------|
| The issue was built | A comment on the issue: built, deviations, verified, not verified. Then its status (`In Progress` while on a branch, `Done` after the merge). Tick nothing in the description you did not check |
| The build differs from the issue | A deviation comment on the issue. The description stays as the request; it is not rewritten to match the code |
| An earlier comment of yours is now wrong | A follow-up comment that names what it replaces. A stale statement is never left standing |
| Work was deferred, with the user's agreement | A new issue with the current one as parent (`create-linear-issue` skill) |
| What is merged, what is next, what waits for the owner | Append to the document "Roadmap: order of work". Only the owner changes "Current stage" |
| The owner decided something | Append to "Product decisions log", dated |
| A security finding or its change of status | Append an `SF-NNN` entry to "Security Findings Log" |
| A plan, spec, review or decision record | A Linear document, never a file in the repository |
| Hosting, provider, cost or backup details | A Linear document only. Never an issue, a comment, a commit or `docs/` |
| The last open issue of a milestone or project was finished, or its scope changed | Update the milestone or the project description to the present state, and post a project status update |
| An infrastructure, convention or architecture change | A Linear issue or document, as well as `docs/` |

## 3. Rules while writing

1. **Describe the system as it is now.** No history, no plans, no "recently". Why it changed belongs in the commit and the issue.
2. **One home for each fact.** Edit the document that owns it and link from elsewhere. Do not copy a command, a port or rule text into a second file.
3. **Check every statement against the source** before writing it: open the file, run the command, read the name as the code spells it.
4. **Append to logs, do not rewrite them**: the roadmap, the decisions log, the findings log and the changelog are append-only. Use `save_document` with a `patch` append, without reading the document first; `save_issue` echoes the whole issue, so call it once.
5. **Say "institute"**, never "school" or "organization". Name no SMS or WhatsApp provider company anywhere in the repository: say "the provider".
6. **Claim only what you verified.** "Not verified" is listed with its reason, in the comment and in the report.

## 4. Check and report

```bash
pnpm check:docs
pnpm lint:fix
git diff origin/main...HEAD | grep -i "school"   # expect nothing
```

`pnpm check:docs` proves links and paths resolve and every document is indexed. It does not prove a statement is true: re-read each paragraph you touched against the code.

Report three lists: updated (file or Linear item, one line each), checked and already correct, and left for the user (with the reason).

## Common mistakes

| Mistake | Instead |
|---------|---------|
| Updating `docs/` and forgetting the issue comment, the roadmap line or `.env.example` | Walk both tables in step 2, every row |
| Editing the issue description to match what was built | Leave it; record the difference as a deviation comment |
| A later commit on the branch changes behaviour described in an earlier comment | Post the follow-up comment in the same session |
| Putting a provider name, a host, a price or a backup location in an issue or `docs/` | Linear document only |
| Adding a "Known gaps" or "Planned" section to a doc | A limit is one sentence where it applies; work to do is a Linear issue |
| Listing a feature in `README.md` before a user can use it | Add it when it is built |
| Trusting `pnpm check:docs` as proof the docs are right | It checks links, not truth |
