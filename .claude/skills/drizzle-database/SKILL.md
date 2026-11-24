---
name: drizzle-database
description: Use when working with database schema, Drizzle ORM, migrations, RLS policies, tenant isolation queries, withTenant/withAdmin wrappers, soft-delete via *_live views, or any code in libs/database — covers Drizzle v1 beta conventions, column helpers, soft delete, status enums, and migration commands
---

# Database

PostgreSQL 18 with row-level security, Drizzle ORM **v1 beta** (`drizzle-orm@beta`, `drizzle-kit@beta`). Stable v0.x APIs and examples do not apply; check the installed version's docs (Context7) before using an API you have not seen in this repo.

## Roles and wrappers

| Role | Used for |
|---|---|
| `roviq` | Superuser. Migrations only (`DATABASE_URL_MIGRATE`) |
| `roviq_pooler` | The login role of the apps (`DATABASE_URL`). `NOINHERIT`: it can do nothing until a wrapper switches role |
| `roviq_app` | Institute scope. RLS filters on `app.current_tenant_id` |
| `roviq_reseller` | Reseller scope. RLS filters on `app.current_reseller_id` |
| `roviq_admin` | Platform scope. Policies are `USING (true)`: it sees every tenant |

No runtime role has `BYPASSRLS`. Every query runs inside one wrapper, which opens a transaction and does `SET LOCAL ROLE` plus the context variable:

```typescript
withTenant(db, ctx: InstituteContext, async (tx) => { … })
withReseller(db, ctx: ResellerContext, async (tx) => { … })
withAdmin(db, ctx: PlatformContext, async (tx) => { … })
```

- The context is **branded**: the wrong context for a wrapper is a compile error. Resolvers narrow `req.user` with `assertTenantContext` / `assertResellerContext` / `assertPlatformContext` / `assertInstituteWithReseller` from `@roviq/auth-backend`.
- Code with no JWT (workflow activities, seeders, event consumers, integration fixtures) builds one with `mkInstituteCtx(tenantId, origin)`, `mkResellerCtx(resellerId, origin)`, `mkAdminCtx(origin)`. These skip the JWT, so every importing file must be on the allowlist of `pnpm check:synthetic-context-usage`, with a reason.
- `withAdmin` reads and writes every tenant. Institute or reseller code never hands it a caller-supplied id without first proving, under the caller's own context, that the row is theirs (`pnpm check:admin-context-reach`).
- Never `db.transaction`, `$transaction` or a bare `db.select` outside a wrapper.

## What RLS does not do for you

- **Foreign keys do not apply RLS**, and `WITH CHECK` sees only the new row's `tenant_id`. A row can therefore point at another institute's student, year or class. Before storing a caller-supplied id, read it through its `*Live` view inside the caller's `withTenant`, and check that related ids agree (the class belongs to the year, the section to the class).
- A rule that must hold on every code path belongs in the database too: GRANT, RLS policy, CHECK or trigger. Test it by attempting the forbidden write as the role.
- `.enableRLS()` only does `ENABLE`. `FORCE ROW LEVEL SECURITY` is applied in custom SQL.
- Hard `DELETE` is blocked for `roviq_app` (`USING (false)`): it silently removes nothing.

## Tables

- Tenant-scoped table: spread `...tenantColumns` (tenant id, timestamps, `created_by` / `updated_by`, soft delete, `version`), an index starting with `tenant_id`, and `...tenantPolicies('table_name')`. Never write policy SQL inline.
- Any other mutable table: `...entityColumns` and `entityPolicies(...)`.
- Exempt from audit and soft-delete columns: append-only records (`audit_logs`, `auth_events`, `dlq_messages`, `consent_records`, `impersonation_sessions`, `notification_deliveries`), counters, and EE financial records (status only, never deleted).
- Every `pgTable` opts into RLS (`pnpm check:rls-coverage`); the exempt list is empty and an addition needs a security review.
- `created_by` / `updated_by` are NOT NULL with no default on purpose: pass the acting user's id, or `SYSTEM_USER_ID` for unattended work.
- Ids: ``.default(sql`uuidv7()`)``. Never `serial()`, `.defaultRandom()` or `gen_random_uuid()`.
- Tenant-authored names: `i18nText('name')` (jsonb `{ en, hi }`). Not for emails, usernames, codes or enums.
- Status is a domain `pgEnum` from `@roviq/common-types` (UPPER_SNAKE), never `isActive: boolean()`. Status and deletion are different things.
- Schema files live in `libs/database/src/schema/` by domain; the barrel re-exports every table; relations are in `schema/relations.ts` with `defineRelations()`.

