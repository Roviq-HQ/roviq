---
name: testing-unit
description: Use when writing, modifying, or reviewing unit tests (*.spec.ts) — which test type a file is, Vitest projects and commands, mocking with createMock, assertions, and the banned patterns shared by every test layer
---

# Tests: shared conventions and unit tests

Say "institute", never "school", in test names, fixtures and comments.

## Which test is it

| Suffix | Type | Vitest project | Runs against | Skill |
|---|---|---|---|---|
| `*.spec.ts` | Unit | `unit-node` | Memory only | this one |
| `*.spec.tsx` | Component | `unit-dom` | jsdom | `testing-frontend` |
| `*.integration.spec.ts` | Integration | `integration` | Real PostgreSQL with RLS, NestJS in process | `testing-integration` |
| `*.api-e2e.spec.ts` | E2E API | `e2e-api` | The running e2e stack | `testing-e2e` |
| `*.e2e.spec.ts` | E2E UI | Playwright | The running e2e stack and a browser | `testing-frontend` |

Unit, component and integration specs live in `__tests__/` beside the source. E2E API specs live in `e2e/api-gateway-e2e/src/`, E2E UI specs in `e2e/web-{admin,institute,reseller}-e2e/src/`.

Pick the lowest layer that can prove the behavior: pure logic in a unit test; anything that depends on SQL, RLS, guards or abilities in an integration test (a mocked database proves nothing about a query); a journey across services in E2E.

## Running

- One file while working: `pnpm vitest run --project <project> <path>` with the output redirected to a file, then grep the file. Never re-run to read another part.
- In a parallel instance prefix with `env -u NX_WORKSPACE_ROOT_PATH`.
- Whole layers: `pnpm test:unit`, `pnpm test:int`, `pnpm test:e2e:api`, `pnpm test:e2e:ui`. The full gate runs on `git push`; do not run it by hand.
- After deleting a library's last spec file run `pnpm nx run <project>:test`: CI runs each project's own target.

## Rules for every layer

- A failing strict assertion means the fixture or the code is wrong. Fix that. Never weaken to `expect.objectContaining`, `expect.any` or a partial match to get green.
- No `any`, `as unknown`, `as never`, non-null `!` (narrow with `assert(value)` from `node:assert`).
- No snapshot tests on data, no `console.log`, no fixed sleeps (poll with a bound, or use fake timers in unit tests).
- Seed names, ids and credentials come from `e2e/shared/seed-fixtures.ts` (`SEED`, `E2E_USERS`), never typed in.
- Do not test generated code, decorator wiring, a third-party library, or getters with no logic.
- A test name states the expected behavior: `it('should refuse a section of another class')`.
- When a test you did not write starts failing after your change, the change is the suspect, not the test.

## Unit tests

What belongs here: pure functions, value rules, Zod schemas, ability builders, mappers, date and money arithmetic, and a service's branch logic with its dependencies mocked.

Mock dependencies with `createMock<T>()` from `@roviq/testing` (the light entry; `@roviq/testing/integration` is the heavy one and must not be imported by a unit test):

```typescript
import { createMock } from '@roviq/testing';

const config = createMock<ConfigService>({ get: vi.fn((key) => values[key]) });
const service = new ResellerSettingsService(repository, config);
```

Working example: `apps/api-gateway/src/reseller/settings/__tests__/reseller-settings.service.spec.ts`.

- `restoreMocks: true` is set in the Vitest config: do not call `vi.clearAllMocks()` yourself.
- One behavior per `it`; arrange, act, assert.
- `toEqual` for objects, `toBe` for primitives, `rejects.toMatchObject({ code: ErrorCode.X })` for a `BusinessException`. Never `toBeTruthy()` where the value is known.
- Money is `bigint` paise: `500000n` is ₹5,000.
- Never `vi.mock()` the file under test or mock the function under test.

Some older service specs mock the Drizzle transaction with a queue of results (for example `student-academic.service.spec.ts`). They break whenever the order of queries changes. Do not write new ones: test the query in an integration spec, and when you must touch an old one, fix its fixture queue to match the new query order.

Not in a unit test: a database, NATS, Redis, Temporal, HTTP, `app.init()`.
