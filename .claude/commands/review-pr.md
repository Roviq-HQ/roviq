Review the following pull request.

$ARGUMENTS

## Focus areas

1. **Code Quality** — Clean code, error handling, edge cases, readability
2. **Security** — Injection vulnerabilities, input sanitization, auth/authz, secrets exposure
3. **Performance** — N+1 queries, unnecessary computation, memory leaks
4. **Testing** — Adequate coverage, edge cases, test quality
5. **Project conventions** — Check CLAUDE.md for coding standards
6. **Documentation** — Read `docs/README.md` (the index and "Writing docs"). A change to behaviour, a command, a variable, an operation or a screen must update the document that owns it in the same PR: `docs/features/` for a product area, `docs/user-guides/` for what an end user sees, `docs/deployment.md` for anything production needs. Bug fixes that restore documented behaviour, internal refactors, test-only changes and dependency bumps need none. If the PR changes behaviour and touches no document, flag REQUEST_CHANGES and name the documents that need the update. Also flag a document that adds history, a plan or a known-gap list, or copies a fact that already has a home.

## Guidelines

- Be concise. No filler praise.
- Use inline review comments for specific issues.
- If the PR is clean, approve with a one-line summary.
- Flag blocking issues as REQUEST_CHANGES. Use COMMENT for suggestions.
- Missing documentation for user-facing changes is a blocking issue (REQUEST_CHANGES).
- Group related issues.