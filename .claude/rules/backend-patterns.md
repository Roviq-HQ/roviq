---
paths:
  - "apps/api-gateway/**"
  - "libs/backend/**"
---

# Backend Code Patterns (NestJS / api-gateway)

## General

- DI for same-process communication, NestJS microservices (NATS) for inter-service
- `ConfigService` for all config — never `process.env`
- All NestJS app modules must have `ConfigModule.forRoot({ isGlobal: true })`


## Naming Conventions

- camelCase: variables, functions
- PascalCase: classes, types, models
- snake_case: database columns/tables
- kebab-case: file names
- UPPER_SNAKE: environment variables
- `@roviq/*`: library imports

## Code Style

- Single root `.env` for all config — new env vars must also go in `.env.example`
- Exports at top, private methods at bottom
- >2 params → use object parameter
- Only export what's used externally
