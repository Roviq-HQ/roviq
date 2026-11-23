# Working method

How to verify a change, hand it to the user, and work with subagents. `CLAUDE.md` holds the rules;
this file holds the method. Every line here is a mistake that cost a session 10 to 40 minutes.

## Browser pass

Automated tests passing does not mean the feature works for a user. Before reporting a change as
done, drive it in the running dev app of your own instance (`pnpm instance:ports` for the URLs).

What to cover:

- Every touched path through the real UI: the normal flow, one boundary or forbidden case, a
  refresh, and an account or portal switch.
- For a backend change, the screens that call the changed resolver or service. An auth change
  means a login on each portal, a wrong-portal login, logout, and impersonation start and end.
- The result, not only the click: the screen, the browser console, the network responses, and the
  stored effect (the row, the event, the status) through the UI or a query.
- A second role that must be refused (for example a teacher) and a second institute whose ids
  must answer "not found".

How to do it quickly (Playwright MCP):

- **Check the gateway is current first**: `docs/infrastructure.md` → "When the dev app looks
  wrong". A stale gateway looks exactly like a bug.
- **Log in once per portal and keep the page.** Later `browser_run_code` calls
  (`browser_run_code_unsafe` in newer versions) reuse the same `page`. Never open a context, log
  in, do one thing and close.
- **A second account** that must stay logged in beside the first gets its own tab in an isolated
  context (`browser_tabs` with `isolatedContext`). Cookies on `localhost` are shared across ports,
  so each instance also needs a context of its own.
- **Set a desktop viewport first** (`page.setViewportSize({ width: 1440, height: 900 })`): at the
  default size the institute switcher and other top-bar controls are hidden.
- **One call per flow**: navigate, act, wait for the final text, return what you need. Not one
  click per call.
- **Attach listeners once** for console errors and GraphQL responses with `errors`, collect them
  on the page object, and return them with each flow.
- **Before clicking**, check state that toggles (`aria-checked`, `aria-pressed`), and press Escape
  when an open dialog's overlay blocks the next click.
- **API checks from the logged-in session**: read the access token from `sessionStorage` and
  `fetch` the instance's GraphQL endpoint inside `page.evaluate`. Good for forbidden cases the UI
  does not offer.
- If the dev app or database is broken or behind, fix it first (`pnpm tilt trigger …`, including
  `db-clean`). That is part of the task.
- If the browser is unavailable, find out why. Do not write a headless script and then repeat the
  pass.

What to report: each flow you drove and what you saw; anything you could not verify, with the
reason. "Not browser-tested" needs a blocker you tried and failed to remove. If no UI reaches the
code, say so and verify the same paths against the running gateway (GraphQL requests plus a
database read).

## Before you call it done

1. The spec files you touched pass; the output is saved to a file and read from there.
2. The browser pass above is clean.
3. `pnpm lint:fix`; `pnpm nx run <project>:typecheck` for each project you touched.
4. Docs are updated in the same change.
5. The Linear issue and its comments are re-read against the work: every item of "Verification",
   nothing from "Does NOT Change".
6. For a model change, the RLS status of every affected table is checked and reported.
7. After deleting a library's last spec file, run `pnpm nx run <project>:test`: CI runs each
   project's own target, the pre-push gate does not.

The full gate (`pnpm ci:check`: lint, typecheck, unit, integration, e2e, gates) runs once, on
`git push`. Do not run it by hand after each round of fixes. If you do run it in the background,
close its input (`< /dev/null`) or it waits forever. Read the push result from a file and look for
`[ci:check] FAILED`; `; echo $?` and `| tail` both report success for a failed push. A long gate
can drop the SSH connection: push with a keep-alive
(`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30"`) and confirm with `git ls-remote`.

After a rebase onto a `main` that changed the same area, run the touched integration specs again
before pushing: fixtures written before the rebase may no longer match the schema or the queries.

## Manual acceptance handoff

When the user will check the work by hand, they do the checks, not the setup.

- Prepare small, clearly named fixtures while building, added to the dev database in seconds with
  additive, repeatable writes. Only what the review needs.
- Reuse the running apps. No rebuild, full reset or separate environment for the handoff.
- Verify the fixtures and the logins yourself. In a temporary file, under **Manual acceptance**,
  list the URL, the logins and roles, the records with ids or direct links, and numbered steps
  with the exact expected result of each.
- Report what was verified automatically, what you drove in the browser, and what is left for the
  user.
- Keep one-time scripts and review files out of the feature commit and remove them after the
  review. Keep the regression tests. Delete database fixtures only when asked.
- Writes to a production database need explicit approval each time.

## Working with subagents

The split of work between models is rule `[MDLSP]` (`docs/references/hard-rules-reference.md`).
These are the pace rules that go with it.

- **Prove the instance is usable before sending an agent to it**: the gateway answers 200, the
  dev database has this branch's tables, the e2e stack has every service. A blocked agent costs
  its whole start-up.
- **One builder at a time per checkout.** Research, or a browser pass, may run beside it.
- **Every brief is self-contained**: the checkout and its ports, the files, the rules, the tests
  required, what not to do (commit, push, Tilt and database commands, migrations), where to save
  output, and what to report.
- **A browser pass by a subagent** must be briefed in words: one login per portal, reuse the page,
  never close the context between steps. If it tests badly, stop it, take a handover (done, left,
  test data created) and do the pass in the main session.
- **Resume before you spawn** for a small follow-up, while the agent is below about 400,000
  tokens. Above that, ask it for a short handover (state of the tree, decisions, what is left) and
  give the next task to a fresh agent with that handover as its brief.
- **Review before you repeat a claim**: read the diff, re-run the touched specs, and do the
  browser pass. A builder's "all tests pass" was true and the feature still looked broken in the
  browser twice in one week, once from a stale gateway and once from a real defect.
- **Security-sensitive parts of a delegated change** (tenant checks, abilities, password and
  session handling) are specified exactly in the brief and read line by line in review; every
  finding goes to the Security Findings Log.
- Never do for a subagent an action it was denied permission for. Tell the user.
