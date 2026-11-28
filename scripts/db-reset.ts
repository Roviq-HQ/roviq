/**
 * Reset a database: drop everything the migrations create, then build it again with
 * `drizzle-kit migrate` — the same path production takes on its first deploy.
 *
 * Usage:
 *   pnpm db:reset            — drop + migrate (dev database)
 *   pnpm db:reset --seed     — drop + migrate + seed
 *   pnpm db:reset --test     — target the test database; always seeds
 *   pnpm db:reset --if-empty — build a database that was never built; otherwise do nothing
 *
 * Safety: refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import Redis from 'ioredis';
import { Pool } from 'pg';

if (process.env.NODE_ENV === 'production') {
  console.error('Cannot reset database in production.');
  process.exit(1);
}

/** `--if-empty` found a database built by migrations that are not in this checkout. */
const EXIT_OTHER_CHAIN = 3;

// Dropping and migrating need the owner role (roviq) — always the MIGRATE URL.
const useTestDb = process.argv.includes('--test');
const connectionString = useTestDb
  ? process.env.DATABASE_URL_TEST_MIGRATE ||
    'postgresql://roviq:roviq_dev@localhost:5435/roviq_test'
  : process.env.DATABASE_URL_MIGRATE || 'postgresql://roviq:roviq_dev@localhost:5434/roviq';

// The test database always seeds: integration tests reference seed ids, and an
// unseeded one fails them with foreign-key errors that do not name the cause.
const shouldSeed = process.argv.includes('--seed') || useTestDb;
const onlyIfEmpty = process.argv.includes('--if-empty');

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    if (onlyIfEmpty) {
      const state = await databaseState(pool);
      if (state === 'built') {
        console.log('Database is already built; nothing to do.');
        return;
      }
      // The test database holds nothing but seed data, so it is rebuilt without asking.
      if (state === 'other-chain' && !useTestDb) {
        console.error(
          'This database was built by migrations that are not in this checkout ' +
            '(an older migration chain, or another branch). Rebuild it: `pnpm tilt trigger db-clean`.',
        );
        process.exitCode = EXIT_OTHER_CHAIN;
        return;
      }
    }
    await dropEverything(pool);
    console.log('Database cleared.');
  } finally {
    await pool.end();
  }

  console.log('Applying migrations...');
  execSync('drizzle-kit migrate --config=drizzle.config.ts', {
    stdio: 'inherit',
    cwd: 'libs/database',
    env: { ...process.env, DATABASE_URL_MIGRATE: connectionString },
  });

  if (shouldSeed) {
    console.log('Seeding...');
    execSync('pnpm db:seed', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL_MIGRATE: connectionString },
    });
  }
  // The auth lockout cache (rate-limit on failed logins) lives in Redis,
  // not Postgres. Without flushing, repeated test runs accumulate failures
  // for the same username and the suite eventually trips ACCOUNT_LOCKED on
  // a clean DB. Production never resets, so this only runs for --test.
  if (useTestDb) {
    await flushTestRedis();
  }

  console.log('Done.');
}

async function flushTestRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://:roviq_redis_dev@localhost:6379';
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
    console.log('Flushed Redis DB.');
  } catch (err) {
    console.warn(`Redis flush skipped (${(err as Error).message}) — lockout cache may persist.`);
  } finally {
    redis.disconnect();
  }
}

type DatabaseState = 'empty' | 'built' | 'other-chain';

// 'empty' also covers a database left behind by a failed migrate: drizzle-kit runs the whole
// chain in one transaction, so a failure leaves the migrations table without rows.
async function databaseState(pool: Pool): Promise<DatabaseState> {
  const tables = await pool.query<{ has_migrations: boolean; has_users: boolean }>(`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_migrations,
           to_regclass('public.users') IS NOT NULL AS has_users
  `);
  const { has_migrations, has_users } = tables.rows[0] ?? {
    has_migrations: false,
    has_users: false,
  };

  const applied = has_migrations
    ? (await pool.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations')).rows
    : [];
  if (applied.length === 0) {
    return has_users ? 'other-chain' : 'empty';
  }

  const known = new Set(
    readMigrationFiles({ migrationsFolder: 'libs/database/migrations' }).map((m) => m.hash),
  );
  return applied.some((row) => known.has(row.hash)) ? 'built' : 'other-chain';
}

// Everything the migrations create in `public`, plus drizzle's own bookkeeping. The pg_trgm
// extension, the roles and the default privileges stay: the first migration creates them
// only when they are missing.
async function dropEverything(pool: Pool): Promise<void> {
  await pool.query('DROP EVENT TRIGGER IF EXISTS enforce_live_view_security_invoker');

  const relations = await pool.query<{ name: string; kind: string }>(`
    SELECT c.oid::regclass::text AS name, c.relkind AS kind
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p', 'v')
       AND NOT c.relispartition
  `);
  console.log(`Dropping ${relations.rows.length} tables and views...`);
  for (const { name, kind } of relations.rows) {
    await pool.query(`DROP ${kind === 'v' ? 'VIEW' : 'TABLE'} IF EXISTS ${name} CASCADE`);
  }

  const enums = await pool.query<{ name: string }>(`
    SELECT oid::regtype::text AS name
      FROM pg_type
     WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
  `);
  console.log(`Dropping ${enums.rows.length} enum types...`);
  for (const { name } of enums.rows) {
    await pool.query(`DROP TYPE IF EXISTS ${name} CASCADE`);
  }

  // Functions that belong to an extension (pg_trgm) are left alone.
  const routines = await pool.query<{ signature: string }>(`
    SELECT p.oid::regprocedure::text AS signature
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
       )
  `);
  console.log(`Dropping ${routines.rows.length} functions...`);
  for (const { signature } of routines.rows) {
    await pool.query(`DROP ROUTINE IF EXISTS ${signature} CASCADE`);
  }

  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
