import pg from 'pg';
import { TEST_SUPERUSER_URL } from '../../__tests__/test-helpers';
import { createDrizzleDb } from '../../providers';

export function makeSeedTestDb() {
  const pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  const db = createDrizzleDb(pool);
  return { pool, db };
}
