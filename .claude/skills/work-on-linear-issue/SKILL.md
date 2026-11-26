---
name: work-on-linear-issue
description: Use when starting work on a Linear issue — the order of steps from reading the issue to the report, with pointers to the rules in CLAUDE.md
---

# Working on a Linear issue

The rules are in root `CLAUDE.md`; this is the order to apply them in.

## 1. Understand
- Read the whole issue and its comments (`get_issue`, then `list_comments`): prerequisites, steps, file paths, "Verification", "Does NOT Change". Read any linked Linear document.
- Search Linear for newer issues on the same area (`list_issues` with a keyword). If one partly replaces this issue, ask which applies before coding.
- Check the code against the issue's claims before planning: file paths and "line near N" drift, and `main` may already contain part of the work.
- Where the issue leaves a choice open, decide, and record the decision as a comment on the issue before building.

## 2. Prepare the checkout
- Your checkout is clean and on a branch cut from `origin/main` (`git fetch origin`, `git switch -c <branch> origin/main`; the issue's `gitBranchName` is the branch name). If the checkout is busy, use another instance slot (`CLAUDE.md` → "Parallel dev instances").
- `pnpm install`, then `pnpm tilt get uiresources`: Tilt up, gateway answering.
- A blocking issue that is not merged → stop and say what is missing.

## 3. Build
- Invoke the matching skill before the first edit in a domain (backend-service, drizzle-database, frontend-ux, testing-*).
- Follow the issue's steps in order.
- A pre-existing bug found on the way gets its own commit as soon as it is tested.

## 4. Verify
- Tests for every new path; run only the spec files you touched, output saved to a file.
- Every item under "Verification", one by one.
- The browser pass (`docs/working-method.md` → "Browser pass"), backend-only changes included.
- `git diff | grep -i "school"` returns nothing.
- "Does NOT Change": `git diff --stat` shows only files this issue needs.

## 5. Update the records
- Invoke the `update-docs` skill before the commit, every time, without being asked. It walks every place this change is recorded: in the repository (`docs/`, `README.md`, `.env.example`, `CLAUDE.md`, skills) and in Linear (the issue comment and status, the roadmap, the decisions log, the findings log, the project and its milestone).
- Invoke it again when a later commit on the branch changes behaviour, and after the merge (issue status `Done`, roadmap line).

## 6. Commit and report
- `pnpm lint:fix`, commit (`CLAUDE.md` → "Finishing a change"). Push and open the PR when the user asks or the session's working agreement says so (`docs/working-method.md` → "Pushing": `pnpm ci:queue`, message the other sessions). Rebase only when the gate reports a conflict or a forked migration chain, then re-run the touched integration specs.
- The issue comment written in step 5 says what was built, decisions and deviations, what was checked in the browser, what was not.
- Tell the user the same, shortly, with anything they must decide.

## 7. Clean up after the merge
Do this as soon as `gh pr view <n> --json state` says `MERGED`, without being asked. Touch only
what this session made; another session's branch, slot or database is never yours to clean.
- Records: run `update-docs` again (issue `Done`, roadmap line), and tell the other sessions if
  the pull request added a migration.
- Branch: in the checkout, `git fetch --prune origin`, then `git switch --detach origin/main`
  in a slot (the main checkout holds `main`) or `git switch main && git pull --ff-only` in the
  main checkout. Delete the merged branch locally (`git branch -D <branch>`) and on GitHub
  (`git push origin --delete <branch>`, skipped when GitHub already deleted it).
- Leftovers of the work: revert `.env` edits that are not part of the change, drop scratch
  databases you created, stop your Monitors and background commands, close the Playwright
  browser, and delete scratch files you no longer need.
- Slot: when the next issue starts in the same slot, cut its branch there. When this session
  has nothing more for the slot, stop its Tilt (`pnpm tilt down`) and leave the worktree for
  reuse (`docs/infrastructure.md` → "Parallel dev instances"); remove it only when the user asks.
- Check: `git status --short` is empty, and `git branch` lists no branch whose pull request is
  merged. A branch with commits that are not on `main`, or uncommitted files, is reported to the
  user, never deleted.
