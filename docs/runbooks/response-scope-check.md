# A response was refused by the scope check

## Symptom

OpenObserve alert `api_foreign_scope_response` (page) is firing: the gauge
`api_foreign_scope_responses_recent` is above 0. You see it as an email, in the alert banner of
the admin Monitoring page, and in OpenObserve under **Alerts**. The caller of the operation saw
a generic error (`INTERNAL_ERROR`).

## What it means

The api-gateway checks every value a resolver returns for an institute- or reseller-scope query
or mutation before the response is sent (`docs/architecture.md` → "Response scope check"). The
gauge's `reason` label says which check failed:

- **`foreign_id`**: a value carried a `tenantId` that is not the caller's institute, or a
  `resellerId` that is not the caller's reseller.
- **`too_large`**: one value held more than 1,000,000 objects, so it could not be read to the
  end and was treated as failed.

With `RESPONSE_SCOPE_CHECK=refuse` (the default) the whole response was replaced by an error.
With `report` it was sent and only this alert tells you.

A `foreign_id` is one of two things:

1. **A fault in the operation**: a query or a field resolver that reads rows without the
   caller's context, or a loader that joins to another institute's row. This is a security
   finding.
2. **A foreign id the caller is entitled to see** that nobody listed. Rare: an institute caller
   sees only its own institute.

A `too_large` is a query that returns far more than any page should: a missing limit, or a
relation loaded for every row.

## What to do

1. Find the event. In the admin Monitoring page open **Logs**, service `api-gateway`, and search
   for `the caller's scope`. The entry names the `operation`,
   the `field` whose value failed (`Type.field`), the caller's `scope`, the `reason`, and for a
   foreign id its `kind` with the `expected` and `found` ids. It holds no row data.
2. Read that field's resolver, service and repository. Decide which case it is.
3. **A fault:** record it in the private document "Security Findings Log" before anything else,
   then fix the operation with a test that sends another institute's id. A refused mutation has
   already written, and its audit entry says it succeeded: check what it wrote. With `report`
   mode, earlier responses were sent: check the audit log for the same operation and caller.
4. **An entitled id:** add the root operation to `FOREIGN_SCOPE_ALLOWED`
   (`apps/api-gateway/src/common/response-scope/response-scope.allowlist.ts`) with the reason.
   The entry switches the check off for that operation and the fields under it, so it needs a
   security review.
5. **Too large:** give the query a limit or a page. Do not raise `MAX_SCAN_NODES` to make room.
6. If the refusals block real work while the fix is made, set `RESPONSE_SCOPE_CHECK=report` on
   every api-gateway and restart them. Set it back afterwards.

## When it ends

The gauge counts the last 15 minutes, per gateway process, so the alert clears 15 minutes after
the last refused result. A restart of the gateway also resets it.
