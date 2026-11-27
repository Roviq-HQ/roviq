---
name: backend-service
description: Use when working on any backend service, resolver, repository, or module in apps/api-gateway — covers scope-to-DB-wrapper mapping, service layer rules, status transitions as domain mutations, schema patterns, event naming, and service ownership boundaries
---

# Backend services (api-gateway, notification-service)

Words: **institute** (never "school" or "organization"), **tenant** for the infra side, **standard** (a class level), **section** (a division of a standard), **department** (an education level).

## Scope, guard and database wrapper

| Scope | Class-level guard | Wrapper | Context in a resolver |
|---|---|---|---|
| Institute | `@InstituteScope()` | `withTenant(db, ctx, fn)` | `assertTenantContext(user)` |
| Reseller | `@ResellerScope()` | `withReseller(db, ctx, fn)` | `assertResellerContext(user)` |
| Platform | `@PlatformScope()` | `withAdmin(db, ctx, fn)` | `assertPlatformContext(user)` |
| Institute with a reseller (EE billing) | `@InstituteScope()` | `withTenant`, read `ctx.resellerId` | `assertInstituteWithReseller(user)` |

- Guards go on the class, never `APP_GUARD`. Use the assert helpers, never an inline `ForbiddenException`.
- Platform operations live in `admin/` resolvers. Wrapper and context details, synthetic contexts and their allowlists: `drizzle-database` skill.
- Tenant and user ids come from the request context (`getRequestContext()`), not from a parameter passed down the call chain, and never from the client.

## Tenant isolation is your job on every operation

A scope guard proves who the caller is, not which rows are theirs.

- **Look up every id the caller sends under the caller's own context first** (the `*Live` view inside `withTenant` / `withReseller`). A missing row answers that entity's not-found code. RLS makes another institute's row "missing", but only for rows you actually read: foreign keys accept any id.
- **Check the ids agree with each other** (the class belongs to the year, the section to the class) before writing.
- **Never pass a caller-supplied id to admin-context code** (`withAdmin`, `IdentityService` methods that use it). Pass only an id read from the caller's own row, and add the reached method to `ADMIN_METHOD_ALLOWLIST` with the reason.
- **A rule with a row condition must be applied to the row.** When a role holds the pair only with a condition (own leaves, linked children, assigned sections), the operation applies it (a `caslToSqlWhere` predicate in the query, or `ability.can(action, subject(type, row))` on the loaded row) and declares `@CheckAbility({ action, subject, rows: 'scoped' })`. Without the declaration `AbilityGuard` refuses that role. Every declared operation is listed in `apps/api-gateway/src/__tests__/row-scope-coverage.ts` with the spec that proves a row outside the condition is refused (`row-scope-coverage.spec.ts`).
- **Authorize with `@CheckAbility({ action, subject })`** or `ability.can()`, never a role name. A new pair must be reachable by a role and every grant used (`ability-coverage.spec.ts`).
- Do the checks and the write in **one transaction** where a check guards the write.
- Every new or changed operation that takes an id gets an integration test where another institute's id is refused and nothing is written, and an entry in `apps/api-gateway/src/__tests__/foreign-id-coverage.ts` (the unit suite fails without it). A finding goes to the "Security Findings Log".

## Resolvers, services, repositories

