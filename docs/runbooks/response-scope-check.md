# A response was refused by the scope check

## Symptom

OpenObserve alert `api_foreign_scope_response` (page) is firing: the gauge
`api_foreign_scope_responses_recent` is above 0. You see it as an email, in the alert banner of
the admin Monitoring page, and in OpenObserve under **Alerts**. The caller of the operation saw
a generic error (`INTERNAL_ERROR`).

## What it means

The api-gateway checks every result of an institute- or reseller-scope query or mutation before
it is sent (`docs/architecture.md` → "Response scope check"). A result carried a `tenantId`
that is not the caller's institute, or a `resellerId` that is not the caller's reseller. With
`RESPONSE_SCOPE_CHECK=refuse` (the default) the result was not sent. With `report` it was sent
and only this alert tells you.

It is one of two things:

1. **A fault in the operation**: a query that reads rows without the caller's context, or a
   field that joins to another institute's row. This is a security finding.
2. **A foreign id the caller is entitled to see** that nobody listed. Rare: an institute caller
   sees only its own institute.

## What to do

1. Find the event. In the admin Monitoring page open **Logs**, service `api-gateway`, and search
   for `outside the caller's scope`. The entry names the `operation`, the `scope` of the caller,
   the `kind` of id (`tenantId` or `resellerId`), and the `expected` and `found` ids. It holds no
   row data.
2. Read the operation's resolver, service and repository. Decide which of the two cases it is.
3. **A fault:** record it in the private document "Security Findings Log" before anything else,
   then fix the operation with a test that sends another institute's id. Check the audit log for
   the same operation and caller: with `report` mode, earlier results were sent.
4. **An entitled id:** add the operation to `FOREIGN_SCOPE_ALLOWED`
   (`apps/api-gateway/src/common/response-scope/response-scope.allowlist.ts`) with the reason.
   The entry switches the check off for that operation, so it needs a security review.
5. If the refusals block real work while the fix is made, set `RESPONSE_SCOPE_CHECK=report` on
   every api-gateway and restart them. Set it back afterwards.

## When it ends

The gauge counts the last 15 minutes, per gateway process, so the alert clears 15 minutes after
the last refused result. A restart of the gateway also resets it.
