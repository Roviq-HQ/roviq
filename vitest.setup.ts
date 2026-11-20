/**
 * Vitest setup file — runs inside every test worker before any test code.
 *
 * Loads `.env` so tests that read connection strings via `process.env.DATABASE_URL_TEST`
 * resolve to the test database (`roviq_test`) instead of falling back to hardcoded
 * dev defaults. Without this, every standalone DB integration test would silently
 * connect to the dev database.
 */
import 'dotenv/config';
import { disableTemporalWorkers } from './libs/backend/testing/src/integration/test-env';

// Before any spec imports AppModule, whose ConfigModule reads the environment at import time.
disableTemporalWorkers();