- Code-first GraphQL only (`@ObjectType`, `@InputType`, `@Resolver`); no `.graphql` schema files. Resolvers are thin: validate input through the DTO, call one service method, return.
- **Services never touch the database.** A `*.service.ts` file imports no `DRIZZLE_DB`, wrapper (`withTenant` / `withAdmin` / `withReseller`), `mk*Ctx`, table, `*Live` view or `drizzle-orm` operator; `pnpm check:service-db-access` fails otherwise (types and a few pure helpers are allowed). The service holds the rules: validation, state transitions, error codes, events, calls to other services.
- **Every query lives in a repository**, in the feature's `repositories/` folder: `<name>.repository.ts` (abstract class the service injects), `<name>.drizzle-repository.ts` (the implementation with `@Inject(DRIZZLE_DB)`), `types.ts` (record and input types) and `<name>-repository.module.ts`. Model: `apps/api-gateway/src/institute/leave/`.
- **One repository method per unit of work.** Statements that must commit together run in one method and one transaction. When a rule decides between two statements, the method returns a small typed result (`{ kind: 'not_found' } | { kind: 'ok', row }`) and the service turns it into the `BusinessException`; the repository does not decide business meaning.
- Unit-test a service against a mocked repository (`createMock<Repository>()`); test the repository's SQL in an integration spec. Never mock the Drizzle transaction.
- GraphQL returns `i18nText` fields as the whole object; never resolve a locale on the backend.
- Give `@Field`, `@InputType` and mutations a `description` when the name does not say it all: rules, formats, units (paise, epoch ms), limits. It is the API's only documentation.
- Lists: cursor pagination, one query per page for any per-row extra (no N+1), sort columns from a whitelist.
- Files: store `files.id`, return `FileRef`, attach with `FileService.verifyUploads` and `markFilesReady(tx, …)`. Never a URL column or a raw S3 call.
- Config through `ConfigService` (never `process.env`); a new variable goes in `.env.example`, the app's env validation, and `docs/deployment.md` when production needs it.
- Redis keys from the `REDIS_KEYS` constants.

## Errors

- `throw new BusinessException(ErrorCode.X, 'message')`. Codes and their HTTP status live in `libs/shared/common-types/src/lib/error-codes.ts`; add a new code there with a one-line comment.
- The web app shows translated copy by `extensions.code`, never the message: a new code needs copy in `apps/web/messages/{en,hi}/error.json` (or the feature's namespace).
- Refuse before writing, in a fixed order, and never spend a rate-limit slot or emit an event on a refused request.

## Status changes

Each transition is a named method (`activate`, `suspend`, `approve`, `archive`), never a generic `updateStatus`. Validate with the domain state machine (`defineStateMachine` from `@roviq/common-types`: `MACHINE.assertTransition(current, next)`, which throws `INVALID_STATE_TRANSITION`), then run context checks, update, emit.

Deleting and deactivating are different operations. Delete is `softDelete()` (the resolver is `await this.service.delete(id); return true;`). Trash listings read the base table and need `restore` ability; restore with `restoreDeleted`.

## Enums

One source in `@roviq/common-types` (`X_VALUES` tuple, type, and value object), imported by the database (`pgEnum`), the gateway (`@IsEnum`, `registerEnumType`) and the web app. UPPER_SNAKE values, a comment on every value. Never retype the strings in a DTO or a select.

## Events

- Emit with `EventBusService` from `@roviq/event-bus`: `eventBus.emit(EVENT_PATTERNS.STUDENT.enrolled, payload)`. Never `natsClient.emit` (`pnpm check:direct-nats-emit`).
- A new subject: add it to `EVENT_PATTERNS` and its Zod schema to `event-schemas.ts` (`libs/backend/nats-jetstream/src/streams/`); its prefix must have a stream. Name it `ENTITY.action`, snake_case for new actions. Always include `tenantId`.
- Emit **after** the transaction commits, and do not await it.
- The payload is also published to the in-process GraphQL pubsub. Never put a secret in a payload that a subscription could select.
- A consumer is a class with `@EventPattern(EVENT_PATTERNS.X.y, gatewayConsumer(pattern))` listed in a module's **`controllers`**; the app's `main.ts` calls `connectJetStreamMicroservice()`. Parse the payload with `eventPayloadSchemas[pattern].parse(data)`. Handlers must be safe to run twice: delivery is at least once. Streams are work queues: one durable per subject, shared by all handlers of that subject. (`pnpm check:event-handlers`, `docs/guides/events.md`.)

## Who owns which tables

Users, memberships, roles, profiles, refresh tokens and auth providers belong to the identity code (`apps/api-gateway/src/auth/`, `IdentityService`). Institute modules create or change them only through `IdentityService`, never with their own queries. Passwords: only `IdentityService` hashes or reissues one, and a temporary password is handed straight to `sendWelcomeNotification`, never returned, logged or stored.

## Tests

Every new operation: integration spec for the normal case, another institute's id, a role without the ability, each refusal code (`testing-integration` skill). Unit specs for pure rules.
