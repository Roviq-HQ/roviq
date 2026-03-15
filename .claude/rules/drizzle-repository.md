---
paths:
  - "apps/**/*repository.ts"
  - "apps/**/*repository.test.ts"
  - "ee/apps/**/*repository.ts"
  - "ee/apps/**/*repository.test.ts"
  - "libs/database/**"
  - "ee/libs/database/**"
---

## Database: Drizzle ORM v1 beta

### Version
- drizzle-orm@beta, drizzle-kit@beta
- NEVER use stable v0.x APIs — we are on v1 beta track

### Critical rules
- ALWAYS `strict: true` in drizzle.config.ts
- NEVER use `drizzle-kit push` on any shared database
- NEVER use `serial()` — use `integer().primaryKey().generatedAlwaysAsIdentity()`
- NEVER use old `relations()` — use `defineRelations()` (RQBv2)
- NEVER pass `{ schema }` to drizzle() — pass `{ schema, relations }`
- NEVER import from `drizzle-zod` — use `drizzle-orm/zod`
- NEVER use `$onUpdate()` — use `$onUpdateFn(() => new Date())` (the callback version)

### Two query APIs — never mix them
- Relational data (nested includes): `db.query.tableName.findMany({ with: {...} })`
- SQL queries (joins, aggregations): `db.select().from(table).where()`
- The `with:` option does NOT exist on `db.select()` — that's a compile error
- Complex JOINs do NOT work in `db.query` — use `db.select()` with `.innerJoin()`

### RLS & multi-tenancy
- Single Drizzle instance (DRIZZLE_DB), not separate admin/tenant instances
- Tenant queries: wrap in `withTenant(db, tenantId, async (tx) => {...})`
- Admin queries: wrap in `withAdmin(db, async (tx) => {...})`
- The `withTenant` sets `app.current_tenant_id` via SET LOCAL inside a transaction
- The `withAdmin` sets `ROLE roviq_admin` via SET LOCAL inside a transaction
- RLS policies are defined in schema via pgPolicy() — they auto-generate in migrations
- Admin bypass is policy-based (roviq_admin role has `USING (true)` policies)

### Schema patterns
- All schema files in libs/database/src/schema/ organized by domain
- Use reusable helpers from common/columns.ts (timestamps, tenantColumns)
- Cross-file references use lazy evaluation: `.references(() => otherTable.id)`
- Barrel export in schema/index.ts must re-export ALL tables
- Relations in a single relations.ts using defineRelations()
- NEVER define RLS policies inline — use helpers from rls-policies.ts (tenantIsolation, adminFullAccess)

### Migration commands
- Generate: `nx run database:db:generate`
- Apply: `nx run database:db:migrate`
- Check conflicts: `nx run database:db:check`
- Custom migration: `drizzle-kit generate --custom --name=description`

### Testing
- Unit tests: mock DRIZZLE_DB provider with jest/vitest mocks
- Integration tests: use PGlite for speed, Testcontainers for RLS testing
- The abstract repository pattern means most tests don't touch Drizzle directly