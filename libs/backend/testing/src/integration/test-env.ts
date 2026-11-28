/**
 * Default environment variables for integration tests.
 *
 * Booting the api-gateway's `AppModule` runs `validate()` from
 * `apps/api-gateway/src/config/env.validation.ts`, which requires several env
 * vars. Test runners may not have a `.env` loaded, so this helper sets safe
 * defaults for any missing entries.
 *
 * IMPORTANT: this module has **no top-level side effects**. The previous
 * version called `setupTestEnv()` at import time, which mutated
 * `process.env` for every file that transitively imported `@roviq/testing`
 * (including unit tests that only needed `createMock`). Now the side effect
 * fires only when `createIntegrationApp()` actually calls `setupTestEnv()`.
 */

function setIfMissing(key: string, value: string): void {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

/** Every `*_WORKER_ENABLED` flag that starts an embedded Temporal worker in the gateway. */
export const TEMPORAL_WORKER_FLAGS = [
  'STUDENT_ADMISSION_WORKER_ENABLED',
  'STUDENT_IMPORT_WORKER_ENABLED',
  'BILLING_WORKER_ENABLED',
  'FILE_SWEEPER_WORKER_ENABLED',
  'COMPLIANCE_EXPORT_WORKER_ENABLED',
  'TC_ISSUANCE_WORKER_ENABLED',
  'INSTITUTE_SETUP_WORKER_ENABLED',
  'AUDIT_PARTITION_WORKER_ENABLED',
] as const;

export type TemporalWorkerFlag = (typeof TEMPORAL_WORKER_FLAGS)[number];

/**
 * Switches every embedded Temporal worker off. A flag left on in `.env` would make a test
 * process poll the dev Temporal and run dev tasks against the test DB. It must run before
 * `AppModule` is imported: `ConfigModule.forRoot` reads the environment at import time, so
 * the integration project calls it from `vitest.setup.ts`. A spec that needs a worker sets
 * its flag to 'true' in a `vi.hoisted` block, which runs after this and before its imports.
 */
export function disableTemporalWorkers(): void {
  for (const flag of TEMPORAL_WORKER_FLAGS) process.env[flag] = 'false';
}

export function setupTestEnv(): void {
  // Database — integration tests must ALWAYS run against the test DB, never
  // the dev DB. Force-override DATABASE_URL so a stray .env entry can't leak
  // dev credentials into the test run.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL_TEST ??
    'postgresql://roviq_pooler:roviq_pooler_dev@localhost:5434/roviq_test';

  // External services — connections are mocked in createIntegrationApp(), but
  // the env vars must still parse cleanly through env.validation.ts.
  setIfMissing('REDIS_URL', 'redis://localhost:6379');
  setIfMissing('NATS_URL', 'nats://localhost:4222');

  // Auth — token factories sign with the same JWT_SECRET the JwtStrategy
  // reads. This default MUST stay in sync with the fallback in
  // `../token-factories.ts`; the two files are deliberately paired.
  setIfMissing('JWT_SECRET', 'test-jwt-secret-do-not-use-in-production');
  setIfMissing('JWT_REFRESH_SECRET', 'test-jwt-refresh-secret-do-not-use-in-production');

  // WebAuthn / CORS — required by env validation, never exercised by tests.
  setIfMissing('WEBAUTHN_RP_ID', 'localhost');
  setIfMissing('WEBAUTHN_RP_NAME', 'Roviq Test');
  setIfMissing('ALLOWED_ORIGINS', 'http://localhost:4200');

  // Every spec file sends its requests from one address; the request limits have a spec of
  // their own, which sets its limits itself.
  process.env.RATE_LIMIT_MULTIPLIER = '1000';

  // Force NODE_ENV=test so GraphQL playground/introspection are enabled.
  setIfMissing('NODE_ENV', 'test');
}
