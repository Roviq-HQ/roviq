---
name: testing-integration
description: Use when writing, modifying, or reviewing integration tests (*.integration.spec.ts) — NestJS booted in process against real PostgreSQL with RLS: app boot, tokens, fixtures, cross-institute and ability refusals, events, and what must be covered per operation
---

# Integration tests

A NestJS module booted **in process** with `Test.createTestingModule()` against the **real test database** (`roviq_test`, all roles and RLS in force), driven through GraphQL over supertest. This is the layer that proves queries, RLS, scope guards, `@CheckAbility` and tenant isolation. Shared conventions and commands: `testing-unit` skill.

Copy the shape of a current spec instead of writing from memory: `apps/api-gateway/src/institute/student/__tests__/student-placement-correction.integration.spec.ts`.

## Boot, token, request

```typescript
import {
  createInstituteToken, createIntegrationApp, createTestInstitute, createTestTeacher,
  cleanupTestTeacher, gqlRequest, type IntegrationAppResult, type TestInstitute,
} from '@roviq/testing/integration';
import { AppModule } from '../../../app/app.module';

let result: IntegrationAppResult;
beforeAll(async () => { result = await createIntegrationApp({ modules: [AppModule] }); });
afterAll(async () => { await result?.close(); });

const inst = await createTestInstitute(result.db);            // fresh institute with its admin
const token = createInstituteToken({
  sub: inst.userId, tenantId: inst.tenantId, membershipId: inst.membershipId, roleId: inst.roleId,
});
const res = await gqlRequest<{ enrollStudent: string }>(result.httpServer, {
  query: ENROLL, variables: { input }, token,
});
expect(res.errors?.[0]?.extensions?.code).toBe('STUDENT_NOT_FOUND');
```

- The database is prepared for you: the project's global setup creates `roviq_test` if missing and applies pending migrations; when rows left by earlier runs refuse a new migration, it rebuilds the database once. No reset command is needed, and none may be run from a test.
- Redis is an in-memory stand-in, NATS and Temporal are mocked. `createIntegrationAppWithNats` boots against real NATS; use it only for a test that needs a consumer to run (the audit pipeline).
- Other scopes: `createPlatformToken`, `createResellerToken`, `createTestReseller`. A role with fewer abilities: `createTestTeacher(result.db, tenantId)`, cleaned with `cleanupTestTeacher`.
- An emitted event is asserted by spying on the bus: `vi.spyOn(result.app.get(EventBusService), 'emit')`. A consumer is tested by getting the handler from the app and calling it with the payload.

## Fixtures

- Create your own institute per `describe` with `createTestInstitute`; never insert into, or change, seeded rows. Ids come from the database (`uuidv7()`) or `randomUUID()`, never typed in.
- Rows the factories do not cover are inserted with `withAdmin(result.db, mkAdminCtx('test:<spec-name>'), …)`. That needs the spec's path in `SYNTHETIC_CONTEXT_ALLOWLIST` (`scripts/check-synthetic-context-usage.ts`).
- Insert what the code under test really reads. A student, staff member or guardian needs the institute's own profile copy (`tenant_user_profiles`) as well as the account profile, or the lists return nothing. An academic year's label must match `YYYY-YY`. When a fixture breaks a CHECK or a foreign key, fix the fixture; the constraint is right.
- Tests in one file share the database: do not borrow "any" row with `LIMIT 1`, and do not assume a table is empty. A test that changes a shared fixture runs after the tests that read it, or creates its own.
- No `TRUNCATE`, no `DELETE` of rows you did not create.
- A test that must remove or change a seeded row (to prove the seed repairs it) does so in a transaction it rolls back, and seeds inside that transaction before the change (`seed/__tests__/idempotency.integration.spec.ts`).
- A spec that creates the platform's messaging sender, also in a transaction it rolls back, holds `holdPlatformSenderLock` from `beforeAll` to `afterAll`: only one live platform sender may exist.

## What every new or changed operation needs

1. **The normal case** through the real database, asserting the stored rows, not only the response.
2. **Another institute's id is refused** for every id the operation takes (and another reseller's, in reseller scope), with the entity's not-found code, and **nothing is written in either institute**: compare the rows before and after. Use a real row of a second institute, not a random UUID, and test each id of the operation on its own. Send the request with `foreignIdRequests()` from `apps/api-gateway/src/__tests__/foreign-id-requests.ts` (built once per spec with the other institute's ids and `specFile: __filename`), not with `gqlRequest`: it sends the request again with an id of no row and fails unless both answers are the same, so the operation cannot tell a caller that a row exists elsewhere. A request with none of the foreign ids goes through unchanged, so the same function serves the whole spec; give `callerTokens` when the other institute also acts in the spec. Then list the operation in `apps/api-gateway/src/__tests__/foreign-id-coverage.ts` with this spec: `foreign-id-coverage.spec.ts` fails for an institute- or reseller-scope operation that takes an id and has no entry.
3. **A role without the ability is refused** (`FORBIDDEN`). For an operation declared `rows: 'scoped'`: a role with a conditional rule is allowed a row inside its condition and refused one outside it, and the operation is listed in `row-scope-coverage.ts` with this spec. A new `@CheckAbility` pair must also pass `ability-coverage.spec.ts`.
4. **Wrong scope is refused** for a new resolver class: a reseller or platform token on an institute resolver, and the reverse.
5. **Each business refusal** with its `ErrorCode`, and no event emitted on a refusal.
6. **Ids that disagree with each other** (a class of another year, a section of another class).
7. A database-enforced rule (GRANT, RLS, CHECK, trigger) is tested by attempting the forbidden write as that role and expecting the refusal.

Prove a new test can fail: break the code once, or write the test before the fix and see it fail for the right reason.

## Not here

- A mocked database (`pnpm test:check-integration` fails the gate), `vi.useFakeTimers()`, pure logic that a unit test covers.
- Asserting a secret's absence only in the response: also read the rows that could hold it (`audit_logs`, `notifications`, `notification_deliveries`).
- After a rebase onto a `main` that changed the same area, run the spec again: fixtures written before the rebase may no longer match.
