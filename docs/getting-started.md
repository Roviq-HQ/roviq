# Getting Started

## Prerequisites

- Node.js 24 (the version in `.nvmrc`)
- pnpm (package manager)
- Docker Desktop
- [Tilt](https://docs.tilt.dev/install.html) (dev environment orchestrator)

## Setup

```bash
git clone https://github.com/Roviq-HQ/roviq.git && cd roviq
pnpm tilt up
```

Tilt handles everything automatically:
- Creates `.env` from `.env.example` on first run
- Installs dependencies (`pnpm install`)
- Starts infra (Postgres, Redis, NATS, object storage (RustFS), Temporal) in Docker; OpenObserve (logs, metrics, traces) starts on demand (`pnpm tilt trigger observability`)
- Pushes Drizzle schema to database and seeds test data
- Starts all apps locally; the API gateway and notification service run from TypeScript source and restart by themselves when you save a file (`docs/infrastructure.md` → "How the backend apps run in dev")

Open the Tilt UI at http://localhost:10350 to monitor all resources.

## Test Credentials

| Username | Password | Role | Institutes |
|----------|----------|------|------------|
| admin | admin123 | institute_admin | 2 institutes (shows institute picker) |
| teacher1 | teacher123 | teacher | 1 institute (direct login) |
| student1 | student123 | student | 1 institute (direct login) |
| guardian1 | Guardian123 | parent of student1 (the e2e seed also links student2) | 1 institute (direct login) |
| subjectteacher1 | teacher123 | subject_teacher, Hindi periods in the demo timetable | 1 institute (direct login) |
| guardian4 | guardian123 | parent, two children (student6, student7) | 1 institute (direct login) |
| student6, student7 | student123 | student | 1 institute (direct login) |

All of these are in the dev seed and the e2e seed. The e2e seed adds more people (guardian2, guardian3, student2 to student5, staff2, staff3) and also links guardian1 to student2. Credentials are defined in `libs/database/src/seed/fixtures.ts` and exported from `e2e/shared/seed-fixtures.ts`.

Login requires only username + password — no Institute ID.

## Quick Verification

> Ports and URLs here are the instance 0 (main checkout) values. In a parallel dev instance each is shifted by `slot × 20`; run `pnpm instance:ports` to see yours. See `docs/infrastructure.md` → "Parallel dev instances".

```bash
# GraphQL playground
open http://localhost:3005/api/graphql

# Health check
curl http://localhost:3005/api/health

# Observability (also accessible via web app → Observability)
open http://localhost:5080                   # OpenObserve, after `pnpm tilt trigger observability`

# Institute login (single institute → direct JWT)
curl -s http://localhost:3005/api/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { instituteLogin(username: \"teacher1\", password: \"teacher123\") { accessToken user { username } } }"}'

# Institute login (multi-institute → membership picker)
curl -s http://localhost:3005/api/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { instituteLogin(username: \"admin\", password: \"admin123\") { requiresInstituteSelection memberships { membershipId instituteName roleName tenantId } } }"}'

# Select institute (use any valid token from above)
curl -s http://localhost:3005/api/graphql -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"query":"mutation { selectInstitute(membershipId: \"<MEMBERSHIP_ID>\") { accessToken user { username } } }"}'

# Admin login (platform scope)
curl -s http://localhost:3005/api/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { adminLogin(username: \"admin\", password: \"admin123\") { accessToken user { username scope } } }"}'
```

## Running tests

```bash
pnpm run test        # unit tests of every project
```

Integration and end-to-end tests need their own stack. Every command is in [testing.md](testing.md#commands).

## Dev Scripts

```bash
# Dev environment
pnpm tilt up                  # Start everything (infra + apps)
pnpm tilt down                # Stop everything

# Individual apps (if not using Tilt)
pnpm run dev:gateway      # API gateway, from source    (port 3005)
pnpm run dev:notifications # Notification service       (port 3002)
pnpm run dev:web          # Web app                     (port 4200)

# Database (handled automatically by Tilt, but available manually)
pnpm run db:push          # Push Drizzle schema to DB
pnpm run db:seed          # Seed test data
pnpm run db:reset         # Nuke DB + re-push schema
pnpm run db:reset --seed  # Nuke + push + seed in one step
pnpm run db:studio        # Drizzle Studio (visual DB browser)

# Code quality
pnpm run lint             # Biome lint check
pnpm run lint:fix         # Biome auto-fix
pnpm run format           # Biome format
pnpm run typecheck        # TypeScript type checking (Nx builds, the gate)
pnpm run typecheck:watch  # Watch-mode type check of the two backend apps (Tilt `typecheck`)
```
