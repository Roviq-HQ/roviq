---
name: fix-bug
description: Use when fixing a bug, investigating a test failure, or diagnosing unexpected behavior — a reproduce, locate, fix, verify order of work
---

# Fixing a bug

1. **Reproduce it.** Run the failing test or trigger the behavior, and save the output. If the running app contradicts the code or a passing test, first rule out a stale dev gateway (`docs/infrastructure.md` → "When the dev app looks wrong").
2. **Find the cause, not the place.** Read the surrounding code, the recent history of the file (`git log -p -- <file>`), and follow the data. For a library or framework error, look it up (web search and Context7) before guessing.
3. **Write the failing test first** when the bug can be shown in a test, and watch it fail for the right reason.
4. **Fix the cause** with the smallest change that is a proper fix. No workaround, no nearby clean-up. If the proper fix is large, say so and propose it.
5. **Verify**: the new test passes, the spec files around the change pass, `pnpm lint:fix` is clean, and the flow works in the browser.
6. **Commit it on its own**, apart from any feature work. A fix to test tooling also gets an entry in `docs/changelogs/testing-troubleshooting.md`; a security bug gets an entry in the Linear "Security Findings Log", and its commit, branch and pull request say what changes, never what was wrong ([SECPV]).
7. **Report** the cause, the fix and the test in three lines.
