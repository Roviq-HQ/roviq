# Agent Workflow

## Implementation Self-Check

Run through this while coding:
- [ ] `TenantPrismaClient` for tenant-scoped data, not raw `PrismaClient`?
- [ ] `adminPrisma` only for platform-level entities (User, auth)?
- [ ] `tenantTransaction`, not `$transaction`?
- [ ] New tenant-scoped model has `tenantId` + `@@index` + `@@map` + RLS migration?
- [ ] CASL checks, not role string comparisons?
- [ ] `publish()` from `@roviq/nats-utils`, not raw `js.publish()`?
- [ ] Zero occurrences of "school"?
- [ ] Schema changed? → `scripts/seed.ts`, `e2e/`, test files updated?
- [ ] Only exporting what's externally needed?
- [ ] All user-facing strings use `useTranslations()`, not hardcoded?
- [ ] New feature has translation namespace in `messages/{locale}/`?
- [ ] `ConfigService`, not `process.env` in NestJS?
- [ ] New env var added to `.env.example` too?

## Post-Implementation (do proactively)

- **RLS audit**: When changing models, verify and report RLS status for every affected table
- **New tests**: Proactively write tests for new code paths, report coverage gaps
- **Documentation**: Update docs in the same batch as the implementation
