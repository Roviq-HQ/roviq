import { createDrizzleDb, type DrizzleDB } from '@roviq/database';
import { Pool } from 'pg';

/** Create a standalone DrizzleDB for a Temporal worker (not NestJS DI) */
export async function createDrizzleForWorker(connectionString: string): Promise<DrizzleDB> {
  const pool = new Pool({ connectionString, max: 3 });
  return createDrizzleDb(pool);
}

/** A worker's own DrizzleDB together with its pool, so the worker can end the pool on shutdown. */
export function openWorkerDb(connectionString: string): { db: DrizzleDB; pool: Pool } {
  const pool = new Pool({ connectionString, max: 3 });
  return { db: createDrizzleDb(pool), pool };
}
