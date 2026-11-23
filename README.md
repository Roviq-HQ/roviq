<div align="center">

# Roviq

**The open-source platform to run your institute**

[![CI](https://github.com/Roviq-HQ/roviq/actions/workflows/ci.yml/badge.svg)](https://github.com/Roviq-HQ/roviq/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Last Commit](https://img.shields.io/github/last-commit/Roviq-HQ/roviq)](https://github.com/Roviq-HQ/roviq/commits)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![GraphQL](https://img.shields.io/badge/GraphQL-E10098?logo=graphql&logoColor=white)](https://graphql.org/)
[![NX](https://img.shields.io/badge/NX-143055?logo=nx&logoColor=white)](https://nx.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

<a href="docs/README.md">Docs</a> · <a href="https://github.com/Roviq-HQ/roviq/issues">Issues</a>

</div>

---

## Why Roviq

**Built for institute staff, not IT departments.** Most actions take fewer than 3 clicks. AI handles the tedious work — generating timetables, detecting attendance anomalies, auto-filling forms — so staff don't have to.

**One platform, not five.** Admissions, attendance, timetables, fees, and reporting in a single system. No juggling between disconnected tools.

**Your data, your control.** Open source, open API, self-hostable. No vendor lock-in, no data hostage.

## Quick start

Requires [Node.js 24](https://nodejs.org/), [pnpm](https://pnpm.io/), [Docker](https://www.docker.com/) and [Tilt](https://tilt.dev/).

```bash
git clone https://github.com/Roviq-HQ/roviq.git
cd roviq
pnpm tilt up
```

Tilt installs the dependencies, starts the databases, applies the schema, seeds test data and starts the apps. Then open:

| Portal | URL |
|--------|-----|
| Institute | http://localhost:4200 |
| Admin | http://admin.localhost:4200 |
| Reseller | http://reseller.localhost:4200 |

Test logins and the full walkthrough are in [Getting started](docs/getting-started.md).

## Documentation

[docs/README.md](docs/README.md) lists every document. The usual first reads:

- [Getting started](docs/getting-started.md): set up and log in
- [Architecture](docs/architecture.md): repository layout, libraries, design decisions
- [Auth](docs/auth.md): scopes, tokens, permissions
- [Testing](docs/testing.md): test types and commands
- [Contributing](CONTRIBUTING.md): how a change reaches `main`

## What is inside

| Path | Contents |
|------|----------|
| `apps/api-gateway` | NestJS GraphQL API |
| `apps/notification-service` | NestJS service that delivers notifications |
| `apps/web` | Next.js app serving the institute, admin and reseller portals |
| `libs/` | Shared libraries (`@roviq/*`): database, auth, UI, events |
| `ee/` | Enterprise Edition: billing and payment gateways |
| `e2e/` | API and browser end-to-end tests |

PostgreSQL 18 with row-level security, Redis, NATS JetStream, Temporal and S3-compatible storage run in Docker.

## Licence

[AGPL-3.0](LICENSE). The `ee/` directory has its own [licence](ee/LICENSE).

---

<div align="center">

Built by [@priyanshu0x](https://github.com/priyanshu0x)

</div>
