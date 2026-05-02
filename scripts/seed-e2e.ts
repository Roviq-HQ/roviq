// scripts/seed-e2e.ts
import 'dotenv/config';
import { Pool } from 'pg';
import { createDrizzleDb } from '../libs/database/src/providers';
import { seedE2e } from '../libs/database/src/seed';
import { assertSafeToRunDestructiveSeed } from './guards';

async function main() {
  assertSafeToRunDestructiveSeed();
  const connectionString = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL_MIGRATE or DATABASE_URL must be set');
  }
  const pool = new Pool({ connectionString });
  const db = createDrizzleDb(pool);
  try {
    await seedE2e(db);
    if (process.env.ROVIQ_EE === 'true') {
      const { seedBillingData } = await import('@roviq/ee-database/seed');
      await seedBillingData(db);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed e2e failed:', err);
  process.exit(1);
});
