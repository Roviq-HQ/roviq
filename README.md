<div align="center">

# Roviq

**Open-source institute management for India**

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

Roviq runs the records, the daily routine and the paperwork of an institute in one system:
admissions, students and staff, attendance, timetables, examinations, certificates and government
reports. It is built for Indian institutes (pre-primary to senior secondary, coaching centres and
libraries), in English and Hindi.

> **Status: pre-release.** Roviq is under active development and is not running in production
> yet. The database schema and the API can still change.

## Why Roviq

**One system instead of five.** Admissions, attendance, timetables, exams and certificates share
the same student and staff records, so nothing is typed twice. Approved leave shows up in the
attendance roster; a holiday blocks it; a period in the timetable opens its attendance sheet.

**Built for India.** CBSE, BSEH and RBSE subject catalogues, the NEP 2020 and 10+2 structures,
exports for UDISE+, CBSE and state portals, transfer certificates anyone can verify online, and
every screen in English and Hindi.

**Many institutes, kept apart by the database.** One installation serves many institutes.
PostgreSQL row-level security separates them, every change lands in an audit log the institute
can read, and a reseller's support staff can enter an institute only with its one-time code.
[How it is secured](docs/security.md).

**Open source.** The core is AGPL-3.0, with a GraphQL API for everything the portals do. You can
read it, run it and change it.

## What is in it

| For | Roviq gives them |
|-----|------------------|
| **Institutes** | Admissions, student and staff records, guardians, daily attendance, leave and holidays, timetables with substitutions, exams and report cards, transfer and other certificates, roles and permissions, notifications, an audit log |
| **Resellers** | A portal to create and support their institutes, with plans, subscriptions and invoices (Enterprise) and their own team |
| **Platform operators** | A portal for institutes and resellers, system health, audit and supervised support access |

The full list, and what is **not** built yet (student fee collection, online exams), is in the
[product overview](docs/product.md).

## Quick start

Requires [Node.js 24](https://nodejs.org/), [pnpm](https://pnpm.io/), [Docker](https://www.docker.com/) and [Tilt](https://tilt.dev/).

```bash
git clone https://github.com/Roviq-HQ/roviq.git
cd roviq
pnpm tilt up
```

Tilt installs the dependencies, starts the databases, applies the schema, seeds demo data and starts the apps. Then open:

| Portal | URL |
|--------|-----|
| Institute | http://localhost:4200 |
| Admin | http://admin.localhost:4200 |
| Reseller | http://reseller.localhost:4200 |

Demo logins and the full walkthrough are in [Getting started](docs/getting-started.md).

## Documentation

[docs/README.md](docs/README.md) lists every document. Where to start:

| You want to | Read |
|-------------|------|
| Know what Roviq does | [Product overview](docs/product.md) |
| Use the portals | User guides: [institute](docs/user-guides/institute-portal.md), [reseller](docs/user-guides/reseller-portal.md), [admin](docs/user-guides/admin-portal.md) |
| Judge the design and the security | [Architecture](docs/architecture.md), [Security overview](docs/security.md) |
| Run it in production | [Deployment](docs/deployment.md) |
| Work on the code | [Getting started](docs/getting-started.md), [Contributing](CONTRIBUTING.md) |

## Built with

TypeScript throughout: a NestJS GraphQL API, a Next.js web app, PostgreSQL 18 with row-level
security, Redis, NATS JetStream for events, Temporal for workflows and S3-compatible storage, in
an Nx monorepo. The [architecture](docs/architecture.md) has the diagram and the reasons.

## Editions and licence

| Edition | Contents | Licence |
|---------|----------|---------|
| Community | Everything outside `ee/` | [AGPL-3.0](LICENSE) |
| Enterprise | Adds `ee/`: subscription billing and payment gateways | [Business Source License 1.1](ee/LICENSE) |

## Roadmap and feedback

Planned work and bugs are in [GitHub Issues](https://github.com/Roviq-HQ/roviq/issues). Open one
to report a problem or ask for a feature. Report a security problem privately: [SECURITY.md](SECURITY.md).
For an Enterprise licence outside the terms in `ee/LICENSE`, write to licensing@nbb.ai.

---

<div align="center">

Built by [@priyanshu0x](https://github.com/priyanshu0x)

</div>
