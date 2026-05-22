// scripts/seed-essential.ts
import 'dotenv/config';
import { Pool } from 'pg';
import { createDrizzleDb } from '../libs/database/src/providers';
import { seedEssential } from '../libs/database/src/seed';

async function main() {
  const connectionString = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL_MIGRATE or DATABASE_URL must be set');
  }
  const pool = new Pool({ connectionString });
  const db = createDrizzleDb(pool);
  try {
    await seedEssential(db);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed essential failed:', err);
  process.exit(1);
});