## Soft delete and `*Live` views

- Every soft-deletable table has a `<table>Live` view (`security_invoker`, so RLS runs as the caller). **Read from the view, write to the base table.** `INSERT/UPDATE … RETURNING` target the base table.
- Delete with `softDelete(tx, table, id)`; a bulk one is an `UPDATE … SET deleted_at, deleted_by, updated_by … WHERE deleted_at IS NULL`. Restore with `restoreDeleted(tx, table, id)`. Never `db.delete()`.
- A read of the base table is allowed only for trash listings or where deleted rows must count (for example "was this student ever placed in this year"), and carries `// allow-base-read: <reason>`.
- Unique indexes are partial (`WHERE deleted_at IS NULL`) so a deleted row releases its key. An upsert on one needs the predicate too: `.onConflictDoNothing({ target: […], where: sql\`deleted_at IS NULL\` })`. Global on purpose: `users.email`, `users.username`, `resellers.slug`.
- Gates: `pnpm check:live-views` (no base-table reads in app code) and `pnpm check:live-views-coverage` (every soft-deletable table has its view).

## Queries

- `db.query.*` is the relational API (`with:` for relations). `tx.select().from()` is the SQL-like API (joins, aggregates). `with:` does not exist on `select()`. Never `db._query`.
- `drizzle({ schema, relations })`, and `DrizzleDB` is `NodePgDatabase<typeof schema, typeof relations>`.
- Zod from tables: `drizzle-orm/zod`, not `drizzle-zod`.
- **A raw `sql\`\`` fragment inside a single-table `select` loses table names**: `${a.userId} = ${b.id}` renders as `"user_id" = "id"` and a correlated `EXISTS` then matches nothing (ROV-315). Use a join, a second statement with `inArray`, or the query builder's `exists(...)` with aliased tables, and cover it with an integration test.
- A self-join or a correlated subquery over the same view needs `alias(view, 'name')`.
- One statement per `tx.execute()`: PostgreSQL rejects several commands in a prepared statement.
- Optimistic concurrency: `WHERE version = expected` and `version = version + 1`.

## Changing the schema

- Every database (dev, e2e, integration tests, staging, production) is built only by `drizzle-kit migrate` from `libs/database/migrations/`. A schema edit reaches no database until its migration exists: generate it, and Tilt's `db-push` resource applies it to this instance's database. `pnpm tilt trigger db-clean` rebuilds and re-seeds it. Never run `drizzle-kit push` or `pnpm db:*` yourself.
- A change that must reach other environments is a migration in `libs/database/migrations/` (one folder per migration): `pnpm nx run database:db:generate` from the schema, or `drizzle-kit generate --custom --name=<name>` for hand-written SQL (functions, triggers, FORCE RLS, partitioned-table indexes). On a Fable session migrations are written by Fable, not by a subagent.
- **A migration that creates a table also enables and forces its row security and grants it to the app roles.** Nothing else does: `pnpm check:migrations` builds an empty database from the chain and fails on a table without FORCE RLS, and on a schema change no migration carries.
- `drizzle-kit` does not diff RLS policies, and a renamed policy makes `generate` ask questions: keep policy names stable.
- After a schema change: update `scripts/seed*.ts`, grep `scripts/`, `e2e/` and the specs for old column names, and run the integration specs of the area (the test database migrates itself at the start of a run).
- Time-partitioned tables: create partitions only through `ensure_monthly_partition(parent, month_start)`, wire the two places the pattern needs (create migration, boot maintainer), and keep their indexes in custom SQL. Details: `docs/infrastructure.md` → "Time-partitioned tables".

## CASL

Abilities are stored on roles and on `Membership`, combined per request. Check with `@CheckAbility({ action, subject })` or `ability.can()`; never compare role names. Every pair must be reachable by a role (`ability-coverage.spec.ts`).

## Tests

Queries, RLS and constraints are tested in integration specs against the real database (`testing-integration` skill). A unit test with a mocked transaction proves nothing about SQL.
