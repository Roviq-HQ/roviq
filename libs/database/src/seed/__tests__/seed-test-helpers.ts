import pg from 'pg';
import { TEST_SUPERUSER_URL } from '../../__tests__/test-helpers';
import { createDrizzleDb } from '../../providers';

export function makeSeedTestDb() {
  const pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  const db = createDrizzleDb(pool);
  return { pool, db };
}

/**
 * Hook timeout for a seed run. Every seed upserts the Roviq Direct reseller, so it waits while
 * the ROV-91 backfill test holds `LOCK TABLE resellers`; on a loaded machine the full demo seed
 * plus that wait goes past the 10 s default.
 */
export const SEED_HOOK_TIMEOUT_MS = 60_000;
