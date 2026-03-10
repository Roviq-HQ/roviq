# Audit Logging — Remaining Gaps

**Status:** Phase 1 (Core Infrastructure) and Phase 2 (Query API) are complete.
This document tracks the gaps identified when comparing the PRD against the current implementation.

---

## Gap 1: `changes` field is always null (diff computation not implemented)

**PRD requirement:** The `changes` JSONB column should capture before/after diffs for mutations.
**Current state:** The interceptor does not compute diffs. It sets `changes: undefined`, so audit rows always have `changes = NULL`.
**What's needed:**
- Fetch the entity state before the mutation (pre-snapshot)
- After the mutation succeeds, diff the pre-snapshot against the return value
- Populate the `changes` field with `{ field: { old, new } }` structure
- Wire `@AuditMask('password', 'secret')` decorator into the interceptor to redact sensitive fields before storing the diff

**Complexity:** Medium — requires a pre-read strategy (extra DB query per mutation) and a generic diff utility.

---

## Gap 2: Impersonation fields not populated

**PRD requirement:** `impersonator_id` should be set when an admin acts on behalf of a user.
**Current state:** `impersonatorId` is always `undefined` because the auth system doesn't yet expose impersonation context.
**What's needed:**
- Implement impersonation in auth (JWT carries `impersonatorId` when active)
- Pass `impersonatorId` from `AuthUser` into the audit event in the interceptor

**Complexity:** Low (once impersonation auth exists) — just wire the field through.

---

## Gap 3: Integration tests for audit pipeline

**PRD requirement:** Section 7 specifies test coverage for the full pipeline.
**Current state:** `apps/api-gateway/src/audit/__tests__/` directory is empty. Unit tests exist for `@roviq/nats-utils` (streams) and `@roviq/audit` (emitter), but no integration test covers the end-to-end flow: mutation → interceptor → NATS → consumer → DB insert.
**What's needed:**
- Integration test: fire a mutation, assert an audit row appears in the DB
- Integration test: verify RLS scoping (tenant A can't read tenant B's logs)
- Integration test: verify cursor pagination returns correct pages
- Unit tests for `AuditService.findAuditLogs` (filter combinations, cursor decode)

**Complexity:** Medium — requires a test harness with NATS and Postgres.

---

## Gap 4: `@AuditMask()` decorator not wired into interceptor

**PRD requirement:** Sensitive fields should be redacted from audit log payloads.
**Current state:** The `@AuditMask()` decorator exists in `@roviq/audit` but the interceptor doesn't read it. Even when diff computation is added (Gap 1), masked fields won't be redacted until this is wired.
**What's needed:**
- In `AuditInterceptor.intercept()`, read `@AuditMask()` metadata via `Reflector`
- Before emitting the audit event, strip/redact the listed fields from `changes` and `metadata`

**Complexity:** Low — decorator and reflector pattern already in place.

---

## Gap 5: Admin Portal UI (Phase 3)

**PRD reference:** Phase 3 — Admin Portal audit log viewer.
**What's needed:**
- Audit log list page with filters (entity type, user, date range, action type)
- Cursor-based infinite scroll or "load more" pagination
- Detail drawer/modal showing full audit log entry with JSON diff viewer
- Export functionality (CSV/JSON)
- CASL-gated route and menu item

**Complexity:** High — full feature page with multiple components.

---

## Gap 6: Institute Portal UI (Phase 4)

**PRD reference:** Phase 4 — Institute Portal audit log viewer (scoped to institute).
**What's needed:**
- Similar to Admin Portal UI but scoped to the current institute's tenant
- Simplified filter set (no cross-tenant options)
- Same pagination and detail view patterns

**Complexity:** Medium — mirrors Admin Portal with reduced scope.

---

## Gap 7: Operational Maturity (Phase 5)

**PRD reference:** Phase 5 — Post-launch operational features.
**What's needed:**
- Retention policy: automated cleanup of audit logs older than N days
- Archival: move old logs to cold storage (S3/MinIO) before deletion
- Monitoring: alerts for audit write failures, consumer lag, disk usage
- Performance: query optimization, partitioning by `created_at` if table grows large

**Complexity:** High — infrastructure and ops work.
